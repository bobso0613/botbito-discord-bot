import type { ChatInputCommandInteraction } from "discord.js";
import type { InteractionContext } from "../types/interaction-context.js";

export type { InteractionContext } from "../types/interaction-context.js";

/** Extracts user and guild presentation data from a slash command interaction. */
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
