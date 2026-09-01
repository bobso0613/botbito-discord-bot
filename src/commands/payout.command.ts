import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { getPayoutDetails } from "../services/payout.service.js";
import { buildPayoutEmbed } from "../templates/payout.template.js";
import type { Command } from "../types/command.js";

export const payoutCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("payout")
    .setDescription("Get your payout details") as SlashCommandBuilder,
  execute: async (interaction: ChatInputCommandInteraction) => {
    const details = await getPayoutDetails(interaction.user.id);
    const embed = buildPayoutEmbed(details);
    await interaction.reply({ embeds: [embed] });
  },
};
