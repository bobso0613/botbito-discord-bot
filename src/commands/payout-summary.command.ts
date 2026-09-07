import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { PAYOUT_GUILD_IDS } from "../config/discord-settings.js";
import { getPayoutSummary } from "../services/payout.service.js";
import { buildPayoutSummaryEmbed } from "../templates/payout.template.js";
import type { Command } from "../types/command.js";
import type {
  PayoutAmount,
  PayoutSort,
  PayoutSortDirection,
} from "../types/payout.js";
import {
  getDisplayNameByDiscordTag,
  resolvePayoutDisplayName,
} from "../utils/guild-members.js";
import { getInteractionContext } from "../utils/interaction-context.js";
import { sortPayouts } from "../utils/payout-summary.js";

/** Lists the guild payout summary from any channel in a supported guild. */
export const payoutSummaryCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("payoutsummary")
    .setDescription("View the server's payout summary")
    .addStringOption((option) =>
      option
        .setName("amount")
        .setDescription("Choose which payout amount to show")
        .setRequired(false)
        .addChoices(
          { name: "Share Ready", value: "shareReady" },
          { name: "Pending", value: "pending" },
          { name: "Distributed", value: "distributed" },
        ),
    )
    .addBooleanOption((option) =>
      option
        .setName("sendprivately")
        .setDescription("Send the payout summary privately")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("sort")
        .setDescription("Sort payouts by name or amount")
        .setRequired(false)
        .addChoices(
          { name: "Name", value: "name" },
          { name: "Amount", value: "amount" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("direction")
        .setDescription("Sort direction")
        .setRequired(false)
        .addChoices(
          { name: "Ascending", value: "asc" },
          { name: "Descending", value: "desc" },
        ),
    ) as SlashCommandBuilder,
  guildIds: PAYOUT_GUILD_IDS,
  execute: async (interaction: ChatInputCommandInteraction) => {
    if (
      !interaction.guildId ||
      !interaction.guild ||
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

    const context = getInteractionContext(interaction);
    const amount = (interaction.options.getString("amount") ??
      "shareReady") as PayoutAmount;
    const sortBy = (interaction.options.getString("sort") ??
      "amount") as PayoutSort;
    const direction = (interaction.options.getString("direction") ??
      "desc") as PayoutSortDirection;
    const summary = await getPayoutSummary(
      interaction.guildId,
      amount,
      sortBy,
      direction,
    );
    const displayNameByDiscordTag = await getDisplayNameByDiscordTag(
      interaction.guild,
    );
    const summaryWithDisplayNames = {
      ...summary,
      payouts: sortPayouts(
        summary.payouts.map((payout) => ({
          ...payout,
          displayName: resolvePayoutDisplayName(
            payout.discordTag,
            displayNameByDiscordTag,
          ),
        })),
        sortBy,
        direction,
      ),
    };
    const embed = buildPayoutSummaryEmbed(summaryWithDisplayNames, context);
    await interaction.editReply({ embeds: [embed] });
  },
};
