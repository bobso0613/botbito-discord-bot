import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { COMMAND_GUIDE } from "../constants/index.js";
import type { Command } from "../types/command.js";

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
