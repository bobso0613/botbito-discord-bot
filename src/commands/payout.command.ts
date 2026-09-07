import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { PAYOUT_GUILD_IDS } from "../config/discord-settings.js";
import { getPayoutDetails } from "../services/payout.service.js";
import {
  buildPayoutEmbed,
  buildPayoutEmbedNotJoined,
} from "../templates/payout.template.js";
import type { Command } from "../types/command.js";
import { getInteractionContext } from "../utils/interaction-context.js";

/** Gets the invoking member's payout details from any channel in a supported guild. */
export const payoutCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("payout")
    .setDescription("Get your payout details")
    .addBooleanOption((option) =>
      option
        .setName("sendprivately")
        .setDescription("Send the payout details privately")
        .setRequired(false),
    ) as SlashCommandBuilder,
  guildIds: PAYOUT_GUILD_IDS,
  execute: async (interaction: ChatInputCommandInteraction) => {
    if (
      !interaction.guildId ||
      !PAYOUT_GUILD_IDS.includes(interaction.guildId)
    ) {
      await interaction.reply({
        content:
          "This command is not available in this server because it has no configured payout data.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sendPrivately =
      interaction.options.getBoolean("sendprivately") ?? false;
    await interaction.deferReply(
      sendPrivately ? { flags: MessageFlags.Ephemeral } : {},
    );

    const guildId = interaction.guildId;
    const context = getInteractionContext(interaction);
    const details = await getPayoutDetails({
      guildId,
      discordTag: context.discordTag,
    });
    const embed =
      details.distributed !== 0 ||
      details.pending !== 0 ||
      details.shareReady !== 0
        ? buildPayoutEmbed(details, context)
        : buildPayoutEmbedNotJoined(context);
    await interaction.editReply({ embeds: [embed] });
  },
};
