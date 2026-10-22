import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { InstanceType } from "../constants/cooldowns.js";
import type { SignupSheet } from "../types/signup-sheet.js";

const settings = {
  cooldownInstanceTypesByGuild: {} as Record<string, InstanceType[]>,
};
jest.unstable_mockModule("../config/discord-settings.js", () => ({
  DISCORD_SETTINGS: settings,
}));
const { buildExportContents, buildExportTitle } =
  await import("./signup-export.template.js");
const { ExportValidationError } = await import("../utils/signup-export.js");

const identifier = "-# Export ID: botbito-export:v1:test-id";
const buildSheet = (overrides: Partial<SignupSheet> = {}): SignupSheet => ({
  guildId: "guild",
  channelId: "signup",
  title: "Run Title",
  organizerId: "organizer",
  organizerName: "Organizer",
  organizerAvatarUrl: "",
  partySizes: [1, 2, 1],
  slots: [
    {
      number: 1,
      role: "Tank",
      signupUserId: null,
      signupDisplayName: null,
      charNote: null,
    },
    {
      number: 2,
      role: "Healer",
      signupUserId: "alice",
      signupDisplayName: "Alice",
      charNote: "Main",
    },
    {
      number: 3,
      role: "DPS",
      signupUserId: "bob",
      signupDisplayName: "Bob",
      charNote: null,
    },
    {
      number: 4,
      role: "Support",
      signupUserId: "tbc",
      signupDisplayName: "TBC",
      charNote: null,
      isTbc: true,
    },
  ],
  reserves: [{ userId: "reserve", displayName: "Reserve", charNote: null }],
  notes: null,
  thumbnailUrl: null,
  color: null,
  instanceType: null,
  timestamp: Date.UTC(2026, 9, 21, 12) / 1000,
  serverTimezone: "GMT",
  scheduleTimezone: null,
  ...overrides,
});
const selectedSlots = (sheet: SignupSheet) =>
  sheet.slots.filter((slot) => slot.signupUserId && !slot.isTbc);
const schedule = `*Your Time: <t:${buildSheet().timestamp}:F>* (*<t:${buildSheet().timestamp}:R>*)`;

beforeEach(() => {
  settings.cooldownInstanceTypesByGuild = {};
});

describe("signup export title template", () => {
  it.each([
    { timestamp: Date.UTC(2026, 9, 21, 12) / 1000, expected: "21/10" },
    { timestamp: Date.UTC(2026, 0, 1, 12) / 1000, expected: "01/01" },
  ])(
    "formats $expected without a year when no instance type is selected",
    ({ timestamp, expected }) => {
      expect(buildExportTitle(buildSheet({ timestamp }))).toBe(
        `\u23f3Run Title - ${expected}`,
      );
    },
  );

  it("uses the configured server date across midnight", () => {
    expect(
      buildExportTitle(
        buildSheet({
          timestamp: Date.UTC(2026, 9, 21, 23, 30) / 1000,
          serverTimezone: "GMT+8",
        }),
      ),
    ).toBe("\u23f3Run Title - 22/10");
  });

  it("deduplicates title emojis and leaves unknown instance types out of the suffix", () => {
    settings.cooldownInstanceTypesByGuild.guild = [
      { name: "Alpha", emoji: "X", keywords: [], maxAttempts: 1 },
      { name: "Beta", emoji: "X", keywords: [], maxAttempts: 1 },
      { name: "Gamma", emoji: "Y", keywords: [], maxAttempts: 1 },
    ];
    expect(
      buildExportTitle(
        buildSheet({ instanceType: ["Alpha", "Beta", "Gamma", "Unknown"] }),
      ),
    ).toBe("\u23f3Run Title - 21/10 [X Y]");
  });

  it("removes title line breaks and preserves metadata at the 100-character limit", () => {
    const title = buildExportTitle(
      buildSheet({
        title: "Long\nRun\rTitle ".repeat(20),
        instanceType: "Endless Tower",
      }),
    );
    expect(title).toHaveLength(100);
    expect(title).not.toMatch(/[\r\n]/);
    expect(title.endsWith(" - 21/10 [\u{1FA9C}]")).toBe(true);
  });

  it("throws an expected validation error when emojis leave no room for a title", () => {
    settings.cooldownInstanceTypesByGuild.guild = [
      { name: "Large", emoji: "X".repeat(100), keywords: [], maxAttempts: 1 },
    ];
    expect(() =>
      buildExportTitle(buildSheet({ instanceType: "Large" })),
    ).toThrow(ExportValidationError);
  });
});

