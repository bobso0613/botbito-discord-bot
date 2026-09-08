import {
  ChannelType,
  type Client,
  type Message,
  type TextChannel,
} from "discord.js";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import { getActiveGuildSchedules } from "./guild-schedule.service.js";
import {
  buildGuildScheduleEmbed,
  buildScheduleActionRow,
} from "../templates/guild-schedule.template.js";
import type { InteractionContext } from "../types/interaction-context.js";
import { logger } from "../utils/logger.js";

const scheduleTimestampPattern = /\*?Your\s+Time:\s*<t:(\d+):F>\*?/i;
const clearedSchedulePattern = /\*?Your\s+Time:\s*TBD\b\*?/i;

const getEmbedText = (message: Message): string =>
  message.embeds
    .flatMap((embed) => [
      embed.title,
      embed.description,
      ...embed.fields.flatMap((field) => [field.name, field.value]),
    ])
    .filter((value): value is string => Boolean(value))
    .join("\n");

/** Returns the run title from a schedule response embed. */
export const getScheduleTitle = (message: Message): string | undefined =>
  message.embeds.find((embed) => Boolean(embed.title))?.title ?? undefined;

/** Returns the scheduled Unix timestamp from a schedule response embed. */
export const getScheduleTimestamp = (message: Message): string | undefined => {
  const match = getEmbedText(message).match(scheduleTimestampPattern);
  return match?.[1];
};

/** Returns whether a schedule response explicitly clears its scheduled time. */
export const isClearedScheduleMessage = (message: Message): boolean =>
  clearedSchedulePattern.test(getEmbedText(message));

/**
 * Returns whether a message is from the configured schedule bot in a source category.
 * Configured announcement channels are excluded even when placed in a source category.
 */
export const isGuildScheduleSourceMessage = (message: Message): boolean => {
  if (
    !message.guildId ||
    message.author.id !== DISCORD_SETTINGS.guildScheduleBotId ||
    !message.channel.isTextBased() ||
    !("parentId" in message.channel)
  ) {
    return false;
  }

  const source = DISCORD_SETTINGS.guildScheduleSourceByGuild[message.guildId];
  return Boolean(
    source?.categoryIds.includes(message.channel.parentId ?? "") &&
    !source.scheduleTextChannelIds.includes(message.channel.id),
  );
};

/** Returns whether a message is a schedule response with a timestamp. */
export const isGuildScheduleMessage = (message: Message): boolean =>
  isGuildScheduleSourceMessage(message) &&
  Boolean(getScheduleTimestamp(message));

/** Maintains compatibility with callers using the previous predicate name. */
export const isGuildScheduleChangeMessage = isGuildScheduleMessage;

/**
 * Returns whether an edited schedule response changed its scheduled time.
 * Returns false when the old message has no cached timestamp, avoiding false
 * refreshes from partial Discord update payloads.
 */
export const isGuildScheduleTimestampChanged = (
  oldMessage: Message,
  newMessage: Message,
): boolean => {
  const oldTimestamp = getScheduleTimestamp(oldMessage);
  const newTimestamp = getScheduleTimestamp(newMessage);
  return Boolean(
    oldTimestamp &&
    oldTimestamp !== newTimestamp &&
    isGuildScheduleSourceMessage(newMessage),
  );
};

/** Gets the latest schedule-bot timestamp previously sent in a source channel. */
export const getLatestSentScheduleTimestamp = async (
  message: Message,
): Promise<string | undefined> => {
  const messages = await message.channel.messages.fetch({ limit: 100 });
  const latestScheduleMessage = Array.from(messages.values())
    .filter(
      (candidate) =>
        candidate.id !== message.id &&
        candidate.author.id === DISCORD_SETTINGS.guildScheduleBotId,
    )
    .sort(
      (first, second) => second.createdTimestamp - first.createdTimestamp,
    )[0];

  return latestScheduleMessage
    ? getScheduleTimestamp(latestScheduleMessage)
    : undefined;
};

const getMessageContext = (message: Message): InteractionContext => ({
  userId: message.author.id,
  username: message.author.username,
  discordTag: message.author.tag,
  displayName: message.author.displayName,
  userAvatarUrl: message.author.displayAvatarURL({
    extension: "png",
    size: 512,
  }),
  guildId: message.guildId,
  guildName: message.guild?.name ?? null,
  guildIconUrl: message.guild?.iconURL({ extension: "png", size: 512 }) ?? null,
});

const deleteChannelMessages = async (channel: TextChannel): Promise<void> => {
  let before: string | undefined;

  while (true) {
    const messages = await channel.messages.fetch({ limit: 100, before });
    if (messages.size === 0) return;

    await Promise.allSettled(
      messages.map((channelMessage) => channelMessage.delete()),
    );

    if (messages.size < 100) return;
    before = messages.last()?.id;
    if (!before) return;
  }
};

