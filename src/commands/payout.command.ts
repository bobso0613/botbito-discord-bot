import {
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { PAYOUT_GUILD_IDS } from "../config/discord-settings.js";
import { getPayoutDetails } from "../services/payout.service.js";
import { getCurrentlyVendingThreads } from "../services/signup-export.service.js";
import {
  buildPayoutEmbed,
  buildPayoutEmbedNotJoined,
} from "../templates/payout.template.js";
import type { Command } from "../types/command.js";
import { getInteractionContext } from "../utils/interaction-context.js";

export type PayoutInteraction = ChatInputCommandInteraction | ButtonInteraction;

/**
 * Sends the invoking member's sheet balances and qualifying signup-export vending threads.
 * Shows the not-joined response only when all balances are zero and no vending threads qualify.
 * @param interaction Slash-command or payout-status button interaction in a supported guild.
 * @param sendPrivately Whether to send the response ephemerally instead of publicly.
 */
export const sendPayout = async (
  interaction: PayoutInteraction,
  sendPrivately: boolean,
): Promise<void> => {
  if (!interaction.guildId || !PAYOUT_GUILD_IDS.includes(interaction.guildId)) {
    await interaction.reply({
      content:
        "This command is not available in this server because it has no configured payout data.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply(
    sendPrivately ? { flags: MessageFlags.Ephemeral } : {},
  );
  const context = getInteractionContext(interaction);
  const details = await getPayoutDetails({
    guildId: interaction.guildId,
    discordTag: context.discordTag,
  });
  const vendingThreads = await getCurrentlyVendingThreads(
    interaction.client,
    interaction.guildId,
    context.userId,
  );
  await interaction.editReply({
    embeds: [
      details.distributed !== 0 ||
      details.pending !== 0 ||
      details.shareReady !== 0 ||
      vendingThreads.length > 0
        ? buildPayoutEmbed(details, context, vendingThreads)
        : buildPayoutEmbedNotJoined(context),
    ],
  });
};

/** Gets the member's payout balances and current vending threads in a supported guild. */
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
    await sendPayout(
      interaction,
      interaction.options.getBoolean("sendprivately") ?? false,
    );
  },
};
