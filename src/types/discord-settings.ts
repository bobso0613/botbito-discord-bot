export interface DiscordSettings {
  payoutChannelByGuild: Readonly<Record<string, string>>;
  payoutToPingId: string;
  payoutToPingTag: string;
}
