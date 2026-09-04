import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
} from "discord.js";
import {
  DISCORD_SETTINGS,
  GUILD_SCHEDULE_GUILD_IDS,
} from "../config/discord-settings.js";
import { getActiveGuildSchedules } from "../services/guild-schedule.service.js";
import { buildMyScheduleEmbed } from "../templates/guild-schedule.template.js";
import type {
  GuildSchedule,
  GuildScheduleTimeWindow,
  MyScheduleGrouping,
} from "../types/guild-schedule.js";
import type { Command } from "../types/command.js";
import {
  getGuildIcon,
  getScheduleUnixSeconds,
  getScheduleWeekTitle,
  getScheduleWeekWindow,
} from "../utils/guild-schedule.js";
import { getInteractionContext } from "../utils/interaction-context.js";

/**
 * Gets active schedules in a configured schedule guild that the member can see.
 * Personal schedules include only runs where the member is signed up or reserve.
 */
const getAccessibleGuildSchedules = async (
  guild: Guild,
  member: GuildMember,
  timeWindow?: GuildScheduleTimeWindow,
): Promise<GuildSchedule[]> => {
  const source = DISCORD_SETTINGS.guildScheduleSourceByGuild[guild.id];

  if (!source) {
    return [];
  }

  const guildIcon = getGuildIcon(guild.id);
  const schedules = await getActiveGuildSchedules(
    guild,
    member,
    source.categoryId,
    [],
    timeWindow,
  );
  return schedules
    .filter((schedule) => schedule.isSignedUp || schedule.isReserve)
    .map((schedule) => ({
      ...schedule,
      guildName: guild.name,
      guildIcon,
    }));
};

/** Sends signed-up and reserve schedules across the member's guilds by DM. */
export const mySchedCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("mysched")
    .setDescription("DM your active schedules across accessible guilds")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .addBooleanOption((option) =>
      option
        .setName("thisweekonly")
        .setDescription(
          "Show signed-up and reserve schedules from this schedule week",
        ),
    )
    .addStringOption((option) =>
      option
        .setName("grouping")
        .setDescription("Choose how your schedules are grouped")
        .addChoices(
          { name: "By Date", value: "date" },
          { name: "By Guild", value: "guild" },
        ),
    ) as SlashCommandBuilder,
  execute: async (interaction: ChatInputCommandInteraction) => {
    const isGuildInvocation = Boolean(interaction.guildId);
    const thisWeekOnly =
      interaction.options.getBoolean("thisweekonly") ?? false;
    const scheduleWeekWindow = thisWeekOnly
      ? getScheduleWeekWindow()
      : undefined;
    const grouping =
      (interaction.options.getString(
        "grouping",
      ) as MyScheduleGrouping | null) ?? "date";

    await interaction.deferReply(
      isGuildInvocation ? { flags: MessageFlags.Ephemeral } : {},
    );

    const schedulesByGuild = await Promise.all(
      GUILD_SCHEDULE_GUILD_IDS.map(async (guildId) => {
        const guild = interaction.client.guilds.cache.get(guildId);
        if (!guild) return [];

        try {
          const member = await guild.members.fetch(interaction.user.id);
          return getAccessibleGuildSchedules(guild, member, scheduleWeekWindow);
        } catch {
          return [];
        }
      }),
    );
    const schedules = schedulesByGuild
      .flat()
      .sort(
        (first, second) =>
          getScheduleUnixSeconds(first) - getScheduleUnixSeconds(second),
      );
    const context = getInteractionContext(interaction);
    const embed = buildMyScheduleEmbed(
      schedules,
      context,
      grouping,
      scheduleWeekWindow ? getScheduleWeekTitle(scheduleWeekWindow) : undefined,
    );

    try {
      await interaction.user.send({ embeds: [embed] });
      await interaction.editReply({ content: "Scheduled sent to your DM" });
    } catch {
      await interaction.editReply({
        content: "I couldn't send your schedules by DM.",
      });
    }
  },
};
