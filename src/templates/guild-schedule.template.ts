import { EmbedBuilder } from "discord.js";
import type {
  GuildSchedule,
  MyScheduleGrouping,
} from "../types/guild-schedule.js";
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

/** Formats a single schedule row with title, timestamp, channel, and status. */
const formatGuildSchedule = (
  schedule: GuildSchedule,
  { showGuildHeading = true }: { showGuildHeading?: boolean } = {},
): string => {
  const relativeTimestamp = schedule.timestamp.replace(":F>", ":R>");
  const guildHeading = showGuildHeading ? getGuildHeading(schedule) : undefined;
  const scheduleTitle = `**[${schedule.title}](${schedule.channelUrl})**`;
  const scheduleTitleLine = `${getScheduleTitleIcon(schedule)} ${scheduleTitle}`;
  return [
    guildHeading ?? scheduleTitleLine,
    guildHeading ? scheduleTitleLine : undefined,
    `${schedule.timestamp} (${relativeTimestamp})`,
    `↪ [#${schedule.channelName}](${schedule.channelUrl})${getScheduleStatusWithNote(schedule)}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
};

/** Formats personal schedules under larger guild headings. */
const formatGuildGroupedSchedules = (schedules: GuildSchedule[]): string => {
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
            formatGuildSchedule(schedule, { showGuildHeading: false }),
          )
          .join("\n\n"),
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    })
    .join("\n\n");
};

/** Formats the personal schedule DM description in the requested grouping mode. */
const formatMySchedules = (
  schedules: GuildSchedule[],
  grouping: MyScheduleGrouping,
): string =>
  [
    personalScheduleLegend,
    grouping === "guild"
      ? formatGuildGroupedSchedules(schedules)
      : schedules.map((schedule) => formatGuildSchedule(schedule)).join("\n\n"),
  ].join("\n\n");

const formatScheduleGroup = (
  heading: string,
  schedules: GuildSchedule[],
): string | undefined =>
  schedules.length
    ? `**${heading}**\n${schedules.map((schedule) => formatGuildSchedule(schedule)).join("\n\n")}`
    : undefined;

const formatGuildSchedules = (schedules: GuildSchedule[]): string => {
  const visibleSchedules = schedules.slice(0, 25);
  const signedUpSchedules = visibleSchedules.filter(
    (schedule) => schedule.isSignedUp || schedule.isReserve,
  );
  const notSignedUpSchedules = visibleSchedules.filter(
    (schedule) => !schedule.isSignedUp && !schedule.isReserve,
  );

  return [
    formatScheduleGroup("__📝 Signed Up / 🪑 Reserve__:\n", signedUpSchedules),
    formatScheduleGroup(
      "------------------------------\n__Not Signed Up__:\n",
      notSignedUpSchedules,
    ),
  ]
    .filter((group): group is string => Boolean(group))
    .join("\n\n");
};

/** Builds the upcoming guild schedules embed for a command interaction. */
export const buildGuildScheduleEmbed = (
  schedules: GuildSchedule[],
  context: InteractionContext,
  categoryName: string,
): EmbedBuilder => {
  const footer: { text: string; iconURL?: string } = getEmbedFooter(context);
  return new EmbedBuilder()
    .setTitle(`Upcoming Runs of ${context.guildName}`)
    .setColor("#d1b500")
    .setThumbnail(context.guildIconUrl)

    .setDescription(
      schedules.length
        ? formatGuildSchedules(schedules)
        : "No active schedules found.",
    )
    .addFields({
      name: "\u200b",
      value: `Only showing signup channels within __${categoryName}__ category.\ncommand invoked by <@${context.userId}>`,
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
