import { describe, expect, it, jest } from "@jest/globals";
import { ChannelType } from "discord.js";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import {
  getActiveGuildSchedules,
  type GuildScheduleTimeWindow,
} from "./guild-schedule.service.js";

const getDiscordTimestamp = (date: string): string =>
  `<t:${Math.floor(new Date(date).getTime() / 1_000)}:F>`;

describe("getActiveGuildSchedules", () => {
  it("returns the newest accessible schedule from each channel, ordered by time", async () => {
    const member = { displayName: "Lucian Blight" };
    const accessiblePermissions = { has: jest.fn().mockReturnValue(true) };
    const inaccessibleFetch = jest.fn();
    const createMessage = (
      title: string,
      timestamp: string,
      createdTimestamp: number,
      signupName = "Lucian Blight",
      role = "Clown",
    ) => ({
      author: { id: DISCORD_SETTINGS.guildScheduleBotId },
      createdTimestamp,
      embeds: [
        {
          title,
          description:
            "`04`: 🎸 " +
            `${role} - **` +
            `${signupName}** (_give link_)\nYour Time: ${timestamp}`,
          fields: [],
        },
      ],
    });
    const createAccessibleChannel = (
      id: string,
      name: string,
      url: string,
      messages: Map<string, ReturnType<typeof createMessage>>,
    ) => ({
      type: ChannelType.GuildText,
      id,
      parentId: "schedule-category",
      name,
      url,
      permissionsFor: jest.fn().mockReturnValue(accessiblePermissions),
      messages: { fetch: jest.fn().mockResolvedValue(messages as never) },
    });
    const scheduleChannel = createAccessibleChannel(
      "schedule-channel",
      "wolfchev-signup",
      "https://discord.com/channels/guild/schedule",
      new Map([
        ["old", createMessage("Old schedule", "<t:4070905800:F>", 1)],
        [
          "new",
          createMessage(
            "New schedule",
            "<t:4070905800:F>",
            2,
            "Lucian Blight",
            "Reserve",
          ),
        ],
      ]),
    );
    const earlierScheduleChannel = createAccessibleChannel(
      "earlier-schedule-channel",
      "endless-cellar-signup",
      "https://discord.com/channels/guild/earlier-schedule",
      new Map([
        [
          "earlier",
          createMessage(
            "Earlier schedule",
            "<t:3470905800:F>",
            1,
            "Another member",
          ),
        ],
      ]),
    );
    const inaccessibleChannel = {
      type: ChannelType.GuildText,
      id: "inaccessible-channel",
      parentId: "schedule-category",
      url: "https://discord.com/channels/guild/inaccessible-schedule",
      permissionsFor: jest.fn().mockReturnValue({
        has: jest.fn().mockReturnValue(false),
      }),
      messages: { fetch: inaccessibleFetch },
    };
    const guild = {
      channels: {
        cache: new Map([
          ["schedule", scheduleChannel],
          ["earlier", earlierScheduleChannel],
          ["inaccessible", inaccessibleChannel],
        ]),
      },
    };

    const schedules = await getActiveGuildSchedules(
      guild as never,
      member as never,
      "schedule-category",
    );

    expect(schedules).toEqual([
      {
        title: "Earlier schedule",
        timestamp: "<t:3470905800:F>",
        channelName: "endless-cellar-signup",
        channelUrl: "https://discord.com/channels/guild/earlier-schedule",
        isSignedUp: false,
        isReserve: false,
        charNote: undefined,
      },
      {
        title: "New schedule",
        timestamp: "<t:4070905800:F>",
        channelName: "wolfchev-signup",
        channelUrl: "https://discord.com/channels/guild/schedule",
        isSignedUp: false,
        isReserve: true,
        charNote: "_give link_",
      },
    ]);
    expect(inaccessibleFetch).not.toHaveBeenCalled();

    const publicSchedules = await getActiveGuildSchedules(
      guild as never,
      member as never,
      "schedule-category",
      ["schedule-channel"],
    );
    expect(publicSchedules).toHaveLength(1);
    expect(publicSchedules[0]?.title).toBe("Earlier schedule");
  });

  it("extracts character notes from schedule description", async () => {
    const member = { displayName: "Lucian Blight" };
    const accessiblePermissions = { has: jest.fn().mockReturnValue(true) };
    const createMessage = (description: string) => ({
      author: { id: DISCORD_SETTINGS.guildScheduleBotId },
      createdTimestamp: 1,
      embeds: [
        {
          title: "Test Schedule",
          description,
          fields: [],
        },
      ],
    });
    const createAccessibleChannel = (messages: Map<string, unknown>) => ({
      type: ChannelType.GuildText,
      id: "schedule-channel",
      parentId: "schedule-category",
      name: "test-signup",
      url: "https://discord.com/channels/guild/schedule",
      permissionsFor: jest.fn().mockReturnValue(accessiblePermissions),
      messages: { fetch: jest.fn().mockResolvedValue(messages as never) },
    });

    const guildWithCharNote = {
      channels: {
        cache: new Map([
          [
            "schedule",
            createAccessibleChannel(
              new Map([
                [
                  "msg",
                  createMessage(
                    "`04`: 🎸 Clown - **Lucian Blight** (_Mango Bay_)\nYour Time: <t:4070905800:F>",
                  ),
                ],
              ]),
            ),
          ],
        ]),
      },
    };

    const schedulesWithNote = await getActiveGuildSchedules(
      guildWithCharNote as never,
      member as never,
      "schedule-category",
    );

    expect(schedulesWithNote).toHaveLength(1);
    expect(schedulesWithNote[0]?.charNote).toBe("_Mango Bay_");
  });

  it("includes finished schedules inside a provided schedule week window", async () => {
    const member = { displayName: "Lucian Blight" };
    const accessiblePermissions = { has: jest.fn().mockReturnValue(true) };
    const createMessage = (title: string, timestamp: string) => ({
      author: { id: DISCORD_SETTINGS.guildScheduleBotId },
      createdTimestamp: 1,
      embeds: [
        {
          title,
          description: `- **Lucian Blight**\nYour Time: ${timestamp}`,
          fields: [],
        },
      ],
    });
    const createAccessibleChannel = (
      id: string,
      messages: Map<string, ReturnType<typeof createMessage>>,
    ) => ({
      type: ChannelType.GuildText,
      id,
      parentId: "schedule-category",
      name: id,
      url: `https://discord.com/channels/guild/${id}`,
      permissionsFor: jest.fn().mockReturnValue(accessiblePermissions),
      messages: { fetch: jest.fn().mockResolvedValue(messages as never) },
    });
    const timeWindow: GuildScheduleTimeWindow = {
      start: new Date("2026-08-31T06:00:00Z"),
      end: new Date("2026-09-07T06:00:00Z"),
    };
    const guild = {
      channels: {
        cache: new Map([
          [
            "finished-this-week",
            createAccessibleChannel(
              "finished-this-week",
              new Map([
                [
                  "schedule",
                  createMessage(
                    "Finished this week",
                    getDiscordTimestamp("2026-09-01T08:00:00Z"),
                  ),
                ],
              ]),
            ),
          ],
          [
            "outside-this-week",
            createAccessibleChannel(
              "outside-this-week",
              new Map([
                [
                  "schedule",
                  createMessage(
                    "Outside this week",
                    getDiscordTimestamp("2026-09-08T08:00:00Z"),
                  ),
                ],
              ]),
            ),
          ],
        ]),
      },
    };

    const schedules = await getActiveGuildSchedules(
      guild as never,
      member as never,
      "schedule-category",
      [],
      timeWindow,
    );

    expect(schedules.map((schedule) => schedule.title)).toEqual([
      "Finished this week",
    ]);
  });
});