export type GuildScheduleRefreshTrigger =
  | { type: "timestamp-change" }
  | { type: "title-change" }
  | { type: "channel-rename"; previousChannelName: string };

/** Builds the log message emitted when an automatic schedule refresh starts. */
export const buildGuildScheduleRefreshLogMessage = (
  message: Message,
  trigger: GuildScheduleRefreshTrigger,
  scheduleChannels: readonly string[],
  newTimes: ReadonlyArray<{ channelName: string; timestamp: string }>,
): string =>
  [
    "guild schedule change hit",
    `triggerReason=${JSON.stringify(trigger.type)}`,
    `triggerChannel=${JSON.stringify(
      "name" in message.channel ? message.channel.name : message.channel.id,
    )}`,
    `triggerRunTitle=${JSON.stringify(getScheduleTitle(message) ?? null)}`,
    `previousChannelName=${JSON.stringify(
      trigger.type === "channel-rename" ? trigger.previousChannelName : null,
    )}`,
    `guildName=${JSON.stringify(message.guild?.name ?? null)}`,
    `scheduleChannels=${JSON.stringify(scheduleChannels)}`,
    `newTimes=${JSON.stringify(newTimes)}`,
  ].join(" ");

const refreshGuildScheduleAnnouncement = async (
  message: Message,
  trigger: GuildScheduleRefreshTrigger,
): Promise<void> => {
  if (!message.guild || !message.guildId) return;

  const source = DISCORD_SETTINGS.guildScheduleSourceByGuild[message.guildId];
  if (!source) return;

  const member =
    message.guild.members.me ??
    (await message.guild.members.fetch(message.client.user.id));
  const excludedChannels = (source.excludedChannelIds ?? []).filter(
    (channelId) => !source.roleRestrictedChannels?.[channelId],
  );
  const schedules = await getActiveGuildSchedules(
    message.guild,
    member,
    source.categoryIds,
    excludedChannels,
    undefined,
    source.roleRestrictedChannels,
  );
  const categoryNames = source.categoryIds
    .map((categoryId) => message.guild?.channels.cache.get(categoryId)?.name)
    .filter((name): name is string => Boolean(name));
  const embed = buildGuildScheduleEmbed(
    schedules,
    getMessageContext(message),
    categoryNames.length > 0 ? categoryNames : ["configured categories"],
    true,
    true,
    getScheduleTitle(message),
  );
  const announcementChannels: TextChannel[] = [];

  for (const channelId of source.scheduleTextChannelIds) {
    const channel = await message.guild.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) continue;

    announcementChannels.push(channel);
  }

  logger.log(
    buildGuildScheduleRefreshLogMessage(
      message,
      trigger,
      announcementChannels.map(({ name }) => name),
      schedules.map(({ channelName, timestamp }) => ({
        channelName,
        timestamp,
      })),
    ),
  );

  for (const channel of announcementChannels) {
    await deleteChannelMessages(channel);
    await channel.send({
      embeds: [embed],
      components: [buildScheduleActionRow()],
    });
  }
};

/** Checks whether an identifier (run title or channel name) appears in the latest announcement. */
export const isIdentifierAnnounced = async (
  guild: NonNullable<Message["guild"]>,
  scheduleTextChannelIds: readonly string[],
  identifier: string,
): Promise<boolean> => {
  for (const channelId of scheduleTextChannelIds) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) continue;

    const messages = await channel.messages.fetch({ limit: 1 });
    const latestText = messages
      .first()
      ?.embeds.flatMap((embed) => [
        embed.description,
        ...embed.fields.flatMap((field) => [field.name, field.value]),
      ])
      .filter((value): value is string => Boolean(value))
      .join("\n");

    if (latestText?.includes(identifier)) return true;
  }

  return false;
};

/** Returns the run title currently announced for a specific schedule channel, if any. */
export const getAnnouncedTitleForChannel = async (
  guild: NonNullable<Message["guild"]>,
  scheduleTextChannelIds: readonly string[],
  channelUrl: string,
): Promise<string | undefined> => {
  for (const channelId of scheduleTextChannelIds) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) continue;

    const messages = await channel.messages.fetch({ limit: 1 });
    const description = messages.first()?.embeds[0]?.description;
    const block = description
      ?.split("\n\n")
      .find((entry) => entry.includes(`(${channelUrl})`));
    const title = block?.match(/\*\*\[(.+?)\]\(/)?.[1];
    if (title) return title;
  }

  return undefined;
};

const getChannelUrl = (message: Message): string =>
  `https://discord.com/channels/${message.guildId}/${message.channel.id}`;

/**
 * Returns the automatic-refresh reason for a source message, if it changed a
 * schedule timestamp or title. Partial update payloads without an old timestamp
 * do not cause a timestamp refresh.
 */
