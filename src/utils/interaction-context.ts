import type { ChatInputCommandInteraction } from "discord.js";

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

export const getInteractionContext = (
  interaction: ChatInputCommandInteraction,
): InteractionContext => ({
  userId: interaction.user.id,
  username: interaction.user.username,
  discordTag: interaction.user.tag,
  displayName: interaction.user.displayName,
  userAvatarUrl: interaction.user.displayAvatarURL({
    extension: "png",
    size: 512,
  }),
  guildId: interaction.guildId,
  guildName: interaction.guild?.name ?? null,
  guildIconUrl:
    interaction.guild?.iconURL({ extension: "png", size: 512 }) ?? null,
});
