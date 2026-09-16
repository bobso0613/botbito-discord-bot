import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  DiscordSettings,
  GuildSettings,
} from "../types/discord-settings.js";
import {
  COOLDOWN_INSTANCE_TYPES,
  MULTIPLIER_INSTANCE_TYPES,
} from "../constants/cooldowns.js";

const settingsPath = resolve(process.cwd(), "private", "discord_settings.json");
const guildScheduleSettingsPath = resolve(
  process.cwd(),
  "private",
  "guild_schedule_settings.json",
);
const guildSettingsDirectory = resolve(
  process.cwd(),
  "private",
  "guild-settings",
);
const loadDiscordSettings = (): DiscordSettings => {
  const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Pick<
    Partial<DiscordSettings>,
    "payoutGuildIds" | "payoutToPingId" | "payoutToPingTag"
  >;
  const guildScheduleSettings = JSON.parse(
    readFileSync(guildScheduleSettingsPath, "utf8"),
  ) as Pick<Partial<DiscordSettings>, "guildScheduleBotIds">;
  const guildSettings = Object.fromEntries(
    (existsSync(guildSettingsDirectory)
      ? readdirSync(guildSettingsDirectory, { withFileTypes: true })
      : []
    )
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => [
        entry.name.slice(0, -".json".length),
        JSON.parse(
          readFileSync(resolve(guildSettingsDirectory, entry.name), "utf8"),
        ) as Partial<GuildSettings>,
      ]),
  );
  const guildScheduleSourceByGuild = Object.fromEntries(
    Object.entries(guildSettings).map(([guildId, guildSetting]) => [
      guildId,
      guildSetting.guildScheduleSource,
    ]),
  );
  const cooldownInstanceTypesByGuild = Object.fromEntries(
    Object.entries(guildSettings).map(([guildId, guildSetting]) => [
      guildId,
      guildSetting.cooldownInstanceTypes ?? [...COOLDOWN_INSTANCE_TYPES],
    ]),
  );
  const multiplierInstanceTypesByGuild = Object.fromEntries(
    Object.entries(guildSettings).map(([guildId, guildSetting]) => [
      guildId,
      guildSetting.multiplierInstanceTypes ?? [...MULTIPLIER_INSTANCE_TYPES],
    ]),
  );
  const guildIcons = Object.fromEntries(
    ["DEV", "PROD"].map((environment) => [
      environment,
      Object.fromEntries(
        Object.entries(guildSettings)
          .filter(([, guildSetting]) => guildSetting.guildIcons?.[environment])
          .map(([guildId, guildSetting]) => [
            guildId,
            guildSetting.guildIcons![environment],
          ]),
      ),
    ]),
  );

  if (
    !settings.payoutGuildIds ||
    !settings.payoutToPingId ||
    !settings.payoutToPingTag ||
    !Array.isArray(guildScheduleSettings.guildScheduleBotIds) ||
    guildScheduleSettings.guildScheduleBotIds.length === 0 ||
    guildScheduleSettings.guildScheduleBotIds.some((botId) => !botId) ||
    Object.values(guildScheduleSourceByGuild).some(
      (source) => !source?.scheduleTextChannelIds,
    )
  ) {
    throw new Error("Discord settings are missing required configuration");
  }

  return {
    payoutGuildIds: settings.payoutGuildIds,
    payoutToPingId: settings.payoutToPingId,
    payoutToPingTag: settings.payoutToPingTag,
    guildScheduleBotIds: guildScheduleSettings.guildScheduleBotIds,
    guildIcons,
    guildScheduleSourceByGuild:
      guildScheduleSourceByGuild as DiscordSettings["guildScheduleSourceByGuild"],
    cooldownInstanceTypesByGuild:
      cooldownInstanceTypesByGuild as DiscordSettings["cooldownInstanceTypesByGuild"],
    multiplierInstanceTypesByGuild:
      multiplierInstanceTypesByGuild as DiscordSettings["multiplierInstanceTypesByGuild"],
  };
};

export const DISCORD_SETTINGS = loadDiscordSettings();

// Mutated in place (not reassigned) so consumers that imported these arrays
// see refreshed contents after reloadDiscordSettings() runs.
export const PAYOUT_GUILD_IDS: string[] = [];
export const GUILD_SCHEDULE_GUILD_IDS: string[] = [];
/** Guilds where channel-scoped signup sheets are available as guild commands. */
export const SIGNUP_GUILD_IDS: string[] = [];

const refreshGuildIdLists = (): void => {
  PAYOUT_GUILD_IDS.splice(
    0,
    PAYOUT_GUILD_IDS.length,
    ...DISCORD_SETTINGS.payoutGuildIds,
  );
  GUILD_SCHEDULE_GUILD_IDS.splice(
    0,
    GUILD_SCHEDULE_GUILD_IDS.length,
    ...Object.keys(DISCORD_SETTINGS.guildScheduleSourceByGuild),
  );
  SIGNUP_GUILD_IDS.splice(
    0,
    SIGNUP_GUILD_IDS.length,
    ...new Set([...PAYOUT_GUILD_IDS, ...GUILD_SCHEDULE_GUILD_IDS]),
  );
};

refreshGuildIdLists();

/** Reloads the runtime aggregate after a guild setting is created or changed. */
export const reloadDiscordSettings = (): void => {
  Object.assign(DISCORD_SETTINGS, loadDiscordSettings());
  refreshGuildIdLists();
};
