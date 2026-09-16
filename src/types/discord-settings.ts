import type { InstanceType } from "../constants/cooldowns.js";

/** Runtime Discord settings loaded from private/discord_settings.json. */
export interface DiscordSettings {
  /** Guild IDs where payout commands are registered. */
  payoutGuildIds: readonly string[];
  /** Discord user ID mentioned as the payout contact. */
  payoutToPingId: string;
  /** Display tag for the payout contact. */
  payoutToPingTag: string;
  /** User IDs of bots that post guild schedule embeds. */
  guildScheduleBotIds: readonly string[];
  /** Maps environment names to guild IDs and custom guild emoji mentions. */
  guildIcons: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Maps guild IDs to schedule source categories and optional restrictions. */
  guildScheduleSourceByGuild: Readonly<
    Record<
      string,
      {
        categoryIds: string[];
        scheduleTextChannelIds: string[];
        excludedChannelIds?: string[];
        roleRestrictedChannels?: Readonly<Record<string, string>>;
      }
    >
  >;
  /** Cooldown instance definitions by guild. */
  cooldownInstanceTypesByGuild: Readonly<
    Record<string, readonly InstanceType[]>
  >;
  /** Multiplier-enabled instance names by guild. */
  multiplierInstanceTypesByGuild: Readonly<Record<string, readonly string[]>>;
}

/** Settings stored in private/guild-settings/<guild-id>.json. */
export interface GuildSettings {
  /** Source categories and optional restrictions for this guild's schedules. */
  guildScheduleSource: DiscordSettings["guildScheduleSourceByGuild"][string];
  /** Cooldown instance definitions selectable for this guild. */
  cooldownInstanceTypes: InstanceType[];
  /** Instance names that support title multipliers for this guild. */
  multiplierInstanceTypes: string[];
  /** Maps environment names to custom guild emoji mentions. */
  guildIcons: Readonly<Record<string, string>>;
}
