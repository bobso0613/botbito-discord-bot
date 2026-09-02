import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  DISCORD_SETTINGS,
  PAYOUT_GUILD_IDS,
} from "../config/discord-settings.js";
import { getPayoutDetails } from "../services/payout.service.js";
import {
  buildPayoutEmbed,
  buildPayoutEmbedNotJoined,
} from "../templates/payout.template.js";
import type { Command } from "../types/command.js";
import { getInteractionContext } from "../utils/interaction-context.js";

export const payoutCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("payout")
    .setDescription("Get your payout details") as SlashCommandBuilder,
  guildIds: PAYOUT_GUILD_IDS,
  execute: async (interaction: ChatInputCommandInteraction) => {
    if (
      !interaction.guildId ||
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
