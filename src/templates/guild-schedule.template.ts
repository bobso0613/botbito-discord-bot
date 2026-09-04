import { EmbedBuilder } from "discord.js";
import type { GuildSchedule } from "../types/guild-schedule.js";
import type { InteractionContext } from "../types/interaction-context.js";
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

const formatGuildSchedule = (schedule: GuildSchedule): string => {
  const relativeTimestamp = schedule.timestamp.replace(":F>", ":R>");
  return [
    `🗓️ **[${schedule.title}](${schedule.channelUrl})**`,
    `${schedule.timestamp} (${relativeTimestamp})`,
    `↪ [#${schedule.channelName}](${schedule.channelUrl})${getScheduleStatusWithNote(schedule)}`,
  ].join("\n");
};

const formatScheduleGroup = (
  heading: string,
  schedules: GuildSchedule[],
): string | undefined =>
  schedules.length
    ? `**${heading}**\n${schedules.map(formatGuildSchedule).join("\n\n")}`
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
