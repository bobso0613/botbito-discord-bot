export interface DiscordSettings {
  payoutChannelByGuild: Readonly<Record<string, string>>;
  payoutToPingId: string;
  payoutToPingTag: string;
  guildScheduleBotId: string;
  guildScheduleSourceByGuild: Readonly<
    Record<
      string,
      {
        categoryId: string;
        allowedCommandChannelIds?: string[];
        excludedChannelIds?: string[];
      }
    >
  >;
}
