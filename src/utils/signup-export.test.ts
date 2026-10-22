import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createHash } from "node:crypto";
import {
  COOLDOWN_INSTANCE_TYPES,
  type InstanceType,
} from "../constants/cooldowns.js";
import type { SignupSheet } from "../types/signup-sheet.js";

const settings = {
  cooldownInstanceTypesByGuild: {} as Record<string, InstanceType[]>,
};
jest.unstable_mockModule("../config/discord-settings.js", () => ({
  DISCORD_SETTINGS: settings,
}));
const {
  buildExportIdentifier,
  buildExportIdentifierFromRunKey,
  canExportSheet,
  ExportValidationError,
  getExportDate,
  getExportInstanceTypes,
  getExportRunKey,
} = await import("./signup-export.js");

const buildSheet = (overrides: Partial<SignupSheet> = {}): SignupSheet => ({
  guildId: "guild",
  channelId: "signup",
  title: "Endless Tower",
  organizerId: "123",
  organizerName: "Organizer",
  organizerAvatarUrl: "",
  partySizes: [1],
  slots: [],
  reserves: [],
  notes: null,
  thumbnailUrl: null,
  color: null,
  instanceType: null,
  timestamp: Date.UTC(2026, 8, 30, 23, 30) / 1000,
  serverTimezone: "GMT+8",
  scheduleTimezone: "GMT-5",
  ...overrides,
});

beforeEach(() => {
  settings.cooldownInstanceTypesByGuild = {};
});

describe("signup export utilities", () => {
  test("retains an earlier split footer after the signup instance selections change", () => {
    const sheet = buildSheet({
      instanceType: ["Endless Tower", "Endless Cellar"],
    });
    const savedKey = getExportRunKey(sheet, "Endless Tower");
    const identifier = buildExportIdentifier(sheet, "Endless Tower");
    sheet.instanceType = null;
    expect(buildExportIdentifierFromRunKey(sheet.guildId, savedKey)).toBe(
      identifier,
    );
    expect(buildExportIdentifier(sheet)).not.toBe(identifier);
  });
  test.each([
    {
      serverTimezone: "GMT+8",
      scheduleTimezone: "GMT-5",
      expected: "2026-10-01T07:30:00.000Z",
    },
    {
      serverTimezone: null,
      scheduleTimezone: "GMT-5",
      expected: "2026-09-30T18:30:00.000Z",
    },
    {
      serverTimezone: null,
      scheduleTimezone: null,
      expected: "2026-09-30T23:30:00.000Z",
    },
  ])(
    "uses server, schedule, then GMT timezone ($serverTimezone/$scheduleTimezone)",
    ({ serverTimezone, scheduleTimezone, expected }) => {
      expect(
        getExportDate(
          buildSheet({ serverTimezone, scheduleTimezone }),
        ).toISOString(),
      ).toBe(expected);
    },
  );

  test.each([null, []])(
    "returns no instance metadata when unset (%s)",
    (instanceType) => {
      expect(getExportInstanceTypes(buildSheet({ instanceType }))).toEqual([]);
    },
  );

  test("resolves a legacy single instance from built-in defaults", () => {
    const type = COOLDOWN_INSTANCE_TYPES.find(
      (candidate) => candidate.name === "Endless Tower",
    )!;
    expect(
      getExportInstanceTypes(buildSheet({ instanceType: type.name })),
    ).toEqual([{ name: type.name, emoji: type.emoji, initials: "ET" }]);
  });

  test("uses guild definitions, deduplicates selections, and retains unknown names without fallback emojis", () => {
    settings.cooldownInstanceTypesByGuild.guild = [
      { name: "Custom Run", emoji: "X", keywords: [], maxAttempts: 1 },
    ];
    const sheet = buildSheet({
      instanceType: ["Custom Run", "Endless Tower", "Custom Run", "Unknown"],
    });
    expect(getExportInstanceTypes(sheet)).toEqual([
      { name: "Custom Run", emoji: "X", initials: "CR" },
      { name: "Endless Tower", emoji: "", initials: "ET" },
      { name: "Unknown", emoji: "", initials: "U" },
    ]);
  });

  test("normalizes run titles and ignores same-day time and roster changes in the duplicate key", () => {
    const sheet = buildSheet();
    const changed = buildSheet({
      title: "  ENDLESS\n  TOWER  ",
      timestamp: sheet.timestamp! + 3600,
      instanceType: ["Endless Cellar"],
      organizerName: "Renamed",
    });
    expect(getExportRunKey(sheet)).toBe(
      JSON.stringify(["endless tower", "2026-10-01"]),
    );
    expect(getExportRunKey(changed)).toBe(getExportRunKey(sheet));
    expect(buildExportIdentifier(changed)).toBe(buildExportIdentifier(sheet));
  });

  test("includes the full year and scopes identifiers to the guild", () => {
    const sheet = buildSheet();
    expect(
      getExportRunKey(
        buildSheet({ timestamp: Date.UTC(2027, 8, 30, 23, 30) / 1000 }),
      ),
    ).not.toBe(getExportRunKey(sheet));
    expect(
      buildExportIdentifier(buildSheet({ guildId: "other-guild" })),
    ).not.toBe(buildExportIdentifier(sheet));
    const expectedHash = createHash("sha256")
      .update(
        JSON.stringify([
          "guild",
          JSON.stringify(["endless tower", "2026-10-01"]),
        ]),
      )
      .digest("hex");
    expect(buildExportIdentifier(sheet)).toBe(
      `-# Export ID: botbito-export:v1:${expectedHash}`,
    );
  });

  test.each([
    { id: undefined, avatar: "", user: "123", allowed: false },
    { id: null, avatar: "", user: "123", allowed: false },
    { id: "123", avatar: "", user: "other", allowed: false },
    { id: "123", avatar: "invalid URL", user: "123", allowed: true },
    {
      id: "123",
      avatar: "https://example.com/avatar.png",
      user: "123",
      allowed: true,
    },
    {
      id: "123",
      avatar: "https://cdn.discordapp.com/avatars/123/hash.png",
      user: "123",
      allowed: true,
    },
    {
      id: "123",
      avatar: "https://media.discordapp.net/avatars/123/hash.png",
      user: "123",
      allowed: true,
    },
    {
      id: "123",
      avatar: "https://cdn.discordapp.com/embed/avatars/0.png",
      user: "123",
      allowed: true,
    },
    {
      id: "123",
      avatar: "https://cdn.discordapp.com/avatars/456/hash.png",
      user: "123",
      allowed: false,
    },
    {
      id: "123",
      avatar: "https://media.discordapp.net/avatars/456/hash.png",
      user: "123",
      allowed: false,
    },
  ])(
    "checks stored organizer and avatar identity ($id, $avatar, $user)",
    ({ id, avatar, user, allowed }) => {
      expect(
        canExportSheet(
          buildSheet({ organizerId: id, organizerAvatarUrl: avatar }),
          user,
        ),
      ).toBe(allowed);
    },
  );

  test("retains validation errors as identifiable Error instances", () => {
    const error = new ExportValidationError("Invalid export");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Invalid export");
  });
});
