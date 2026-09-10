import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DiscordSettings } from "../types/discord-settings.js";

const settingsPath = resolve(process.cwd(), "private", "discord_settings.json");
const settings = JSON.parse(
  readFileSync(settingsPath, "utf8"),
) as Partial<DiscordSettings>;

if (
  !settings.payoutGuildIds ||
  !settings.payoutToPingId ||
  !settings.payoutToPingTag ||
  !settings.guildScheduleBotId ||
  !settings.guildIcons ||
  !settings.guildScheduleSourceByGuild ||
  Object.values(settings.guildScheduleSourceByGuild).some(
    (source) => !source.scheduleTextChannelIds,
  )
) {
  throw new Error("private/discord_settings.json is missing required settings");
}

export const DISCORD_SETTINGS: DiscordSettings = {
  payoutGuildIds: settings.payoutGuildIds,
  payoutToPingId: settings.payoutToPingId,
  payoutToPingTag: settings.payoutToPingTag,
  guildScheduleBotId: settings.guildScheduleBotId,
  guildIcons: settings.guildIcons,
  guildScheduleSourceByGuild: settings.guildScheduleSourceByGuild,
};

export const PAYOUT_GUILD_IDS = DISCORD_SETTINGS.payoutGuildIds;
export const GUILD_SCHEDULE_GUILD_IDS = Object.keys(
  DISCORD_SETTINGS.guildScheduleSourceByGuild,
);

/** Guilds where channel-scoped signup sheets are available as guild commands. */
export const SIGNUP_GUILD_IDS = [
  ...new Set([...PAYOUT_GUILD_IDS, ...GUILD_SCHEDULE_GUILD_IDS]),
];
