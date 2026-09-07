import { EmbedBuilder } from "discord.js";
import type {
  GuildSchedule,
  MyScheduleGrouping,
} from "../types/guild-schedule.js";
import { parseInstanceTypes } from "../utils/cooldowns.js";
import type { InteractionContext } from "../types/interaction-context.js";
import { getScheduleTitleIcon } from "../utils/guild-schedule.js";
import { getEmbedFooter } from "../utils/payout-embed.js";

const getScheduleStatusIndicator = (schedule: GuildSchedule): string => {
  if (schedule.isReserve) return " - 🪑";
  return schedule.isSignedUp ? " - 📝 " : "";
};

const getScheduleStatusWithNote = (schedule: GuildSchedule): string => {
  const status = getScheduleStatusIndicator(schedule);
  if (!status && !schedule.charNote) return "";
  if (schedule.charNote) return `${status} - ${schedule.charNote}`;
  return status;
};

const personalScheduleLegend = "**__📝 Signed Up / 🪑 Reserve__: **";

/** Formats the guild label shown before personal schedule entries. */
const getGuildHeading = (
  schedule: GuildSchedule,
  { isLarge = false }: { isLarge?: boolean } = {},
): string | undefined =>
  schedule.guildName
    ? `${isLarge ? "### " : ""}${schedule.guildIcon ? `${schedule.guildIcon} - ` : ""}${schedule.guildName}`
    : undefined;

/**
 * Formats a single schedule row with title, timestamp, channel, and status.
 * When isPublic is true and the schedule is role-restricted, shows "(Private run)" label without a link.
 * @param schedule The schedule to format
 * @param showGuildHeading Whether to show the guild name heading
 * @param showPersonalDetails Whether to show signup status and character notes
 * @param isPublic Whether this is for public display (affects role-restricted display)
 */
