import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
} from "discord.js";
import {
  DISCORD_SETTINGS,
  GUILD_SCHEDULE_GUILD_IDS,
} from "../config/discord-settings.js";
import { getActiveGuildSchedules } from "../services/guild-schedule.service.js";
import {
  buildMyCooldownsEmbed,
  formatCooldownEntry,
} from "../templates/cooldowns.template.js";
import type { Command } from "../types/command.js";
import type { GuildSchedule } from "../types/guild-schedule.js";
import { countCooldowns } from "../utils/cooldowns.js";
import type { InstanceType } from "../constants/cooldowns.js";
import {
  getScheduleWeekTitle,
  getScheduleWeekWindow,
} from "../utils/guild-schedule.js";
import { getInteractionContext } from "../utils/interaction-context.js";

export type MyCooldownsInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction;

type GuildCooldownSchedules = {
  schedules: Array<GuildSchedule & { guildName: string }>;
  instanceTypes: readonly InstanceType[];
  multiplierInstanceTypes: readonly string[];
};

type CooldownCount = { type: InstanceType | null; count: number };
type GuildCooldownCounts = {
  instanceTypes: readonly InstanceType[];
  counts: Map<string, CooldownCount>;
};

/** Transitive exact-alias merges across guilds; similar names stay separate. */
export const mergeGuildCooldownCounts = (
  guildCounts: readonly GuildCooldownCounts[],
): Map<string, CooldownCount> => {
  const entries = guildCounts.flatMap(({ instanceTypes, counts }, guildIndex) =>
    instanceTypes
      .filter((type) => type.name !== "Others")
      .flatMap((type) => {
        const count = counts.get(type.name);
        return count ? [{ type, count: count.count, guildIndex }] : [];
      }),
  );
  const parents = entries.map((_, index) => index);
  const find = (index: number): number => {
    if (parents[index] !== index) parents[index] = find(parents[index]!);
    return parents[index]!;
  };
  const aliases = entries.map(
    ({ type }) =>
      new Set(
        [type.name, ...type.keywords].map((alias) =>
          alias.trim().toLowerCase(),
        ),
      ),
  );
  for (let first = 0; first < entries.length; first++) {
    for (let second = first + 1; second < entries.length; second++) {
      if (entries[first]!.guildIndex === entries[second]!.guildIndex) continue;
      if (![...aliases[first]!].some((alias) => aliases[second]!.has(alias)))
        continue;
      parents[find(second)] = find(first);
    }
  }

  const groups = new Map<number, typeof entries>();
  entries.forEach((entry, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), entry]);
  });

  const merged = new Map<string, CooldownCount>();
  for (const group of groups.values()) {
    const type = group[0]!.type;
    merged.set(type.name, {
      type: {
        ...type,
        maxAttempts: Math.max(
          ...group.map(({ type: item }) => item.maxAttempts),
        ),
      },
      count: group.reduce((total, entry) => total + entry.count, 0),
    });
  }

  const otherCounts = guildCounts.flatMap(({ counts }) => {
    const other = counts.get("Others");
    return other ? [other] : [];
  });
  if (otherCounts.length) {
    merged.set("Others", {
      type: otherCounts[0]!.type,
      count: otherCounts.reduce((total, entry) => total + entry.count, 0),
    });
  }
  return merged;
};

/** Gets active signed-up and reserve schedules for the current schedule week. */
const getAccessibleGuildSchedules = async (
  guild: Guild,
  member: GuildMember,
): Promise<GuildCooldownSchedules> => {
  const source = DISCORD_SETTINGS.guildScheduleSourceByGuild[guild.id];
  const empty = {
    schedules: [],
    instanceTypes: [],
    multiplierInstanceTypes: [],
  } satisfies GuildCooldownSchedules;
  if (
    !source ||
    (source.categoryIds.length === 0 &&
      source.scheduleTextChannelIds.length === 0)
  )
    return empty;

  const schedules = await getActiveGuildSchedules(
    guild,
    member,
    source.categoryIds,
    [],
    getScheduleWeekWindow(),
    source.roleRestrictedChannels,
  );
  return {
    schedules: schedules
      .filter((schedule) => schedule.isSignedUp || schedule.isReserve)
      .map((schedule) => ({ ...schedule, guildName: guild.name })),
    instanceTypes:
      DISCORD_SETTINGS.cooldownInstanceTypesByGuild[guild.id] ?? [],
    multiplierInstanceTypes:
      DISCORD_SETTINGS.multiplierInstanceTypesByGuild[guild.id] ?? [],
  };
};

/** Shows cooldown status for this week across the member's guilds. */
export const sendMyCooldowns = async (
  interaction: MyCooldownsInteraction,
  showInPublic = false,
): Promise<void> => {
  await interaction.deferReply(
    interaction.guildId && !showInPublic
      ? { flags: MessageFlags.Ephemeral }
      : {},
  );
  const schedulesByGuild = await Promise.all(
    GUILD_SCHEDULE_GUILD_IDS.map(async (guildId) => {
      const guild = interaction.client.guilds.cache.get(guildId);
      if (!guild)
        return {
          schedules: [],
          instanceTypes: [],
          multiplierInstanceTypes: [],
        } satisfies GuildCooldownSchedules;
      try {
        return getAccessibleGuildSchedules(
          guild,
          await guild.members.fetch(interaction.user.id),
        );
      } catch {
        return {
          schedules: [],
          instanceTypes: [],
          multiplierInstanceTypes: [],
        } satisfies GuildCooldownSchedules;
      }
    }),
  );
  const allSchedules = schedulesByGuild.flatMap(({ schedules }) => schedules);
  const cooldownMap = mergeGuildCooldownCounts(
    schedulesByGuild.map((guildSettings) => ({
      instanceTypes: guildSettings.instanceTypes,
      counts: countCooldowns(
        guildSettings.schedules,
        guildSettings.instanceTypes,
        guildSettings.multiplierInstanceTypes,
      ),
    })),
  );
  const guildsWithSignups = Array.from(
    new Set(allSchedules.map((schedule) => schedule.guildName)),
  ).sort((first, second) => first.localeCompare(second));
  const sortedCooldowns = Array.from(cooldownMap.entries()).sort(
    ([first], [second]) => {
      if (first === "Others") return 1;
      if (second === "Others") return -1;
      return first.localeCompare(second);
    },
  );
  const dateRange = getScheduleWeekTitle(getScheduleWeekWindow()).split(
    " - ",
  )[1];
  const cooldownText = sortedCooldowns
    .map(([, { type, count }]) => formatCooldownEntry(type, count))
    .join("\n");
  const embed = buildMyCooldownsEmbed(
    cooldownText,
    dateRange,
    guildsWithSignups,
    getInteractionContext(interaction),
  );
  await interaction.editReply({ embeds: [embed] });
};

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
    await sendMyCooldowns(
      interaction,
      interaction.options.getBoolean("showinpublic") ?? false,
    );
  },
};
