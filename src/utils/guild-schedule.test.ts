import { describe, expect, it, jest } from "@jest/globals";
import {
  formatScheduleWindowDate,
  getGuildIcon,
  getScheduleTitleIcon,
  getScheduleUnixSeconds,
  getScheduleWeekTitle,
  getScheduleWeekWindow,
} from "./guild-schedule.js";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import type { GuildSchedule } from "../types/guild-schedule.js";

const createSchedule = (timestamp: string): GuildSchedule => ({
  title: "Schedule",
  timestamp,
  channelName: "schedule-channel",
  channelUrl: "https://discord.com/channels/guild/channel",
  isSignedUp: true,
  isReserve: false,
});

describe("guild schedule utilities", () => {
  it("resolves configured guild icons from the selected environment", () => {
    const originalDiscordEnvironment = process.env.DISCORD_ENV;
    process.env.DISCORD_ENV = "DEV";

    try {
      expect(getGuildIcon("499171225046876170")).toBe(
        DISCORD_SETTINGS.guildIcons.DEV?.["499171225046876170"],
      );
    } finally {
      process.env.DISCORD_ENV = originalDiscordEnvironment;
    }
  });

  it("extracts timestamp seconds from a Discord timestamp mention", () => {
    expect(getScheduleUnixSeconds(createSchedule("<t:1788343200:F>"))).toBe(
      1788343200,
    );
  });

  it("uses a check mark for past schedules and a calendar for future schedules", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-04T12:00:00Z"));

    try {
      expect(getScheduleTitleIcon(createSchedule("<t:1788343200:F>"))).toBe(
        "✅",
      );
      expect(getScheduleTitleIcon(createSchedule("<t:1788948000:F>"))).toBe(
        "🗓️",
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("builds the Monday 06:00 UTC schedule week around a date", () => {
    expect(getScheduleWeekWindow(new Date("2026-09-04T12:00:00Z"))).toEqual({
      start: new Date("2026-08-31T06:00:00.000Z"),
      end: new Date("2026-09-07T06:00:00.000Z"),
    });
  });

  it("uses the previous schedule week before Monday 06:00 UTC", () => {
    expect(getScheduleWeekWindow(new Date("2026-08-31T05:59:59Z"))).toEqual({
      start: new Date("2026-08-24T06:00:00.000Z"),
      end: new Date("2026-08-31T06:00:00.000Z"),
    });
  });

  it("formats schedule week title dates in UTC", () => {
    const window = getScheduleWeekWindow(new Date("2026-09-04T12:00:00Z"));

    expect(formatScheduleWindowDate(window.start)).toBe("31 Aug");
    expect(getScheduleWeekTitle(window)).toBe(
      "Your Schedule - 31 Aug to 06 Sept",
    );
  });
});
