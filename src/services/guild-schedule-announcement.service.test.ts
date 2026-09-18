import { describe, expect, it, jest } from "@jest/globals";
import type { Message } from "discord.js";
import type { DiscordSettings } from "../types/discord-settings.js";

const guildId = "guild-id";
const categoryId = "category-id";
const scheduleTextChannelId = "schedule-channel-id";

const DISCORD_SETTINGS: DiscordSettings = {
  payoutGuildIds: [],
  payoutToPingId: "",
  payoutToPingTag: "",
  guildScheduleBotIds: ["schedule-bot-id"],
  guildIcons: { DEV: {}, PROD: {} },
  guildScheduleSourceByGuild: {
    [guildId]: {
      categoryIds: [categoryId],
      scheduleTextChannelIds: [scheduleTextChannelId],
      excludedChannelIds: [],
      roleRestrictedChannels: {},
    },
  },
  cooldownInstanceTypesByGuild: {},
  multiplierInstanceTypesByGuild: {},
};

jest.unstable_mockModule("../config/discord-settings.js", () => ({
  DISCORD_SETTINGS,
}));

const {
  buildGuildScheduleRefreshLogMessage,
  getAnnouncedTitleForChannel,
  getGuildScheduleRefreshTrigger,
  getLatestSentScheduleTimestamp,
  getScheduleTimestamp,
  isClearedScheduleMessage,
  isGuildScheduleMessage,
  isGuildScheduleSourceMessage,
  isGuildScheduleTimestampChanged,
  isIdentifierAnnounced,
  isTitleChangeConfirmed,
  registerGuildScheduleAnnouncementListener,
} = await import("./guild-schedule-announcement.service.js");

const createMessage = ({
  authorId = DISCORD_SETTINGS.guildScheduleBotIds[0],
  parentId = categoryId,
  channelId = "source-channel-id",
  timestamp = "1799177400",
  title = "Monday Sealed Shrine",
}: {
  authorId?: string;
  parentId?: string;
  channelId?: string;
  timestamp?: string | null;
  title?: string;
} = {}): Message =>
  ({
    guildId,
    author: { id: authorId },
    channel: {
      isTextBased: () => true,
      parentId,
      id: channelId,
    },
    embeds: [
      {
        title,
        description:
          timestamp === null
            ? "Your Time: TBD"
            : `Your Time: <t:${timestamp}:F>`,
        fields: [],
      },
    ],
  }) as unknown as Message;

