import { beforeEach, describe, expect, test, jest } from "@jest/globals";

const initialSettings = () => ({
  payoutGuildIds: ["499171225046876170", "1115484031455346718"],
  payoutToPingId: "contact",
  payoutToPingTag: "contact",
  payoutWorksheets: {
    "499171225046876170": "FSN 2026",
    "1115484031455346718": "DevTestSheet",
  } as Record<string, string> | undefined,
});
let settings = initialSettings();
jest.unstable_mockModule("node:fs", () => ({
  existsSync: () => false,
  readdirSync: jest.fn(),
  readFileSync: (path: string) =>
    JSON.stringify(
      path.endsWith("guild_schedule_settings.json")
        ? { guildScheduleBotIds: ["schedule-bot"] }
        : settings,
    ),
}));

const { DISCORD_SETTINGS, reloadDiscordSettings } =
  await import("./discord-settings.js");

describe("Discord worksheet settings", () => {
  beforeEach(() => {
    settings = initialSettings();
    reloadDiscordSettings();
  });

  test("loads worksheet names from JSON and refreshes the same settings object", () => {
    const current = DISCORD_SETTINGS;
    expect(current.payoutWorksheets?.["1115484031455346718"]).toBe(
      "DevTestSheet",
    );
    settings.payoutWorksheets!["1115484031455346718"] = "RenamedDevSheet";
    reloadDiscordSettings();
    expect(DISCORD_SETTINGS).toBe(current);
    expect(current.payoutWorksheets?.["1115484031455346718"]).toBe(
      "RenamedDevSheet",
    );
  });

  test("defaults older configurations to an empty mapping instead of hardcoded tabs", () => {
    settings.payoutWorksheets = undefined;
    reloadDiscordSettings();
    expect(DISCORD_SETTINGS.payoutWorksheets).toEqual({});
  });
});
