import {
  buildSignupSheetEmbed,
  formatSignupSchedule,
  SIGNUP_COMMANDS_HELP_TEXT,
} from "./signup-sheet.template.js";
import type { SignupSheet } from "../types/signup-sheet.js";

const buildSheet = (overrides: Partial<SignupSheet> = {}): SignupSheet => ({
  guildId: "guild-1",
  channelId: "channel-1",
  title: "Test Run",
  organizerName: "Organizer",
  organizerAvatarUrl: "https://example.com/organizer.png",
  partySizes: [2],
  slots: [
    {
      number: 1,
      role: "Tank",
      signupUserId: "user-1",
      signupDisplayName: "Alice",
      charNote: "alt",
    },
    {
      number: 2,
      role: "DPS",
      signupUserId: null,
      signupDisplayName: null,
      charNote: null,
    },
  ],
  reserves: [],
  notes: null,
  thumbnailUrl: null,
  color: null,
  instanceType: null,
  timestamp: null,
  scheduleTimezone: null,
  serverTimezone: null,
  ...overrides,
});

describe("formatSignupSchedule", () => {
  it("shows TBD when the schedule is unset", () => {
    expect(formatSignupSchedule(buildSheet({ timestamp: null }))).toBe(
      "*Your Time: TBD*",
    );
  });

  it("shows TBD server date/time when unset but a server timezone is configured", () => {
    expect(
      formatSignupSchedule(
        buildSheet({ timestamp: null, serverTimezone: "GMT+8" }),
      ),
    ).toBe(
      "*Your Time: TBD*\n\nServer Date: TBD\nServer Time: TBD\nServer Timezone: GMT+8",
    );
  });

  it("shows only the invoker's local time when no server timezone is set", () => {
    expect(formatSignupSchedule(buildSheet({ timestamp: 1_700_000_000 }))).toBe(
      "*Your Time: <t:1700000000:F>*\n*<t:1700000000:R>*",
    );
  });

  it("includes the server date/time/timezone when a server timezone is configured", () => {
    const result = formatSignupSchedule(
      buildSheet({ timestamp: 1_700_000_000, serverTimezone: "GMT+8" }),
    );
    expect(result).toContain("*Your Time: <t:1700000000:F>*");
    expect(result).toContain("Server Timezone: GMT+8");
    expect(result).toMatch(/Server Date: \w+, \d+ \w+ \d{4}/);
    expect(result).toMatch(/Server Time: \d{2}:\d{2} (am|pm)/);
  });
});

describe("SIGNUP_COMMANDS_HELP_TEXT", () => {
  it("documents the core roster, sheet, and schedule commands", () => {
    expect(SIGNUP_COMMANDS_HELP_TEXT).toContain("/add input=#/random/reserve");
    expect(SIGNUP_COMMANDS_HELP_TEXT).toContain("/setinstancetype");
    expect(SIGNUP_COMMANDS_HELP_TEXT).toContain("/sdt");
  });
});

describe("buildSignupSheetEmbed", () => {
  it("shows the run title, description, party/reserve/schedule fields, and organizer footer", () => {
    const embed = buildSignupSheetEmbed(buildSheet(), "Guild", null);
    const data = embed.data;

    expect(data.title).toBe("Test Run");
    expect(data.description).toContain("🗓️ **1** of **2** slot/s filled");
    expect(data.description).toContain("🪑 0 reserve/s");
    expect(data.fields?.[0]).toMatchObject({
      name: "__Party 1:__",
      value: "`01`: Tank - **Alice** *(alt)*\n`02`: DPS -",
    });
    expect(data.fields?.[1]).toMatchObject({
      name: "Reserves:",
      value: "None - *to add as reserve, type `/add input=reserve`*",
    });
    expect(data.footer).toEqual({
      text: "Organizer - Organizer",
      icon_url: "https://example.com/organizer.png",
    });
  });

  it("includes important notes in the description when present", () => {
    const embed = buildSignupSheetEmbed(
      buildSheet({ notes: "Bring potions" }),
      "Guild",
      null,
    );
    expect(embed.data.description).toContain("Important Notes:\nBring potions");
  });

  it("lists reserves with their character notes", () => {
    const embed = buildSignupSheetEmbed(
      buildSheet({
        reserves: [
          { userId: "user-2", displayName: "Bob", charNote: "wallet" },
        ],
      }),
      "Guild",
      null,
    );
    expect(embed.data.fields?.[1]).toMatchObject({
      name: "Reserves:",
      value: "`03`: **Bob** *(wallet)*",
    });
  });

  it("appends the instance type to the organizer footer when set", () => {
    const embed = buildSignupSheetEmbed(
      buildSheet({ instanceType: "Eternal Bastion" }),
      "Guild",
      null,
    );
    expect(embed.data.footer?.text).toBe(
      "Organizer - Organizer | 🔥 Eternal Bastion",
    );
  });

  it("omits the instance type from the footer when unset", () => {
    const embed = buildSignupSheetEmbed(buildSheet(), "Guild", null);
    expect(embed.data.footer?.text).toBe("Organizer - Organizer");
  });

  it("sets the thumbnail and color only when configured", () => {
    const withoutExtras = buildSignupSheetEmbed(buildSheet(), "Guild", null);
    expect(withoutExtras.data.thumbnail).toBeUndefined();
    expect(withoutExtras.data.color).toBeUndefined();

    const withExtras = buildSignupSheetEmbed(
      buildSheet({
        thumbnailUrl: "https://example.com/thumb.png",
        color: 0x00b0f4,
      }),
      "Guild",
      null,
    );
    expect(withExtras.data.thumbnail).toEqual({
      url: "https://example.com/thumb.png",
    });
    expect(withExtras.data.color).toBe(0x00b0f4);
  });

  it("includes the guild icon in the author when provided", () => {
    const embed = buildSignupSheetEmbed(
      buildSheet(),
      "Guild",
      "https://example.com/icon.png",
    );
    expect(embed.data.author).toEqual({
      name: "Guild",
      icon_url: "https://example.com/icon.png",
    });
  });
});
