export interface InteractionContext {
  userId: string;
  username: string;
  discordTag: string;
  displayName: string;
  userAvatarUrl: string;
  guildId: string | null;
  guildName: string | null;
  guildIconUrl: string | null;
}
