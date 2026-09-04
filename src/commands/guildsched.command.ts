import {
  ChannelType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  DISCORD_SETTINGS,
  GUILD_SCHEDULE_GUILD_IDS,
} from "../config/discord-settings.js";
import { getActiveGuildSchedules } from "../services/guild-schedule.service.js";
import { buildGuildScheduleEmbed } from "../templates/guild-schedule.template.js";
import type { Command } from "../types/command.js";
import { getInteractionContext } from "../utils/interaction-context.js";

const isAllowedScheduleCommandChannel = (
  interaction: ChatInputCommandInteraction,
  categoryId: string,
  allowedChannelIds: readonly string[] = [],
): boolean =>
  interaction.channel?.type === ChannelType.GuildText &&
  (interaction.channel.parentId === categoryId ||
    allowedChannelIds.includes(interaction.channelId));

/** Displays active, accessible guild run schedules for the invoking member. */
export const guildSchedCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("guildsched")
    .setDescription("View active schedules for this guild")
    .addBooleanOption((option) =>
      option
        .setName("public")
        .setDescription("Show your schedules to everyone in this channel"),
    ) as SlashCommandBuilder,
  guildIds: GUILD_SCHEDULE_GUILD_IDS,
  execute: async (interaction: ChatInputCommandInteraction) => {
    const source = interaction.guildId
      ? DISCORD_SETTINGS.guildScheduleSourceByGuild[interaction.guildId]
      : undefined;

    if (
      !source ||
      !interaction.guild ||
      !isAllowedScheduleCommandChannel(
        interaction,
        source.categoryId,
        source.allowedCommandChannelIds,
      )
    ) {
      await interaction.reply({
        content:
          "This command is only available in the configured schedule channels.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const isPublic = interaction.options.getBoolean("public") ?? false;

    // Build excluded channels list based on role restrictions
    let excludedChannelsForPublic = source.excludedChannelIds ?? [];
    if (isPublic && source.roleRestrictedChannels) {
      // Check if the current channel is role-restricted
      const currentChannelRequiredRole =
        source.roleRestrictedChannels[interaction.channelId];
      if (currentChannelRequiredRole) {
        // User is invoking in a role-restricted channel
        if (member.roles.cache.has(currentChannelRequiredRole)) {
          // User has the required role, allow this channel (remove from excluded if present)
          excludedChannelsForPublic = excludedChannelsForPublic.filter(
            (channelId) => channelId !== interaction.channelId,
          );
        } else {
          // User doesn't have the required role, exclude this channel
          excludedChannelsForPublic = [
            ...excludedChannelsForPublic,
            interaction.channelId,
          ];
        }
      } else {
        // Current channel is not role-restricted, so exclude all role-restricted channels
        excludedChannelsForPublic = [
          ...excludedChannelsForPublic,
          ...Object.keys(source.roleRestrictedChannels),
        ];
      }
    }

    await interaction.deferReply(
      isPublic ? {} : { flags: MessageFlags.Ephemeral },
    );

    const schedules = await getActiveGuildSchedules(
      interaction.guild,
      member,
      source.categoryId,
      isPublic ? excludedChannelsForPublic : undefined,
    );
    const context = getInteractionContext(interaction);
    const categoryName =
      interaction.guild.channels.cache.get(source.categoryId)?.name ??
      "configured category";
    const embed = buildGuildScheduleEmbed(schedules, context, categoryName);

    await interaction.editReply({ embeds: [embed] });
  },
};
