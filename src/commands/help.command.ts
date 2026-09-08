import {
  ApplicationIntegrationType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { COMMAND_GUIDE } from "../constants/index.js";
import type { Command } from "../types/command.js";

type HelpInteraction = ChatInputCommandInteraction | ButtonInteraction;

/** Sends the private command guide for a slash-command or button interaction. */
export const sendHelp = async (interaction: HelpInteraction): Promise<void> => {
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
          fields.push({
            name: "Parameters",
            value: command.parameters
              .map(
                (parameter) =>
                  `• **${parameter.name}** ${parameter.required ? "(required)" : "(optional)"}: ${parameter.description}`,
              )
              .join("\n"),
          });
        }
        return fields;
      }),
    )
    .setThumbnail(interaction.client.user?.avatarURL() || null)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
};

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
    await sendHelp(interaction);
  },
};