const formatGuildSchedule = (
  schedule: GuildSchedule,
  {
    showGuildHeading = true,
    showPersonalDetails = true,
    isPublic = false,
  }: {
    showGuildHeading?: boolean;
    showPersonalDetails?: boolean;
    isPublic?: boolean;
  } = {},
): string => {
  const relativeTimestamp = schedule.timestamp.replace(":F>", ":R>");
  const guildHeading = showGuildHeading ? getGuildHeading(schedule) : undefined;

  // Check if this is a role-restricted channel in public mode
  const isPrivateRun = isPublic && schedule.isRoleRestricted;

  const scheduleTitle = isPrivateRun
    ? `**${schedule.title} (Private run)**`
    : `**[${schedule.title}](${schedule.channelUrl})**`;
  const scheduleTitleLine = `${getScheduleTitleIcon(schedule)} ${scheduleTitle}`;

  return [
    guildHeading ?? scheduleTitleLine,
    guildHeading ? scheduleTitleLine : undefined,
    `${schedule.timestamp} (${relativeTimestamp})`,
    !isPrivateRun
      ? `↪ [#${schedule.channelName}](${schedule.channelUrl})${showPersonalDetails ? getScheduleStatusWithNote(schedule) : ""}`
      : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
};

/** Formats personal schedules under larger guild headings. */
const formatGuildGroupedSchedules = (
  schedules: GuildSchedule[],
  isPublic = false,
): string => {
  const schedulesByGuild = new Map<string, GuildSchedule[]>();

  for (const schedule of schedules) {
    const key = `${schedule.guildIcon ?? ""}\u0000${schedule.guildName ?? "Unknown Guild"}`;
    schedulesByGuild.set(key, [...(schedulesByGuild.get(key) ?? []), schedule]);
  }

  return Array.from(schedulesByGuild.values())
    .sort((first, second) =>
      (first[0]?.guildName ?? "").localeCompare(second[0]?.guildName ?? ""),
    )
    .map((guildSchedules) => {
      const [firstSchedule] = guildSchedules;
      return [
        firstSchedule
          ? getGuildHeading(firstSchedule, { isLarge: true })
          : undefined,
        guildSchedules
          .map((schedule) =>
            formatGuildSchedule(schedule, {
              showGuildHeading: false,
              isPublic,
            }),
          )
          .join("\n\n"),
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    })
    .join("\n\n");
};

/** Formats personal schedules under their detected instance type headings. */
const formatInstanceGroupedSchedules = (
  schedules: GuildSchedule[],
  isPublic = false,
): string => {
  const schedulesByInstance = new Map<string, GuildSchedule[]>();

  for (const schedule of schedules) {
    const instanceNames = parseInstanceTypes(schedule.title).map(
      (instanceType) => instanceType.name,
    );
    const instanceName = instanceNames.join(" / ") || "Others";
    schedulesByInstance.set(instanceName, [
      ...(schedulesByInstance.get(instanceName) ?? []),
      schedule,
    ]);
  }

  return Array.from(schedulesByInstance.entries())
    .sort(([first], [second]) => first.localeCompare(second))
    .map(
      ([instanceName, instanceSchedules]) =>
        `### ${instanceName}\n${instanceSchedules
          .map((schedule) => formatGuildSchedule(schedule, { isPublic }))
          .join("\n\n")}`,
    )
    .join("\n\n");
};

/** Formats the personal schedule DM description in the requested grouping mode. */
const formatMySchedules = (
  schedules: GuildSchedule[],
  grouping: MyScheduleGrouping,
  isPublic = false,
): string =>
  [
    personalScheduleLegend,
    grouping === "guild"
      ? formatGuildGroupedSchedules(schedules, isPublic)
      : grouping === "instance"
        ? formatInstanceGroupedSchedules(schedules, isPublic)
        : schedules
            .map((schedule) => formatGuildSchedule(schedule, { isPublic }))
            .join("\n\n"),
  ].join("\n\n");

const formatScheduleGroup = (
  heading: string,
  schedules: GuildSchedule[],
  isPublic = false,
): string | undefined =>
  schedules.length
    ? `**${heading}**\n${schedules.map((schedule) => formatGuildSchedule(schedule, { isPublic })).join("\n\n")}`
    : undefined;

const formatGuildSchedules = (
  schedules: GuildSchedule[],
  isPublic = false,
): string => {
  const visibleSchedules = schedules.slice(0, 25);
  const signedUpSchedules = visibleSchedules.filter(
    (schedule) => schedule.isSignedUp || schedule.isReserve,
  );
  const notSignedUpSchedules = visibleSchedules.filter(
    (schedule) => !schedule.isSignedUp && !schedule.isReserve,
  );

  return [
    formatScheduleGroup(
      "__📝 Signed Up / 🪑 Reserve__:\n",
      signedUpSchedules,
      isPublic,
    ),
    formatScheduleGroup(
      "------------------------------\n__Not Signed Up__:\n",
      notSignedUpSchedules,
      isPublic,
    ),
  ]
    .filter((group): group is string => Boolean(group))
    .join("\n\n");
};

const formatAnnouncementSchedules = (
  schedules: GuildSchedule[],
  isPublic = false,
): string =>
  schedules
    .slice(0, 25)
    .map((schedule) =>
      formatGuildSchedule(schedule, { showPersonalDetails: false, isPublic }),
    )
    .join("\n\n");

/**
 * Builds the upcoming guild schedules embed for a command interaction.
 * Displays schedules from configured category channels.
 * When isPublic is true, role-restricted channels display with a "(Private run)" label.
 * @param schedules The active guild schedules to display
 * @param context The interaction context for the requesting member
 * @param categoryNames Array of names of the schedule categories
 * @param forAnnouncementOnly If true, omits signup headings and personal details
 * @param isPublic If true, displays role-restricted runs with "(Private run)" label instead of links
 */
export const buildGuildScheduleEmbed = (
  schedules: GuildSchedule[],
  context: InteractionContext,
  categoryNames: string[],
  forAnnouncementOnly = false,
  isPublic = false,
): EmbedBuilder => {
  const footer: { text: string; iconURL?: string } = getEmbedFooter(context);
  const categoryText =
    categoryNames.length === 1
      ? `Only showing signup channels within __${categoryNames[0]}__ category.`
      : `Only showing signup channels within __${categoryNames.join("__, __")}__ categories.`;
  return new EmbedBuilder()
    .setTitle(`Upcoming Runs of ${context.guildName}`)
    .setColor("#d1b500")
    .setThumbnail(context.guildIconUrl)

    .setDescription(
      schedules.length
        ? forAnnouncementOnly
          ? formatAnnouncementSchedules(schedules, isPublic)
          : formatGuildSchedules(schedules, isPublic)
        : "No active schedules found.",
    )
    .addFields({
      name: "\u200b",
      value: `${categoryText}\ncommand invoked by <@${context.userId}>`,
    })
    .setTimestamp()
    .setFooter(footer);
};

/** Builds the personal schedule embed sent through direct messages. */
export const buildMyScheduleEmbed = (
  schedules: GuildSchedule[],
  context: InteractionContext,
  grouping: MyScheduleGrouping = "date",
  title = "Your upcoming schedules",
): EmbedBuilder => {
  const footer: { text: string; iconURL?: string } = getEmbedFooter(context);
  return new EmbedBuilder()
    .setTitle(title)
    .setColor("#d1b500")
    .setThumbnail(context.userAvatarUrl)

    .setDescription(
      schedules.length
        ? formatMySchedules(schedules, grouping)
        : "No active schedules found.",
    )
    .addFields({
      name: "\u200b",
      value: `Only showing signup channels from your accessible guild schedule categories.\ncommand invoked by <@${context.userId}>`,
    })
    .setTimestamp()
    .setFooter(footer);
};
