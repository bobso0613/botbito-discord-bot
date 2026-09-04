import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DiscordSettings } from "../types/discord-settings.js";

const settingsPath = resolve(process.cwd(), "private", "discord_settings.json");
const settings = JSON.parse(
  readFileSync(settingsPath, "utf8"),
) as Partial<DiscordSettings>;

if (
  !settings.payoutChannelByGuild ||
  !settings.payoutToPingId ||
  !settings.payoutToPingTag ||
  !settings.guildScheduleBotId ||
  !settings.guildIcons ||
  !settings.guildScheduleSourceByGuild
) {
  throw new Error("private/discord_settings.json is missing required settings");
}

export const DISCORD_SETTINGS: DiscordSettings = {
  payoutChannelByGuild: settings.payoutChannelByGuild,
  payoutToPingId: settings.payoutToPingId,
  payoutToPingTag: settings.payoutToPingTag,
  guildScheduleBotId: settings.guildScheduleBotId,
  guildIcons: settings.guildIcons,
  guildScheduleSourceByGuild: settings.guildScheduleSourceByGuild,
};

export const PAYOUT_GUILD_IDS = Object.keys(
  DISCORD_SETTINGS.payoutChannelByGuild,
);
export const GUILD_SCHEDULE_GUILD_IDS = Object.keys(
  DISCORD_SETTINGS.guildScheduleSourceByGuild,
);
