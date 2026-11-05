import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { InteractionContext } from "../types/interaction-context.js";
import { logger } from "./logger.js";

export type { InteractionContext } from "../types/interaction-context.js";

export const replyWithFailureMessage = async (
  interaction:
    | ButtonInteraction
    | ChatInputCommandInteraction
    | ModalSubmitInteraction
    | StringSelectMenuInteraction,
  message: string,
): Promise<void> => {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message);
    } else {
      await interaction.reply({
        content: message,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    logger.error("Failed to send interaction error response:", error);
  }
};

/** Extracts user and guild presentation data from a command or button interaction. */
export const getInteractionContext = (
  interaction: ChatInputCommandInteraction | ButtonInteraction,
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
