import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";

export interface Command {
  data: SlashCommandBuilder;
  guildIds?: readonly string[];
  /** Registers this command in every guild that has a schedule settings file. */
  requiresGuildScheduleSettings?: boolean;
  /** Registers this command in every guild where the bot is installed. */
  registerInAllGuilds?: boolean;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}
