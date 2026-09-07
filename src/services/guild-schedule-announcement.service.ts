import {
  ChannelType,
  type Client,
  type Message,
  type TextChannel,
} from "discord.js";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import { getActiveGuildSchedules } from "./guild-schedule.service.js";
import { buildGuildScheduleEmbed } from "../templates/guild-schedule.template.js";
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

const getScheduleTitle = (message: Message): string | undefined =>
  message.embeds.find((embed) => Boolean(embed.title))?.title ?? undefined;

/** Returns the scheduled Unix timestamp from a schedule response embed. */
export const getScheduleTimestamp = (message: Message): string | undefined => {
  const match = getEmbedText(message).match(scheduleTimestampPattern);
  return match?.[1];
};

/** Returns whether a schedule response explicitly clears its scheduled time. */
export const isClearedScheduleMessage = (message: Message): boolean =>
  clearedSchedulePattern.test(getEmbedText(message));

/** Returns whether a message is from the configured schedule bot in a source category. */
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
  return Boolean(source?.categoryIds.includes(message.channel.parentId ?? ""));
};

/** Returns whether a message is a schedule response with a timestamp. */
export const isGuildScheduleMessage = (message: Message): boolean =>
  isGuildScheduleSourceMessage(message) &&
  Boolean(getScheduleTimestamp(message));

/** Maintains compatibility with callers using the previous predicate name. */
export const isGuildScheduleChangeMessage = isGuildScheduleMessage;

/** Returns whether an edited schedule response changed its scheduled time. */
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

const refreshGuildScheduleAnnouncement = async (
  message: Message,
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
    "guild schedule change hit " +
      `triggerChannel=${JSON.stringify(
        "name" in message.channel ? message.channel.name : message.channel.id,
      )} ` +
      `guildName=${JSON.stringify(message.guild.name)} ` +
      `scheduleChannels=${JSON.stringify(announcementChannels.map(({ name }) => name))} ` +
      `newTimes=${JSON.stringify(
        schedules.map(({ channelName, timestamp }) => ({
          channelName,
          timestamp,
        })),
      )}`,
  );

  for (const channel of announcementChannels) {
    await deleteChannelMessages(channel);
    await channel.send({ embeds: [embed] });
  }
};

/** Registers automatic public schedule announcements for schedule changes. */
export const registerGuildScheduleAnnouncementListener = (
  client: Client,
): void => {
  const handleMessage = async (
    message: Message,
    previousMessage?: Message,
  ): Promise<void> => {
    const timestamp = getScheduleTimestamp(message);
    if (!isGuildScheduleSourceMessage(message)) return;
    if (!timestamp && !previousMessage && !isClearedScheduleMessage(message)) {
      return;
    }

    const previousTimestamp = previousMessage
      ? getScheduleTimestamp(previousMessage)
      : await getLatestSentScheduleTimestamp(message);
    if (previousTimestamp === timestamp && !isClearedScheduleMessage(message)) {
      return;
    }

    try {
      await refreshGuildScheduleAnnouncement(message);
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
};
