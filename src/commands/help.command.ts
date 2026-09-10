import {
  ApplicationIntegrationType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { COMMAND_GUIDE } from "../constants/index.js";
import type { Command } from "../types/command.js";

type HelpInteraction = ChatInputCommandInteraction | ButtonInteraction;

/** Groups a command name to a section heading for the compact full-guide overview. */
const CATEGORY_BY_COMMAND_NAME: Record<string, string> = {
  "/payout": "Payout",
  "/payoutsummary": "Payout",
  "/guildsched": "Schedule",
  "/mysched": "Schedule",
  "/mycooldowns": "Schedule",
  "/help": "Info",
  "/newrun": "Signup Sheet",
  "/change all": "Signup Sheet",
  "/change roster": "Signup Sheet",
  "/change position": "Signup Sheet",
  "/name": "Signup Sheet",
  "/note": "Signup Sheet",
  "/setpic": "Signup Sheet",
  "/color": "Signup Sheet",
  "/setservertimezone": "Signup Sheet",
  "/setinstancetype": "Signup Sheet",
  "/clear": "Signup Sheet",
  "/swaporganizer": "Signup Sheet",
  "/show": "Signup Sheet",
  "/add": "Signup Roster",
  "/remove": "Signup Roster",
  "/swap": "Signup Roster",
  "/charnote": "Signup Roster",
  "/ping": "Signup Roster",
  "/postpone": "Signup Schedule",
  "/next": "Signup Schedule",
  "/gonow": "Signup Schedule",
  "/sdt": "Signup Schedule",
  "/when": "Signup Schedule",
};
const CATEGORY_ORDER = [
  "Payout",
  "Schedule",
  "Signup Roster",
  "Signup Schedule",
  "Signup Sheet",
  "Info",
];

/**
 * Sends the command guide for a slash-command or button interaction.
 * When `commandName` matches an entry in `COMMAND_GUIDE`, only that command's
 * full details (description and parameters) are shown. Otherwise, every
 * command is listed grouped by category in a compact one-line-per-command
 * format (used by the "Help" button), since Discord embeds cap at 25 fields
 * and the full command list has grown well past that.
 */
export const sendHelp = async (
  interaction: HelpInteraction,
  commandName?: string,
): Promise<void> => {
  const embed = new EmbedBuilder()
    .setTitle(commandName ? `Command Guide - ${commandName}` : "Command Guide")
    .setColor(0x5865f2)
    .setThumbnail(interaction.client.user?.avatarURL() || null)
    .setTimestamp();

  if (commandName) {
    const command = COMMAND_GUIDE.find((entry) => entry.name === commandName);
    if (command) {
      embed.addFields({
        name: `${command.emoji} \`${command.name}\``,
        value: command.description,
      });
      if (command.parameters && command.parameters.length > 0) {
        embed.addFields({
          name: "Parameters",
          value: command.parameters
            .map(
              (parameter) =>
                `• **${parameter.name}** ${parameter.required ? "(required)" : "(optional)"}: ${parameter.description}`,
            )
            .join("\n"),
        });
      }
    }
  } else {
    for (const category of CATEGORY_ORDER) {
      const commandsInCategory = COMMAND_GUIDE.filter(
        (command) =>
          (CATEGORY_BY_COMMAND_NAME[command.name] ?? "Info") === category,
      );
      if (!commandsInCategory.length) continue;
      embed.addFields({
        name: category,
        value: commandsInCategory
          .map(
            (command) =>
              `${command.emoji} \`${command.name}\` — ${command.description}`,
          )
          .join("\n"),
      });
    }
  }

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
};

/**
 * Responds to `/help`'s `command` autocomplete with up to 25 `COMMAND_GUIDE`
 * entries whose name contains the value typed so far (case-insensitive).
 */
export const handleHelpAutocomplete = async (
  interaction: AutocompleteInteraction,
): Promise<void> => {
  const focusedValue = interaction.options.getFocused().toLowerCase();
  const matches = COMMAND_GUIDE.filter((command) =>
    command.name.toLowerCase().includes(focusedValue),
  ).slice(0, 25);
  await interaction.respond(
    matches.map((command) => ({ name: command.name, value: command.name })),
  );
};

export const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Display a guide on available commands")
    .addStringOption((option) =>
      option
        .setName("command")
        .setDescription("Which command to show help for")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
    ) as SlashCommandBuilder,
  execute: async (interaction: ChatInputCommandInteraction) => {
    await sendHelp(interaction, interaction.options.getString("command", true));
  },
};
