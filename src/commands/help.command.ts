import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Command } from "../types/command.js";

// Maintain this list whenever commands are added, removed, or changed.
const COMMAND_GUIDE: { name: string; description: string }[] = [
  { name: "/payout", description: "Get your payout details" },
  { name: "/help", description: "Display this guide" },
];

export const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription(
      "Display a guide on available commands",
    ) as SlashCommandBuilder,
  execute: async (interaction: ChatInputCommandInteraction) => {
    const embed = new EmbedBuilder()
      .setTitle("Command Guide")
      .setColor(0x5865f2)
      .addFields(
        COMMAND_GUIDE.map((command) => ({
          name: command.name,
          value: command.description,
        })),
      )
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  },
};
