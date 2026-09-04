import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import {
  MILLISECONDS_PER_DAY,
  SCHEDULE_WEEK_START_HOUR_UTC,
} from "../constants/index.js";
import type {
  GuildSchedule,
  GuildScheduleTimeWindow,
} from "../types/guild-schedule.js";

/** Resolves the configured custom guild emoji for personal schedule rows. */
export const getGuildIcon = (guildId: string): string | undefined => {
  const iconSetName = process.env.DISCORD_ENV?.toUpperCase() ?? "PROD";
  return (
    DISCORD_SETTINGS.guildIcons[iconSetName]?.[guildId] ??
    DISCORD_SETTINGS.guildIcons.PROD?.[guildId] ??
    DISCORD_SETTINGS.guildIcons.DEV?.[guildId]
  );
};

/** Extracts Unix timestamp seconds from a schedule's Discord timestamp mention. */
export const getScheduleUnixSeconds = (schedule: GuildSchedule): number =>
  Number(schedule.timestamp.match(/\d+/)?.[0] ?? 0);

/** Returns the title icon for a schedule based on whether its time has passed. */
export const getScheduleTitleIcon = (schedule: GuildSchedule): string =>
  getScheduleUnixSeconds(schedule) * 1_000 >= Date.now() ? "🗓️" : "✅";

/** Returns the Monday 06:00 UTC bounded schedule week containing the date. */
export const getScheduleWeekWindow = (
  date = new Date(),
): GuildScheduleTimeWindow => {
  const mondayBasedDay = (date.getUTCDay() + 6) % 7;
  const start = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - mondayBasedDay,
      SCHEDULE_WEEK_START_HOUR_UTC,
    ),
  );

  if (date.getTime() < start.getTime()) {
    start.setUTCDate(start.getUTCDate() - 7);
  }

  return {
    start,
    end: new Date(start.getTime() + 7 * MILLISECONDS_PER_DAY),
  };
};

/** Formats a UTC date as Discord embed title text, such as 04 Sep. */
export const formatScheduleWindowDate = (date: Date): string =>
  date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });

/** Builds the personal schedule title for a schedule week window. */
export const getScheduleWeekTitle = ({
  start,
}: GuildScheduleTimeWindow): string => {
  const endDate = new Date(start.getTime() + 6 * MILLISECONDS_PER_DAY);
  return `Your Schedule - ${formatScheduleWindowDate(start)} to ${formatScheduleWindowDate(endDate)}`;
};