export const getGuildScheduleRefreshTrigger = async (
  message: Message,
  previousMessage?: Message,
): Promise<GuildScheduleRefreshTrigger | undefined> => {
  if (!isGuildScheduleSourceMessage(message)) return undefined;

  const timestamp = getScheduleTimestamp(message);
  if (!timestamp && !previousMessage && !isClearedScheduleMessage(message)) {
    return undefined;
  }

  const previousTimestamp = previousMessage
    ? getScheduleTimestamp(previousMessage)
    : await getLatestSentScheduleTimestamp(message);
  const timestampChanged = previousMessage
    ? isGuildScheduleTimestampChanged(previousMessage, message)
    : previousTimestamp !== timestamp || isClearedScheduleMessage(message);
  if (timestampChanged) return { type: "timestamp-change" };

  return (await isTitleChangeConfirmed(message, previousMessage))
    ? { type: "title-change" }
    : undefined;
};

/**
 * Determines whether a schedule response's run title changed in a way that should
 * refresh the public announcement.
 * The schedule bot may reply to a rename command with a brand-new message instead of
 * editing the previous one, so this also runs for message creation (no previousMessage).
 * Prefers comparing the previous message's cached title, falling back to comparing
 * against the live announcement when there's no previous message or Discord didn't
 * cache its pre-edit embed (e.g. the message aged out of the client's message cache).
 * Either way, the change is only confirmed when the old title is currently announced.
 */
export const isTitleChangeConfirmed = async (
  message: Message,
  previousMessage?: Message,
): Promise<boolean> => {
  const currentTitle = getScheduleTitle(message);
  if (!currentTitle || !message.guild || !message.guildId) return false;

  const source = DISCORD_SETTINGS.guildScheduleSourceByGuild[message.guildId];
  if (!source) return false;

  const previousTitle = previousMessage
    ? getScheduleTitle(previousMessage)
    : undefined;
  if (previousTitle) {
    if (previousTitle === currentTitle) return false;
    return isIdentifierAnnounced(
      message.guild,
      source.scheduleTextChannelIds,
      previousTitle,
    );
  }

  const announcedTitle = await getAnnouncedTitleForChannel(
    message.guild,
    source.scheduleTextChannelIds,
    getChannelUrl(message),
  );
  return Boolean(announcedTitle && announcedTitle !== currentTitle);
};

/** Gets the newest schedule-bot message posted in a channel, if any. */
const getNewestGuildScheduleMessage = async (
  channel: TextChannel,
): Promise<Message | undefined> => {
  const messages = await channel.messages.fetch({ limit: 100 });
  return Array.from(messages.values())
    .filter(
      (candidate) =>
        candidate.author.id === DISCORD_SETTINGS.guildScheduleBotId,
    )
    .sort(
      (first, second) => second.createdTimestamp - first.createdTimestamp,
    )[0];
};

/**
 * Registers automatic public schedule announcements for schedule changes.
 * Refreshes announcements on scheduled-time changes, run title changes, and
 * schedule channel renames, gating title/rename triggers on the old title or
 * channel name currently being present in the announcement.
 */
export const registerGuildScheduleAnnouncementListener = (
  client: Client,
): void => {
  const handleMessage = async (
    message: Message,
    previousMessage?: Message,
  ): Promise<void> => {
    const trigger = await getGuildScheduleRefreshTrigger(
      message,
      previousMessage,
    );
    if (!trigger) return;

    try {
      await refreshGuildScheduleAnnouncement(message, trigger);
    } catch (error) {
      logger.error("Failed to refresh guild schedule announcement:", error);
    }
  };

  const handleChannelRename = async (
    oldChannel: TextChannel,
    newChannel: TextChannel,
  ): Promise<void> => {
    if (oldChannel.name === newChannel.name || !newChannel.guildId) return;

    const source =
      DISCORD_SETTINGS.guildScheduleSourceByGuild[newChannel.guildId];
    if (!source?.categoryIds.includes(newChannel.parentId ?? "")) return;

    const wasAnnounced = await isIdentifierAnnounced(
      newChannel.guild,
      source.scheduleTextChannelIds,
      oldChannel.name,
    );
    if (!wasAnnounced) return;

    const scheduleMessage = await getNewestGuildScheduleMessage(newChannel);
    if (!scheduleMessage) return;

    try {
      await refreshGuildScheduleAnnouncement(scheduleMessage, {
        type: "channel-rename",
        previousChannelName: oldChannel.name,
      });
    } catch (error) {
      logger.error("Failed to refresh guild schedule announcement:", error);
    }
  };

  client.on("messageCreate", handleMessage);
  client.on("messageUpdate", (oldMessage, newMessage) => {
    const previousMessage = oldMessage as Message;
    const updatedMessage = newMessage as Message;
    void handleMessage(updatedMessage, previousMessage);
  });
  client.on("channelUpdate", (oldChannel, newChannel) => {
    if (
      oldChannel.type !== ChannelType.GuildText ||
      newChannel.type !== ChannelType.GuildText
    ) {
      return;
    }
    void handleChannelRename(oldChannel, newChannel);
  });
};
