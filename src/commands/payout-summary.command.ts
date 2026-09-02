import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  DISCORD_SETTINGS,
  PAYOUT_GUILD_IDS,
} from "../config/discord-settings.js";
import { getPayoutSummary } from "../services/payout.service.js";
import { buildPayoutSummaryEmbed } from "../templates/payout.template.js";
import type { Command } from "../types/command.js";
import type { PayoutSort, PayoutSortDirection } from "../types/payout.js";
import {
  getDisplayNameByDiscordTag,
  resolvePayoutDisplayName,
} from "../utils/guild-members.js";
import { getInteractionContext } from "../utils/interaction-context.js";
import { sortShareReadyPayouts } from "../utils/payout-summary.js";

export const payoutSummaryCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("payoutsummary")
    .setDescription("View the server's Share Ready payout summary")
    .addStringOption((option) =>
      option
        .setName("sort")
        .setDescription("Sort payouts by name or Share Ready amount")
        .setRequired(false)
        .addChoices(
          { name: "Name", value: "name" },
          { name: "Share Ready amount", value: "amount" },
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
          "This command is not available in this server because it has no permitted payout channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (
      interaction.channelId !==
      DISCORD_SETTINGS.payoutChannelByGuild[interaction.guildId]
    ) {
      const allowedChannelId =
        DISCORD_SETTINGS.payoutChannelByGuild[interaction.guildId];
      await interaction.reply({
        content: `This command is not allowed in this channel. Use it in <#${allowedChannelId}>.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    const context = getInteractionContext(interaction);
    const sortBy = (interaction.options.getString("sort") ??
      "amount") as PayoutSort;
    const direction = (interaction.options.getString("direction") ??
      "desc") as PayoutSortDirection;
    const summary = await getPayoutSummary(
      interaction.guildId,
      sortBy,
      direction,
    );
    const displayNameByDiscordTag = await getDisplayNameByDiscordTag(
      interaction.guild,
    );
    const summaryWithDisplayNames = {
      ...summary,
      shareReadyPayouts: sortShareReadyPayouts(
        summary.shareReadyPayouts.map((payout) => ({
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
