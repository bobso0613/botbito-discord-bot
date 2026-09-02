import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  PAYOUT_CHANNEL_BY_GUILD,
  PAYOUT_GUILD_IDS,
} from "../constants/index.js";
import { getPayoutSummary } from "../services/payout.service.js";
import { buildPayoutSummaryEmbed } from "../templates/payout.template.js";
import type { Command } from "../types/command.js";
import {
  getDisplayNameByDiscordTag,
  resolvePayoutDisplayName,
} from "../utils/guild-members.js";
import { getInteractionContext } from "../utils/interaction-context.js";

export const payoutSummaryCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("payoutsummary")
    .setDescription(
      "View the server's Share Ready payout summary",
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
      interaction.channelId !== PAYOUT_CHANNEL_BY_GUILD[interaction.guildId]
    ) {
      const allowedChannelId = PAYOUT_CHANNEL_BY_GUILD[interaction.guildId];
      await interaction.reply({
        content: `This command is not allowed in this channel. Use it in <#${allowedChannelId}>.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    const context = getInteractionContext(interaction);
    const summary = await getPayoutSummary(interaction.guildId);
    const displayNameByDiscordTag = await getDisplayNameByDiscordTag(
      interaction.guild,
    );
    const summaryWithDisplayNames = {
      ...summary,
      shareReadyPayouts: summary.shareReadyPayouts.map((payout) => ({
        ...payout,
        displayName: resolvePayoutDisplayName(
          payout.discordTag,
          displayNameByDiscordTag,
        ),
      })),
    };
    const embed = buildPayoutSummaryEmbed(summaryWithDisplayNames, context);
    await interaction.editReply({ embeds: [embed] });
  },
};
