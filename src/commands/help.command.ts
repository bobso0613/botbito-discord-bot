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

export type HelpInteraction = ChatInputCommandInteraction | ButtonInteraction;

/** Groups a command name to a section heading for the compact full-guide overview. */
const CATEGORY_BY_COMMAND_NAME: Record<string, string> = {
  "/payout": "Payout",
  "/payoutsummary": "Payout",
  "/guildsched": "Schedule",
  "/mysched": "Schedule",
  "/mycooldowns": "Schedule",
  "/guildsetting show": "Administration",
  "/guildsetting set tracked-category": "Administration",
  "/guildsetting set excluded-channels": "Administration",
  "/guildsetting set schedule-channels": "Administration",
  "/guildsetting set role-restricted-channels": "Administration",
  "/guildsetting clear tracked-category": "Administration",
  "/guildsetting clear excluded-channels": "Administration",
  "/guildsetting clear schedule-channels": "Administration",
  "/guildsetting clear role-restricted-channels": "Administration",
  "/guildsetting set cooldown-instance-types": "Cooldown",
  "/guildsetting set multiplier-instance-types": "Cooldown",
  "/guildsetting clear cooldown-instance-types": "Cooldown",
  "/guildsetting clear multiplier-instance-types": "Cooldown",
  "/guildsetting remove cooldown-instance-type": "Cooldown",
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
  "/removecharnote": "Signup Roster",
  "/tbc": "Signup Roster",
  "/removetbc": "Signup Roster",
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
  "Administration",
  "Cooldown",
  "Signup Roster",
  "Signup Schedule",
  "Signup Sheet",
  "Info",
];

/**
 * Sends a private command guide for a slash-command or button interaction.
 * With `commandName`, shows that command's description and parameters;
 * without it, lists all commands by category (the "Help" button overview).
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
 * Responds to `/help`'s required `command` autocomplete with up to 25
 * case-insensitive substring matches from `COMMAND_GUIDE`.
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

/** Registers `/help` with a required autocomplete command selector. */
export const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Display help for a command")
    .addStringOption((option) =>
      option
        .setName("command")
        .setDescription("Choose a command to view its help")
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