describe("isGuildScheduleChangeMessage", () => {
  it("serializes concurrent schedule message events for the same guild", async () => {
    let resolveFirstFetch:
      | ((messages: Map<string, Message>) => void)
      | undefined;
    const firstFetch = new Promise<Map<string, Message>>((resolve) => {
      resolveFirstFetch = resolve;
    });
    const fetch = jest
      .fn<() => Promise<Map<string, Message>>>()
      .mockReturnValueOnce(firstFetch)
      .mockResolvedValueOnce(new Map());
    const message = {
      ...createMessage(),
      id: "source-message-id",
      guild: null,
      channel: {
        isTextBased: () => true,
        parentId: categoryId,
        id: "source-channel-id",
        messages: { fetch },
      },
    } as unknown as Message;
    const listeners = new Map<string, (...args: Message[]) => Promise<void>>();
    const client = {
      on: jest.fn(
        (event: string, listener: (...args: Message[]) => Promise<void>) => {
          listeners.set(event, listener);
        },
      ),
    };

    registerGuildScheduleAnnouncementListener(client as never);
    const handleMessage = listeners.get("messageCreate");
    expect(handleMessage).toBeDefined();

    const firstEvent = handleMessage!(message);
    const secondEvent = handleMessage!(message);
    await Promise.resolve();
    await Promise.resolve();

    expect(fetch).toHaveBeenCalledTimes(1);
    resolveFirstFetch!(new Map());
    await Promise.all([firstEvent, secondEvent]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("accepts schedule responses from the configured bot in a source category", () => {
    expect(isGuildScheduleMessage(createMessage())).toBe(true);
  });

  it("accepts schedule responses from an additional configured bot", () => {
    const scheduleBotIds = DISCORD_SETTINGS.guildScheduleBotIds as string[];
    scheduleBotIds.push("signup-bot-id");

    try {
      expect(
        isGuildScheduleMessage(createMessage({ authorId: "signup-bot-id" })),
      ).toBe(true);
    } finally {
      scheduleBotIds.pop();
    }
  });

  it("ignores responses outside source categories", () => {
    expect(
      isGuildScheduleMessage(
        createMessage({ parentId: "unconfigured-category" }),
      ),
    ).toBe(false);
  });

  it("ignores responses in configured announcement channels", () => {
    expect(
      isGuildScheduleMessage(
        createMessage({ channelId: scheduleTextChannelId }),
      ),
    ).toBe(false);
  });

  it("ignores responses in excluded channels", () => {
    const source = DISCORD_SETTINGS.guildScheduleSourceByGuild[guildId];
    source.excludedChannelIds = ["excluded-channel-id"];

    try {
      expect(
        isGuildScheduleMessage(
          createMessage({ channelId: "excluded-channel-id" }),
        ),
      ).toBe(false);
    } finally {
      source.excludedChannelIds = [];
    }
  });

  it("keeps triggering for excluded channels that are role restricted", () => {
    const source = DISCORD_SETTINGS.guildScheduleSourceByGuild[guildId];
    source.excludedChannelIds = ["excluded-channel-id"];
    source.roleRestrictedChannels = { "excluded-channel-id": "role-id" };

    try {
      expect(
        isGuildScheduleMessage(
          createMessage({ channelId: "excluded-channel-id" }),
        ),
      ).toBe(true);
    } finally {
      source.excludedChannelIds = [];
      source.roleRestrictedChannels = {};
    }
  });

  it("ignores source messages when no announcement channels are configured", () => {
    const source = DISCORD_SETTINGS.guildScheduleSourceByGuild[guildId];
    const scheduleTextChannelIds = source.scheduleTextChannelIds;
    source.scheduleTextChannelIds = [];

    try {
      expect(isGuildScheduleSourceMessage(createMessage())).toBe(false);
    } finally {
      source.scheduleTextChannelIds = scheduleTextChannelIds;
    }
  });

  it("ignores schedule-shaped messages from other authors", () => {
    expect(
      isGuildScheduleMessage(createMessage({ authorId: "another-bot" })),
    ).toBe(false);
  });

  it("identifies a timestamp change as the refresh trigger", async () => {
    await expect(
      getGuildScheduleRefreshTrigger(
        createMessage({ timestamp: "1799181000" }),
        createMessage({ timestamp: "1799177400" }),
      ),
    ).resolves.toEqual({ type: "timestamp-change" });
  });

  it("does not trigger a refresh from a partial old message", async () => {
    await expect(
      getGuildScheduleRefreshTrigger(
        createMessage({ timestamp: "1799181000" }),
        { ...createMessage(), embeds: [] } as unknown as Message,
      ),
    ).resolves.toBeUndefined();
  });

  it("includes trigger details in the schedule refresh log", () => {
    expect(
      buildGuildScheduleRefreshLogMessage(
        createMessage(),
        { type: "channel-rename", previousChannelName: "old-shrine" },
        ["schedule"],
        [{ channelName: "new-shrine", timestamp: "<t:1:F>" }],
      ),
    ).toContain(
      'triggerReason="channel-rename" triggerChannel="source-channel-id" triggerRunTitle="Monday Sealed Shrine" previousChannelName="old-shrine"',
    );
  });

  it("extracts the timestamp from a schedule response", () => {
    expect(getScheduleTimestamp(createMessage())).toBe("1799177400");
  });

  it("detects a changed timestamp in an edited schedule response", () => {
    expect(
      isGuildScheduleTimestampChanged(
        createMessage({ timestamp: "1799177400" }),
        createMessage({ timestamp: "1799181000" }),
      ),
    ).toBe(true);
  });

  it("ignores an edited schedule response when its timestamp is unchanged", () => {
    expect(
      isGuildScheduleTimestampChanged(
        createMessage({ timestamp: "1799177400" }),
        createMessage({ timestamp: "1799177400" }),
      ),
    ).toBe(false);
  });

  it("does not refresh a timestamp when an update has no cached old embed", () => {
    expect(
      isGuildScheduleTimestampChanged(
        { ...createMessage(), embeds: [] } as unknown as Message,
        createMessage({ timestamp: "1799181000" }),
      ),
    ).toBe(false);
  });

  it("detects when an edited schedule response clears its timestamp", () => {
    expect(
      isGuildScheduleTimestampChanged(
        createMessage({ timestamp: "1799177400" }),
        createMessage({ timestamp: null }),
      ),
    ).toBe(true);
  });

  it("recognizes a TBD schedule response as cleared", () => {
    expect(isClearedScheduleMessage(createMessage({ timestamp: null }))).toBe(
      true,
    );
  });

  it("recognizes the italicized Discord format for a cleared schedule", () => {
    expect(
      isClearedScheduleMessage({
        ...createMessage(),
        embeds: [
          {
            title: "Monday Sealed Shrine",
            description: "*Your Time: TBD*",
            fields: [],
          },
        ],
      } as unknown as Message),
    ).toBe(true);
  });

  it("allows a new TBD response from a clear command to be processed", () => {
    const message = createMessage({ timestamp: null });

    expect(isGuildScheduleSourceMessage(message)).toBe(true);
    expect(getScheduleTimestamp(message)).toBeUndefined();
    expect(isClearedScheduleMessage(message)).toBe(true);
  });

  it("extracts timestamps from italicized Discord schedule text", () => {
    expect(
      getScheduleTimestamp({
        ...createMessage(),
        embeds: [
          {
            title: "Monday Sealed Shrine",
            description: "*Your Time: <t:1799177400:F>*",
            fields: [],
          },
        ],
      } as unknown as Message),
    ).toBe("1799177400");
  });

  it("gets the latest prior schedule timestamp without filtering past times", async () => {
    const latestMessage = createMessage({ timestamp: "1" });
    const sourceMessage = {
      ...latestMessage,
      id: "current-message",
      channel: {
        messages: {
          fetch: jest.fn().mockResolvedValue(
            new Map([
              ["older", { ...latestMessage, id: "older", createdTimestamp: 1 }],
              [
                "latest",
                {
                  ...latestMessage,
                  id: "latest",
                  createdTimestamp: 2,
                  embeds: [
                    {
                      title: "Latest schedule",
                      description: "Your Time: <t:1:F>",
                      fields: [],
                    },
                  ],
                },
              ],
            ]) as never,
          ),
        },
      },
    } as unknown as Message;

    await expect(getLatestSentScheduleTimestamp(sourceMessage)).resolves.toBe(
      "1",
    );
  });

  it("does not fall back to an older timestamp after a prior clear", async () => {
    const sourceMessage = {
      ...createMessage(),
      id: "current-message",
      channel: {
        messages: {
          fetch: jest.fn().mockResolvedValue(
            new Map([
              [
                "older",
                {
                  ...createMessage(),
                  id: "older",
                  createdTimestamp: 1,
                },
              ],
              [
                "cleared",
                {
                  ...createMessage({ timestamp: null }),
                  id: "cleared",
                  createdTimestamp: 2,
                },
              ],
            ]) as never,
          ),
        },
      },
    } as unknown as Message;

    await expect(getLatestSentScheduleTimestamp(sourceMessage)).resolves.toBe(
      undefined,
    );
  });

  it("finds the announced title for a channel from the live announcement", async () => {
    const channelUrl = `https://discord.com/channels/${guildId}/source-channel-id`;
    const guild = {
      channels: {
        fetch: jest.fn().mockResolvedValue({
          type: 0,
          messages: {
            fetch: jest.fn().mockResolvedValue({
              first: () => ({
                embeds: [
                  {
                    description: `**[Monday Sealed Shrine](${channelUrl})**\n<t:1:F> (<t:1:R>)\nâ†ª [#source-channel](${channelUrl})`,
                  },
                ],
              }),
            } as never),
          },
        } as never),
      },
    } as unknown as NonNullable<Message["guild"]>;

    await expect(
      getAnnouncedTitleForChannel(guild, [scheduleTextChannelId], channelUrl),
    ).resolves.toBe("Monday Sealed Shrine");
  });

  it("returns undefined when a channel has no entry in the live announcement", async () => {
    const channelUrl = `https://discord.com/channels/${guildId}/source-channel-id`;
    const guild = {
      channels: {
        fetch: jest.fn().mockResolvedValue({
          type: 0,
          messages: {
            fetch: jest.fn().mockResolvedValue({
              first: () => ({
                embeds: [
                  {
                    description:
                      "**[Other Run](https://discord.com/channels/other/other)**",
                  },
                ],
              }),
            } as never),
          },
        } as never),
      },
    } as unknown as NonNullable<Message["guild"]>;

    await expect(
      getAnnouncedTitleForChannel(guild, [scheduleTextChannelId], channelUrl),
    ).resolves.toBeUndefined();
  });

  it("finds an identifier present in the latest announcement", async () => {
    const guild = {
      channels: {
        fetch: jest.fn().mockResolvedValue({
          type: 0,
          messages: {
            fetch: jest.fn().mockResolvedValue({
              first: () => ({
                embeds: [
                  {
                    description: "**[Monday Sealed Shrine](url)**",
                    fields: [],
                  },
                ],
              }),
            } as never),
          },
        } as never),
      },
    } as unknown as NonNullable<Message["guild"]>;

    await expect(
      isIdentifierAnnounced(
        guild,
        [scheduleTextChannelId],
        "Monday Sealed Shrine",
      ),
    ).resolves.toBe(true);
  });

  it("does not find an identifier absent from the latest announcement", async () => {
    const guild = {
      channels: {
        fetch: jest.fn().mockResolvedValue({
          type: 0,
          messages: {
            fetch: jest.fn().mockResolvedValue({
              first: () => ({
                embeds: [{ description: "**[Other Run](url)**", fields: [] }],
              }),
            } as never),
          },
        } as never),
      },
    } as unknown as NonNullable<Message["guild"]>;

    await expect(
      isIdentifierAnnounced(
        guild,
        [scheduleTextChannelId],
        "Monday Sealed Shrine",
      ),
    ).resolves.toBe(false);
  });

  it("confirms a title change when the schedule bot posts a brand-new message instead of editing", async () => {
    const channelUrl = `https://discord.com/channels/${guildId}/source-channel-id`;
    const guild = {
      channels: {
        fetch: jest.fn().mockResolvedValue({
          type: 0,
          messages: {
            fetch: jest.fn().mockResolvedValue({
              first: () => ({
                embeds: [
                  {
                    description: `**[Monday Sealed Shrine](${channelUrl})**\n<t:1:F> (<t:1:R>)\nâ†ª [#source-channel](${channelUrl})`,
                  },
                ],
              }),
            } as never),
          },
        } as never),
      },
    } as unknown as NonNullable<Message["guild"]>;
    const newMessage = {
      ...createMessage({ title: "Tuesday Sealed Shrine" }),
      guild,
      channel: {
        isTextBased: () => true,
        parentId: categoryId,
        id: "source-channel-id",
      },
    } as unknown as Message;

    await expect(isTitleChangeConfirmed(newMessage)).resolves.toBe(true);
  });

  it("does not confirm a title change for a channel with no live announcement entry", async () => {
    const guild = {
      channels: {
        fetch: jest.fn().mockResolvedValue({
          type: 0,
          messages: {
            fetch: jest.fn().mockResolvedValue({
              first: () => ({
                embeds: [
                  {
                    description:
                      "**[Other Run](https://discord.com/channels/other/other)**",
                  },
                ],
              }),
            } as never),
          },
        } as never),
      },
    } as unknown as NonNullable<Message["guild"]>;
    const newMessage = {
      ...createMessage({ title: "Tuesday Sealed Shrine" }),
      guild,
      channel: {
        isTextBased: () => true,
        parentId: categoryId,
        id: "source-channel-id",
      },
    } as unknown as Message;

    await expect(isTitleChangeConfirmed(newMessage)).resolves.toBe(false);
  });
});
