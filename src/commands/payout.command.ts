import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { getPayoutDetails } from "../services/payout.service.js";
import { buildPayoutEmbed } from "../templates/payout.template.js";
import type { Command } from "../types/command.js";
import { getInteractionContext } from "../utils/interaction-context.js";

const PAYOUT_GUILD_IDS: readonly string[] = [
  "499171225046876170",
  "92073842977030144",
  "1115484031455346718",
];

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
        content: "This command is not available in this server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guildId;
    const context = getInteractionContext(interaction);
    const details = await getPayoutDetails({
      guildId,
      discordTag: context.discordTag,
    });
    const embed = buildPayoutEmbed(details, context);
    await interaction.reply({ embeds: [embed] });
  },
};
