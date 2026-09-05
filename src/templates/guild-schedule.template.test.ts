import { describe, expect, it, jest } from "@jest/globals";
import type { InteractionContext } from "../types/interaction-context.js";
import {
  buildGuildScheduleEmbed,
  buildMyScheduleEmbed,
} from "./guild-schedule.template.js";

const context: InteractionContext = {
  userId: "user-id",
  username: "alice",
  discordTag: "alice",
  displayName: "Alice",
  userAvatarUrl: "https://cdn.discordapp.com/avatars/user-id/avatar.png",
  guildId: "guild-id",
  guildName: "Test Guild",
  guildIconUrl: "https://cdn.discordapp.com/icons/guild-id/icon.png",
};

describe("buildGuildScheduleEmbed", () => {
  it("builds an embed with linked schedule titles and timestamps", () => {
    const embed = buildGuildScheduleEmbed(
      [
        {
          title: "Endless Tower Wednesday",
          timestamp: "<t:4070905800:F>",
          channelName: "endless-tower-signup",
          channelUrl: "https://discord.com/channels/guild/channel",
          isSignedUp: false,
          isReserve: true,
        },
        {
          title: "Wolfchev",
          timestamp: "<t:4070909400:F>",
          channelName: "wolfchev-signup",
          channelUrl: "https://discord.com/channels/guild/wolfchev",
          isSignedUp: false,
          isReserve: false,
        },
      ],
      context,
      "Run Signups",
    );

    expect(embed.data).toMatchObject({
      title: "Upcoming Runs of Test Guild",
      description:
        "**__📝 Signed Up / 🪑 Reserve__:\n**\n🗓️ **[Endless Tower Wednesday](https://discord.com/channels/guild/channel)**\n<t:4070905800:F> (<t:4070905800:R>)\n↪ [#endless-tower-signup](https://discord.com/channels/guild/channel) - 🪑\n\n**------------------------------\n__Not Signed Up__:\n**\n🗓️ **[Wolfchev](https://discord.com/channels/guild/wolfchev)**\n<t:4070909400:F> (<t:4070909400:R>)\n↪ [#wolfchev-signup](https://discord.com/channels/guild/wolfchev)",
    });
  });

  it("displays character notes when present", () => {
    const embed = buildGuildScheduleEmbed(
      [
        {
          title: "Endless Tower Wednesday",
          timestamp: "<t:4070905800:F>",
          channelName: "endless-tower-signup",
          channelUrl: "https://discord.com/channels/guild/channel",
          isSignedUp: true,
          isReserve: false,
          charNote: "alt character",
        },
        {
          title: "Wolfchev",
          timestamp: "<t:4070909400:F>",
          channelName: "wolfchev-signup",
          channelUrl: "https://discord.com/channels/guild/wolfchev",
          isSignedUp: false,
          isReserve: true,
          charNote: "reserve slot",
        },
      ],
      context,
      "Run Signups",
    );

    const description = embed.data.description;
    expect(description).toContain("📝  - alt character");
    expect(description).toContain("🪑 - reserve slot");
  });

  it("omits signup headings and personal details for announcements", () => {
    const embed = buildGuildScheduleEmbed(
      [
        {
          title: "Endless Tower Wednesday",
          timestamp: "<t:4070905800:F>",
          channelName: "endless-tower-signup",
          channelUrl: "https://discord.com/channels/guild/channel",
          isSignedUp: true,
          isReserve: false,
          charNote: "alt character",
        },
        {
          title: "Wolfchev",
          timestamp: "<t:4070909400:F>",
          channelName: "wolfchev-signup",
          channelUrl: "https://discord.com/channels/guild/wolfchev",
          isSignedUp: false,
          isReserve: true,
          charNote: "reserve slot",
        },
      ],
      context,
      "Run Signups",
      true,
    );

    const description = embed.data.description ?? "";
    expect(description).not.toContain("Signed Up / 🪑 Reserve");
    expect(description).not.toContain("Not Signed Up");
    expect(description).not.toContain("📝");
    expect(description).not.toContain("🪑");
    expect(description).not.toContain("alt character");
    expect(description).not.toContain("reserve slot");
    expect(description).toContain("[#endless-tower-signup]");
    expect(description).toContain("[#wolfchev-signup]");
  });

  it("builds an empty-state embed when no schedules are active", () => {
    expect(
      buildGuildScheduleEmbed([], context, "Run Signups").data.description,
    ).toBe("No active schedules found.");
  });
});

