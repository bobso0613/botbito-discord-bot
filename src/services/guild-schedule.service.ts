import {
  ChannelType,
  PermissionFlagsBits,
  type Embed,
  type Guild,
  type GuildMember,
  type TextChannel,
} from "discord.js";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import type {
  GuildSchedule,
  GuildScheduleTimeWindow,
} from "../types/guild-schedule.js";

const scheduleTimestampPattern = /Your\s+Time:\s*(<t:(\d+):F>)/i;

/** Escapes a value for literal use in a regular expression. */
const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Combines all searchable embed text, including fields. */
const getEmbedText = (embed: Embed): string =>
  [
    embed.description,
    ...embed.fields.flatMap((field) => [field.name, field.value]),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");

/** Returns a Discord timestamp when it is active or inside the requested window. */
const getActiveScheduleTimestamp = (
  embedText: string,
  timeWindow?: GuildScheduleTimeWindow,
  includePast = false,
): string | undefined => {
  const match = embedText.match(scheduleTimestampPattern);
  if (!match) return undefined;

  const [, timestamp, unixSeconds] = match;
  const timestampMilliseconds = Number(unixSeconds) * 1_000;
  if (Number.isNaN(timestampMilliseconds)) return undefined;

  if (timeWindow) {
    return timestampMilliseconds >= timeWindow.start.getTime() &&
      timestampMilliseconds < timeWindow.end.getTime()
      ? timestamp
      : undefined;
  }

  return includePast || timestampMilliseconds >= Date.now()
    ? timestamp
    : undefined;
};

/** Checks for a non-reserve roster entry matching the invoking member. */
const isMemberSignedUp = (
  embedText: string,
  displayNamePattern: string,
): boolean => {
  const signupPattern = new RegExp(
    `-\\s*\\*\\*${displayNamePattern}\\*\\*`,
    "im",
  );
  return signupPattern.test(embedText);
};

/** Checks for a reserve roster entry matching the invoking member. */
const isMemberReserve = (
  embedText: string,
  displayNamePattern: string,
): boolean => {
  const reservePattern = new RegExp(
    `(?:^|\\n)[^\\n]*\\bReserve[^-]*-\\s*\\*\\*${displayNamePattern}\\*\\*`,
    "im",
  );
  return reservePattern.test(embedText);
};

/** Extracts the character note from a schedule embed for the invoking member. */
const getMemberCharNote = (
  embedText: string,
  displayNamePattern: string,
): string | undefined => {
  const charNotePattern = new RegExp(
    `\\*\\*${displayNamePattern}\\*\\*\\s*\\(([^)]+)\\)`,
    "i",
  );
  const match = embedText.match(charNotePattern);
  return match?.[1];
};

/** Checks whether a member can view and read a candidate schedule channel. */
const isAccessibleScheduleChannel = (
  channel: TextChannel,
  member: GuildMember,
  categoryIds: string[],
): boolean =>
  categoryIds.includes(channel.parentId ?? "") &&
  channel
    .permissionsFor(member)
    ?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
    ]) === true;

/** Gets the newest active schedule posted in a text channel. */
const getNewestChannelSchedule = async (
  channel: TextChannel,
  member: GuildMember,
  timeWindow?: GuildScheduleTimeWindow,
  isRoleRestricted?: boolean,
  includePast = false,
): Promise<GuildSchedule | undefined> => {
  const messages = await channel.messages.fetch({ limit: 100 });
  const displayNamePattern = escapeRegularExpression(member.displayName);
  const newestScheduleMessage = Array.from(messages.values())
    .sort((first, second) => second.createdTimestamp - first.createdTimestamp)
    .find(
      (message) => message.author.id === DISCORD_SETTINGS.guildScheduleBotId,
    );

  if (!newestScheduleMessage) return undefined;

  return newestScheduleMessage.embeds.flatMap((embed) => {
    const embedText = getEmbedText(embed);
    const timestamp = getActiveScheduleTimestamp(
      embedText,
      timeWindow,
      includePast,
    );
    const isReserve = isMemberReserve(embedText, displayNamePattern);
    return timestamp && embed.title
      ? [
          {
            title: embed.title,
            timestamp,
            channelName: channel.name,
            channelUrl: channel.url,
            isSignedUp:
              !isReserve && isMemberSignedUp(embedText, displayNamePattern),
            isReserve,
            charNote: getMemberCharNote(embedText, displayNamePattern),
            isRoleRestricted,
          },
        ]
      : [];
  })[0];
};

/**
 * Lists accessible active schedules, keeping the newest message per channel.
 * Results are ordered from earliest to latest scheduled time.
 * When a time window is provided, schedules inside that window are included even
 * when their scheduled time has already passed.
 * @param guild The guild to search for schedules
 * @param member The member requesting schedules (used for permission checks)
 * @param categoryIds Array of category IDs to search within
 * @param excludedChannelIds Channels to exclude from results
 * @param timeWindow Optional time window for filtering schedules
 * @param roleRestrictedChannels Map of channel IDs to their required role IDs
 * @param includePast If true, includes schedules whose timestamp has passed
 * @returns Array of accessible schedules ordered by time, with isRoleRestricted flag set appropriately
 */
export const getActiveGuildSchedules = async (
  guild: Guild,
  member: GuildMember,
  categoryIds: string[],
  excludedChannelIds: readonly string[] = [],
  timeWindow?: GuildScheduleTimeWindow,
  roleRestrictedChannels?: Readonly<Record<string, string>>,
  includePast = false,
): Promise<GuildSchedule[]> => {
  const scheduleChannels = Array.from(guild.channels.cache.values()).filter(
    (channel): channel is TextChannel =>
      channel.type === ChannelType.GuildText &&
      !excludedChannelIds.includes(channel.id) &&
      isAccessibleScheduleChannel(channel, member, categoryIds),
  );
  const schedules = await Promise.all(
    scheduleChannels.map((channel) => {
      const isRoleRestricted = Boolean(
        roleRestrictedChannels && channel.id in roleRestrictedChannels,
      );
      return getNewestChannelSchedule(
        channel,
        member,
        timeWindow,
        isRoleRestricted,
        includePast,
      );
    }),
  );

  return schedules
    .filter((schedule): schedule is GuildSchedule => Boolean(schedule))
    .sort(
      (first, second) =>
        Number(first.timestamp.match(/\d+/)?.[0]) -
        Number(second.timestamp.match(/\d+/)?.[0]),
    );
};
