import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  DISCORD_SETTINGS,
  GUILD_SCHEDULE_GUILD_IDS,
} from "../config/discord-settings.js";
import { getActiveGuildSchedules } from "../services/guild-schedule.service.js";
import {
  buildGuildScheduleEmbed,
  buildMyScheduleButtonRow,
} from "../templates/guild-schedule.template.js";
import type { Command } from "../types/command.js";
import { getInteractionContext } from "../utils/interaction-context.js";

/**
 * Displays active, accessible guild run schedules for the invoking member.
 * Available to all members of the guild.
 * When public=true, role-restricted channels are shown with a "(Private run)" label instead of direct links.
 */
export const guildSchedCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("guildsched")
    .setDescription("View active schedules for this guild")
    .addBooleanOption((option) =>
      option
        .setName("public")
        .setDescription("Show your schedules to everyone in this channel"),
    )
    .addBooleanOption((option) =>
      option
        .setName("forannouncementonly")
        .setDescription("Hide signup details in a public announcement"),
    ) as SlashCommandBuilder,
  guildIds: GUILD_SCHEDULE_GUILD_IDS,
  execute: async (interaction: ChatInputCommandInteraction) => {
    const source = interaction.guildId
      ? DISCORD_SETTINGS.guildScheduleSourceByGuild[interaction.guildId]
      : undefined;

    if (!source || !interaction.guild) {
      await interaction.reply({
        content: "This command is not available for this guild.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guild = interaction.guild;
    const member = await guild.members.fetch(interaction.user.id);
    const isPublic = interaction.options.getBoolean("public") ?? false;
    const isForAnnouncementOnly =
      isPublic &&
      (interaction.options.getBoolean("forannouncementonly") ?? false);

    await interaction.deferReply(
      isPublic ? {} : { flags: MessageFlags.Ephemeral },
    );

    // Build excluded channels list - only truly excluded channels, not role-restricted ones
    const excludedChannels = (source.excludedChannelIds ?? []).filter(
      (channelId) =>
        !source.roleRestrictedChannels ||
        !(channelId in source.roleRestrictedChannels),
    );

    const schedules = await getActiveGuildSchedules(
      guild,
      member,
      source.categoryIds,
      excludedChannels,
      undefined,
      source.roleRestrictedChannels,
    );
    const context = getInteractionContext(interaction);
    const categoryNames = source.categoryIds
      .map((id) => guild.channels.cache.get(id)?.name)
      .filter((name): name is string => Boolean(name));
    const embed = buildGuildScheduleEmbed(
      schedules,
      context,
      categoryNames.length > 0 ? categoryNames : ["configured categories"],
      isForAnnouncementOnly,
      isPublic,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [buildMyScheduleButtonRow()],
    });
  },
};
