import { describe, expect, it, jest } from "@jest/globals";
import type { Message } from "discord.js";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import {
  getLatestSentScheduleTimestamp,
  getScheduleTimestamp,
  isClearedScheduleMessage,
  isGuildScheduleMessage,
  isGuildScheduleSourceMessage,
  isGuildScheduleTimestampChanged,
} from "./guild-schedule-announcement.service.js";

const guildId = Object.keys(DISCORD_SETTINGS.guildScheduleSourceByGuild)[0];
const categoryId =
  DISCORD_SETTINGS.guildScheduleSourceByGuild[guildId].categoryIds[0];

const createMessage = ({
  authorId = DISCORD_SETTINGS.guildScheduleBotId,
  parentId = categoryId,
  timestamp = "1799177400",
}: {
  authorId?: string;
  parentId?: string;
  timestamp?: string | null;
} = {}): Message =>
  ({
    guildId,
    author: { id: authorId },
    channel: {
      isTextBased: () => true,
      parentId,
    },
    embeds: [
      {
        title: "Monday Sealed Shrine",
        description:
          timestamp === null
            ? "Your Time: TBD"
            : `Your Time: <t:${timestamp}:F>`,
        fields: [],
      },
    ],
  }) as unknown as Message;

describe("isGuildScheduleChangeMessage", () => {
  it("accepts schedule responses from the configured bot in a source category", () => {
    expect(isGuildScheduleMessage(createMessage())).toBe(true);
  });

  it("ignores responses outside source categories", () => {
    expect(
      isGuildScheduleMessage(
        createMessage({ parentId: "unconfigured-category" }),
      ),
    ).toBe(false);
  });

  it("ignores schedule-shaped messages from other authors", () => {
    expect(
      isGuildScheduleMessage(createMessage({ authorId: "another-bot" })),
    ).toBe(false);
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

  it("ignores an edited schedule response with no cached old embed", () => {
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
});
