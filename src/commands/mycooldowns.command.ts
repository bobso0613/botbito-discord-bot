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
import type { GuildSchedule } from "../types/guild-schedule.js";
import type { Command } from "../types/command.js";
import {
  getScheduleWeekTitle,
  getScheduleWeekWindow,
} from "../utils/guild-schedule.js";
import { countCooldowns } from "../utils/cooldowns.js";
import { getInteractionContext } from "../utils/interaction-context.js";
import {
  buildMyCooldownsEmbed,
  formatCooldownEntry,
} from "../templates/cooldowns.template.js";

/**
 * Gets active schedules in a configured schedule guild that the member can see.
 * Personal schedules include only runs where the member is signed up or reserve.
 */
const getAccessibleGuildSchedules = async (
  guild: Guild,
  member: GuildMember,
): Promise<Array<GuildSchedule & { guildName: string }>> => {
  const source = DISCORD_SETTINGS.guildScheduleSourceByGuild[guild.id];

  if (!source) {
    return [];
  }

  const schedules = await getActiveGuildSchedules(
    guild,
    member,
    source.categoryId,
    [],
    getScheduleWeekWindow(), // Always use this week only for cooldowns
  );
  return schedules
    .filter((schedule) => schedule.isSignedUp || schedule.isReserve)
    .map((schedule) => ({
      ...schedule,
      guildName: guild.name,
    }));
};

/** Shows cooldown status for this week across the member's guilds. */
export const myCooldowsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("mycooldowns")
    .setDescription("View your weekly cooldown status across accessible guilds")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .addBooleanOption((option) =>
      option
        .setName("showinpublic")
        .setDescription(
          "Show your cooldown status to everyone in this channel",
        ),
    ) as SlashCommandBuilder,
  execute: async (interaction: ChatInputCommandInteraction) => {
    const isGuildInvocation = Boolean(interaction.guildId);
    const showInPublic =
      interaction.options.getBoolean("showinpublic") ?? false;

    await interaction.deferReply(
      isGuildInvocation && !showInPublic
        ? { flags: MessageFlags.Ephemeral }
        : {},
    );

    const schedulesByGuild = await Promise.all(
      GUILD_SCHEDULE_GUILD_IDS.map(async (guildId) => {
        const guild = interaction.client.guilds.cache.get(guildId);
        if (!guild) return [];

        try {
          const member = await guild.members.fetch(interaction.user.id);
          return getAccessibleGuildSchedules(guild, member);
        } catch {
          return [];
        }
      }),
    );

    const allSchedules = schedulesByGuild.flat();
    const cooldownMap = countCooldowns(allSchedules);

    // Get list of unique guild names with signups
    const guildsWithSignups = Array.from(
      new Set(allSchedules.map((s) => s.guildName)),
    ).sort();

    // Sort by instance type name, with Others at the end
    const sortedCooldowns = Array.from(cooldownMap.entries()).sort(
      ([keyA], [keyB]) => {
        const aIsOthers = keyA === "Others";
        const bIsOthers = keyB === "Others";
        if (aIsOthers && !bIsOthers) return 1;
        if (!aIsOthers && bIsOthers) return -1;
        return keyA.localeCompare(keyB);
      },
    );

    // Get week title for date range
    const weekWindow = getScheduleWeekWindow();
    const weekTitle = getScheduleWeekTitle(weekWindow);
    // Extract just the date part ("04 Sep to 10 Sep")
    const dateRange = weekTitle.split(" - ")[1];

    const cooldownText = sortedCooldowns
      .map(([, { type, count }]) => formatCooldownEntry(type, count))
      .join("\n");

    const context = getInteractionContext(interaction);
    const embed = buildMyCooldownsEmbed(
      cooldownText,
      dateRange,
      guildsWithSignups,
      context,
    );

    await interaction.editReply({ embeds: [embed] });
  },
};
