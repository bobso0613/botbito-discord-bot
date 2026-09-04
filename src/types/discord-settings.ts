/** Runtime Discord settings loaded from private/discord_settings.json. */
export interface DiscordSettings {
  /** Maps guild IDs to the text channel where payout commands are allowed. */
  payoutChannelByGuild: Readonly<Record<string, string>>;
  /** Discord user ID mentioned as the payout contact. */
  payoutToPingId: string;
  /** Display tag for the payout contact. */
  payoutToPingTag: string;
  /** User ID of the bot that posts guild schedule embeds. */
  guildScheduleBotId: string;
  /** Maps environment names to guild IDs and custom guild emoji mentions. */
  guildIcons: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Maps guild IDs to schedule source categories and optional restrictions. */
  guildScheduleSourceByGuild: Readonly<
    Record<
      string,
      {
        categoryId: string;
        allowedCommandChannelIds?: string[];
        excludedChannelIds?: string[];
        roleRestrictedChannels?: Readonly<Record<string, string>>;
      }
    >
  >;
}
