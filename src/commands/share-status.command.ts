import {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { PAYOUT_GUILD_IDS } from "../config/discord-settings.js";
import type { Command } from "../types/command.js";
import type { ShareFinalizationStatus } from "../types/signup-export.js";
import {
  finalizeShareStatus,
  shareStatusChoices,
} from "../services/share-status.service.js";

const safeError = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 250);

const getSelectedStatus = (
  interaction: ChatInputCommandInteraction,
): ShareFinalizationStatus => {
  const status = interaction.options.getString(
    "status",
    true,
  ) as ShareFinalizationStatus;
  if (!shareStatusChoices.some((choice) => choice.value === status)) {
    throw new Error("Choose a valid payout share status.");
  }
  return status;
};

const replyWithError = async (
  interaction: ChatInputCommandInteraction,
  error: unknown,
): Promise<void> => {
  await interaction.editReply({
    content: `Could not set share status: ${safeError(error)}`,
    allowedMentions: { parse: [] },
  });
};

/** Registers `/set share status` in payout guilds and dispatches finalization to its service. */
export const setShareStatusCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("set")
    .setDescription("Set a payout share status")
    .addSubcommandGroup((group) =>
      group
        .setName("share")
        .setDescription("Payout share actions")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("status")
            .setDescription("Finalize the payout status in this thread")
            .addStringOption((option) =>
              option
                .setName("status")
                .setDescription("Final status for this run")
                .setRequired(true)
                .addChoices(...shareStatusChoices),
            ),
        ),
    )
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild) as SlashCommandBuilder,
  guildIds: PAYOUT_GUILD_IDS,
  execute: async (interaction: ChatInputCommandInteraction) => {
    await interaction.deferReply();
    try {
      if (
        !interaction.guildId ||
        !PAYOUT_GUILD_IDS.includes(interaction.guildId)
      ) {
        throw new Error(
          "This command is only available in a payout-enabled server.",
        );
      }
      await finalizeShareStatus(interaction, getSelectedStatus(interaction));
    } catch (error) {
      await replyWithError(interaction, error);
    }
  },
};
