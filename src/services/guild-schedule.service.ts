import {
  ChannelType,
  PermissionFlagsBits,
  type Embed,
  type Guild,
  type GuildMember,
  type Message,
  type TextChannel,
} from "discord.js";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import type {
  GuildSchedule,
  GuildScheduleTimeWindow,
} from "../types/guild-schedule.js";

const scheduleTimestampPattern = /Your\s+Time:\s*(<t:(\d+):F>)/i;
const clearedScheduleTimePattern = /Your\s+Time:\s*TBD\b/i;

/** Escapes a value for literal use in a regular expression. */
const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

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
  const match = scheduleTimestampPattern.exec(embedText);
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

/** Checks whether a roster line has a name entry (bold or plain) matching the pattern after a dash/comma. */
const isNameOnLine = (line: string, displayNamePattern: string): boolean => {
  const pattern = new RegExp(
    String.raw`[-,]\s*\*{0,2}${displayNamePattern}\*{0,2}(?=\s|,|\(|$)`,
    "i",
  );
  return pattern.test(line);
};

/** Checks for a non-reserve roster entry matching the invoking member. */
const isMemberSignedUp = (
  embedText: string,
  displayNamePattern: string,
): boolean =>
  embedText
    .split("\n")
    .some(
      (line) =>
        !/\bReserve\b/i.test(line) && isNameOnLine(line, displayNamePattern),
    );

/** Checks for a reserve roster entry matching the invoking member. */
const isMemberReserve = (
  embedText: string,
  displayNamePattern: string,
): boolean =>
  embedText
    .split("\n")
    .some(
      (line) =>
        /\bReserve\b/i.test(line) && isNameOnLine(line, displayNamePattern),
    );

/** Extracts the character note from a schedule embed for the invoking member. */
const getMemberCharNote = (
  embedText: string,
  displayNamePattern: string,
): string | undefined => {
  const charNotePattern = new RegExp(
    String.raw`\*{0,2}${displayNamePattern}\*{0,2}\s*\(([^)]+)\)`,
    "i",
  );
  const match = charNotePattern.exec(embedText);
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

/** Returns whether a Discord timestamp (`<t:unix:F>`) is already in the past. */
const isPastTimestamp = (timestamp: string): boolean => {
  const match = /\d+/.exec(timestamp);
  return Number(match?.[0] ?? "0") * 1_000 < Date.now();
};

const SCHEDULE_MESSAGE_PAGE_LIMIT = 100;
const MAX_SCHEDULE_MESSAGE_PAGES = 5;

const getScheduleFromMessage = (
  message: Message,
  channel: TextChannel,
  displayNamePattern: string,
  timeWindow: GuildScheduleTimeWindow | undefined,
  isRoleRestricted: boolean | undefined,
  includePast: boolean,
  clearedBotIds: Set<string>,
): GuildSchedule | undefined => {
  if (clearedBotIds.has(message.author.id) && !timeWindow) return undefined;
  const schedule = message.embeds.flatMap((embed) => {
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
  if (
    schedule &&
    (!clearedBotIds.has(message.author.id) ||
      isPastTimestamp(schedule.timestamp))
  ) {
    return schedule;
  }
  const embedText = message.embeds.map(getEmbedText).join("\n");
  if (clearedScheduleTimePattern.test(embedText)) {
    clearedBotIds.add(message.author.id);
  }
  return undefined;
};

/**
 * Gets the newest active schedule within the requested time window from the configured
 * schedule bots' recent replies. Scheduled replies outside the window are skipped.
 * Replies without a `Your Time:` label, such as command confirmations or cancelled
 * interactions, are ignored. A reply with `Your Time: TBD` clears an older schedule,
 * but only for the bot that posted it, so a cleared sheet from one bot does not hide
 * another bot's active sheet in the same channel.
 * When a time window is requested, a cleared reply still keeps that bot's already
 * finished in-window run visible, since clearing sets up the next run rather than
 * undoing the one that already happened.
 * A single page of 100 messages can miss an in-window run that has been pushed
 * further back by channel activity, so additional pages are fetched (oldest-first
 * cursor) while a time window is requested and the oldest fetched message is still
 * newer than the window's start.
 */
const getNewestChannelSchedule = async (
  channel: TextChannel,
  member: GuildMember,
  timeWindow?: GuildScheduleTimeWindow,
  isRoleRestricted?: boolean,
  includePast = false,
): Promise<GuildSchedule | undefined> => {
  const displayNamePattern = escapeRegularExpression(member.displayName);
  const clearedBotIds = new Set<string>();
  let before: string | undefined;

  for (let page = 0; page < MAX_SCHEDULE_MESSAGE_PAGES; page++) {
    const messages = await channel.messages.fetch(
      before
        ? { limit: SCHEDULE_MESSAGE_PAGE_LIMIT, before }
        : { limit: SCHEDULE_MESSAGE_PAGE_LIMIT },
    );
    const pageMessages = Array.from(messages.values());
    if (pageMessages.length === 0) break;

    const scheduleMessages = pageMessages
      .filter((message) =>
        DISCORD_SETTINGS.guildScheduleBotIds.includes(message.author.id),
      )
      .sort(
        (first, second) => second.createdTimestamp - first.createdTimestamp,
      );

    for (const message of scheduleMessages) {
      const schedule = getScheduleFromMessage(
        message,
        channel,
        displayNamePattern,
        timeWindow,
        isRoleRestricted,
        includePast,
        clearedBotIds,
      );
      if (schedule) return schedule;
    }

    const oldestMessage = pageMessages.reduce(
      (oldest, current) =>
        current.createdTimestamp < oldest.createdTimestamp ? current : oldest,
      pageMessages[0]!,
    );
    const hasMorePages = pageMessages.length === SCHEDULE_MESSAGE_PAGE_LIMIT;
    if (
      !timeWindow ||
      !hasMorePages ||
      oldestMessage.createdTimestamp < timeWindow.start.getTime()
    ) {
      break;
    }
    before = oldestMessage.id;
  }

  return undefined;
};

/**
 * Lists accessible active schedules, keeping the newest active schedule per channel.
 * Time-less schedule-bot replies are ignored, while a newer `Your Time: TBD` embed
 * clears that bot's older schedules in the channel without hiding another bot's
 * active schedule there.
 * Results are ordered from earliest to latest scheduled time.
 * When a time window is provided, schedules inside that window are included even
 * when their scheduled time has already passed; neither a newer scheduled reply
 * outside the window nor a newer cleared reply hides an older in-window schedule
 * that already happened.
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
    .sort((first, second) => {
      const firstTime = Number(/\d+/.exec(first.timestamp)?.[0] ?? "0");
      const secondTime = Number(/\d+/.exec(second.timestamp)?.[0] ?? "0");
      return firstTime - secondTime;
    });
};
