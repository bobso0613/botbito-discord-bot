import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";

export interface Command {
  data: SlashCommandBuilder;
  guildIds?: readonly string[];
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}
