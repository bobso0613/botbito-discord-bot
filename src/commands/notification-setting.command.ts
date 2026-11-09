import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  SlashCommandSubcommandGroupBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Command } from "../types/command.js";
import { updateUserNotificationSetting } from "../services/guild-settings.service.js";

/** DM-producing actions whose participant delivery checks this preference. */
export const notificationControlledActions = ["/set share status"] as const;

export const createNotificationSettingGroup = () =>
  new SlashCommandSubcommandGroupBuilder()
    .setName("notification")
    .setDescription(
      "Your notification preferences in this server (DM notifications only of some commands)",
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("setting")
        .setDescription(
          "Turn bot DM notifications On or Off in this server (some commands only)",
        )
        .addStringOption((option) =>
          option
            .setName("setting")
            .setDescription("Notification preference")
            .setRequired(true)
            .addChoices(
              { name: "On", value: "on" },
              { name: "Off", value: "off" },
            ),
        ),
    );

export const setNotificationSetting = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (!interaction.guildId || !interaction.guild) {
      throw new Error("This command is only available in a server.");
    }
    const setting = interaction.options.getString("setting", true);
    if (setting !== "on" && setting !== "off") {
      throw new Error("Choose On or Off.");
    }
    await updateUserNotificationSetting(
      interaction.guildId,
      interaction.user.id,
      setting === "on",
    );
    const confirmation = `you have set your notification settings in ${interaction.guild.name} as ${setting === "on" ? "On" : "Off"}`;
    const disabledActions =
      setting === "off"
        ? [
            "",
            "The following commands/actions will no longer DM you in this server:",
            ...notificationControlledActions.map((action) => `- \`${action}\``),
          ]
        : [];
    await interaction.editReply({
      content: [confirmation, ...disabledActions].join("\n"),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply({
      content: `Could not set notification settings: ${message.slice(0, 250)}`,
      allowedMentions: { parse: [] },
    });
  }
};

export const notificationSettingCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("set")
    .setDescription("Set your preferences")
    .addSubcommandGroup(createNotificationSettingGroup())
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild) as SlashCommandBuilder,
  execute: setNotificationSetting,
};