describe("signup export content template", () => {
  it("preserves nonempty party headings, renumbers selected members, and does not mutate the sheet", () => {
    const sheet = buildSheet();
    const original = structuredClone(sheet);
    expect(
      buildExportContents(sheet, selectedSlots(sheet), identifier),
    ).toEqual([
      `**Party 2:**\n01: Healer - <@alice> (Main)\n02: DPS - <@bob>\n\nParticipants: **2**\n\n${schedule}\n${identifier}`,
    ]);
    expect(sheet).toEqual(original);
  });

  it("counts one participant for a user occupying multiple selected slots", () => {
    const sheet = buildSheet();
    sheet.slots[2]!.signupUserId = "alice";
    const contents = buildExportContents(
      sheet,
      selectedSlots(sheet),
      identifier,
    )!;
    expect(contents[0]).toContain("02: DPS - <@alice>");
    expect(contents[0]).toContain("Participants: **1**");
  });

  it("escapes Markdown and flattens character-note line breaks", () => {
    const sheet = buildSheet();
    sheet.slots[1]!.charNote = "*Main*\nalt\rnote";
    const contents = buildExportContents(
      sheet,
      selectedSlots(sheet),
      identifier,
    )!;
    expect(contents[0]).toContain(
      "01: Healer - <@alice> (\\*Main\\* alt note)",
    );
  });

  it("renders deduplicated, escaped instance names before timestamps and the final identifier", () => {
    settings.cooldownInstanceTypesByGuild.guild = [
      { name: "Custom*Type", emoji: "X", keywords: [], maxAttempts: 1 },
    ];
    const sheet = buildSheet({
      instanceType: ["Custom*Type", "Custom*Type", "Unknown"],
    });
    const contents = buildExportContents(
      sheet,
      selectedSlots(sheet),
      identifier,
    )!;
    expect(contents[0]).toContain(
      `Participants: **2**\n\nInstance Types: X **Custom\\*Type**, **Unknown**\n${schedule}\n${identifier}`,
    );
    expect(contents[0]?.endsWith(identifier)).toBe(true);
  });

  it("splits large rosters into bounded chunks without losing positions", () => {
    const sheet = buildSheet({ partySizes: [40] });
    sheet.slots = Array.from({ length: 40 }, (_, index) => ({
      ...sheet.slots[1]!,
      number: index + 1,
      role: "Long role ".repeat(8),
    }));
    const contents = buildExportContents(sheet, sheet.slots, identifier)!;
    expect(contents.length).toBeGreaterThan(1);
    expect(contents.every((content) => content.length <= 2000)).toBe(true);
    expect(contents[0]?.endsWith(identifier)).toBe(true);
    const lines = contents
      .join("\n")
      .split("\n")
      .filter((line) => /^\d+:/.test(line));
    expect(lines).toHaveLength(40);
    expect(lines[0]).toMatch(/^01:/);
    expect(lines.at(-1)).toMatch(/^40:/);
  });

  it("keeps an exactly 2000-character slot intact in a later message", () => {
    const sheet = buildSheet({ partySizes: [1] });
    const fixedText = "01:  - <@alice>";
    sheet.slots = [
      {
        ...sheet.slots[1]!,
        number: 1,
        charNote: null,
        role: "x".repeat(2000 - fixedText.length),
      },
    ];
    const contents = buildExportContents(sheet, sheet.slots, identifier)!;
    expect(contents).toHaveLength(2);
    expect(contents[0]).toBe(
      `**Party 1:**\n\nParticipants: **1**\n\n${schedule}\n${identifier}`,
    );
    expect(contents[1]).toHaveLength(2000);
  });

  it("rejects a slot longer than Discord's content limit", () => {
    const sheet = buildSheet();
    sheet.slots[1]!.role = "x".repeat(2000);
    expect(
      buildExportContents(sheet, selectedSlots(sheet), identifier),
    ).toBeNull();
  });

  it("rejects a metadata footer longer than Discord's content limit", () => {
    const sheet = buildSheet({ instanceType: "Long Type ".repeat(220) });
    expect(
      buildExportContents(sheet, selectedSlots(sheet), identifier),
    ).toBeNull();
  });

  it("keeps an exactly full footer as the first message and moves the roster to follow-ups", () => {
    const sheet = buildSheet();
    const footerPrefix = `Participants: **2**\n\n${schedule}\n`;
    const largeIdentifier = "x".repeat(2000 - footerPrefix.length);
    const contents = buildExportContents(
      sheet,
      selectedSlots(sheet),
      largeIdentifier,
    )!;
    expect(contents[0]).toBe(`${footerPrefix}${largeIdentifier}`);
    expect(contents[0]).toHaveLength(2000);
    expect(contents.slice(1).join("\n")).toContain("01: Healer - <@alice>");
    expect(contents.every((content) => content.length <= 2000)).toBe(true);
  });
});
