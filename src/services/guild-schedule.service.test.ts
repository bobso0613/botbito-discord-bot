import { describe, expect, it, jest } from "@jest/globals";
import { ChannelType } from "discord.js";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import { getActiveGuildSchedules } from "./guild-schedule.service.js";

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
      },
      {
        title: "New schedule",
        timestamp: "<t:4070905800:F>",
        channelName: "wolfchev-signup",
        channelUrl: "https://discord.com/channels/guild/schedule",
        isSignedUp: false,
        isReserve: true,
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
});
