import {
  ApplicationIntegrationType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { COMMAND_GUIDE } from "../constants/index.js";
import type { Command } from "../types/command.js";

export const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Display a guide on available commands")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
    ) as SlashCommandBuilder,
  execute: async (interaction: ChatInputCommandInteraction) => {
    const embed = new EmbedBuilder()
      .setTitle("Command Guide")
      .setColor(0x5865f2)
      .addFields(
        COMMAND_GUIDE.flatMap((command) => {
          const fields = [
            {
              name: `${command.emoji} \`${command.name}\``,
              value: command.description,
            },
          ];
          if (command.parameters && command.parameters.length > 0) {
            const parameterText = command.parameters
              .map(
                (param) =>
                  `• **${param.name}** ${param.required ? "(required)" : "(optional)"}: ${param.description}`,
              )
              .join("\n");
            fields.push({
              name: "Parameters",
              value: parameterText,
            });
          }
          return fields;
        }),
      )
      .setThumbnail(interaction.client.user?.avatarURL() || null)
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  },
};