describe("buildMyScheduleEmbed", () => {
  const personalSchedules = [
    {
      title: "Wolfchev",
      timestamp: "<t:4070909400:F>",
      channelName: "wolfchev-signup",
      channelUrl: "https://discord.com/channels/guild/wolfchev",
      isSignedUp: true,
      isReserve: false,
      guildName: "Fate Stay Night",
      guildIcon: "<:guildIcon_499171225046876170:1545375525017755699>",
    },
    {
      title: "Endless Tower Wednesday",
      timestamp: "<t:4070905800:F>",
      channelName: "endless-tower-signup",
      channelUrl: "https://discord.com/channels/guild/channel",
      isSignedUp: false,
      isReserve: true,
      charNote: "backup priest",
      guildName: "Ragnarok M",
      guildIcon: "<:guildIcon_92073842977030144:1545375402833215548>",
    },
  ];

  it("builds a personal schedule embed grouped by date by default", () => {
    const embed = buildMyScheduleEmbed(personalSchedules, context);

    expect(embed.data).toMatchObject({
      title: "Your upcoming schedules",
      thumbnail: { url: context.userAvatarUrl },
    });
    expect(embed.data.description).toContain(
      "**__📝 Signed Up / 🪑 Reserve__: **",
    );
    expect(embed.data.description).toContain(
      "<:guildIcon_499171225046876170:1545375525017755699> - Fate Stay Night\n🗓️ **[Wolfchev]",
    );
    expect(embed.data.description).toContain(
      "<:guildIcon_92073842977030144:1545375402833215548> - Ragnarok M\n🗓️ **[Endless Tower Wednesday]",
    );
    expect(embed.data.description).toContain("🪑 - backup priest");
  });

  it("builds a personal schedule embed grouped by guild", () => {
    const embed = buildMyScheduleEmbed(personalSchedules, context, "guild");

    expect(embed.data.description).toContain(
      "### <:guildIcon_499171225046876170:1545375525017755699> - Fate Stay Night\n🗓️ **[Wolfchev]",
    );
    expect(embed.data.description).toContain(
      "### <:guildIcon_92073842977030144:1545375402833215548> - Ragnarok M\n🗓️ **[Endless Tower Wednesday]",
    );
  });

  it("builds a personal schedule embed grouped by instance type", () => {
    const embed = buildMyScheduleEmbed(personalSchedules, context, "instance");

    expect(embed.data.description).toContain(
      "### Endless Tower\n<:guildIcon_92073842977030144:1545375402833215548> - Ragnarok M",
    );
    expect(embed.data.description).toContain(
      "### Wolfchev's Laboratory\n<:guildIcon_499171225046876170:1545375525017755699> - Fate Stay Night",
    );
  });

  it("builds a personal empty-state embed when no schedules are active", () => {
    expect(buildMyScheduleEmbed([], context).data.description).toBe(
      "No active schedules found.",
    );
  });

  it("uses a custom personal schedule title when provided", () => {
    expect(
      buildMyScheduleEmbed(
        personalSchedules,
        context,
        "date",
        "Your Schedule - 31 Aug to 06 Sept",
      ).data.title,
    ).toBe("Your Schedule - 31 Aug to 06 Sept");
  });

  it("uses a check mark for schedule titles that are already in the past", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-04T12:00:00Z"));

    try {
      const embed = buildMyScheduleEmbed(
        [
          {
            title: "Finished Run",
            timestamp: "<t:1788343200:F>",
            channelName: "finished-run",
            channelUrl: "https://discord.com/channels/guild/finished-run",
            isSignedUp: true,
            isReserve: false,
            guildName: "Fate Stay Night",
            guildIcon: "<:guildIcon_499171225046876170:1545375525017755699>",
          },
        ],
        context,
      );

      expect(embed.data.description).toContain("✅ **[Finished Run]");
    } finally {
      jest.useRealTimers();
    }
  });
});
