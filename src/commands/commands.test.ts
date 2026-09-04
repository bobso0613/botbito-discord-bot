import { jest } from "@jest/globals";
import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
} from "discord.js";
import type { PayoutDetails, PayoutSummary } from "../types/payout.js";

const getPayoutDetails = jest.fn<() => Promise<PayoutDetails>>();
const getPayoutSummary = jest.fn<() => Promise<PayoutSummary>>();
const buildPayoutEmbed = jest.fn().mockReturnValue({ kind: "payout" });
const buildPayoutEmbedNotJoined = jest
  .fn()
  .mockReturnValue({ kind: "not-joined" });
const buildPayoutSummaryEmbed = jest.fn().mockReturnValue({ kind: "summary" });
const getInteractionContext = jest.fn().mockReturnValue({
  userId: "user-id",
  discordTag: "alice",
  displayName: "Alice",
  guildId: "499171225046876170",
  userAvatarUrl: "https://example.com/user.png",
});
const getDisplayNameByDiscordTag = jest
  .fn<() => Promise<Map<string, string>>>()
  .mockResolvedValue(new Map([["alice", "Alice"]]));
const resolvePayoutDisplayName = jest.fn().mockReturnValue("Alice");

jest.unstable_mockModule("../services/payout.service.js", () => ({
  getPayoutDetails,
  getPayoutSummary,
}));
jest.unstable_mockModule("../templates/payout.template.js", () => ({
  buildPayoutEmbed,
  buildPayoutEmbedNotJoined,
  buildPayoutSummaryEmbed,
}));
jest.unstable_mockModule("../utils/interaction-context.js", () => ({
  getInteractionContext,
}));
jest.unstable_mockModule("../utils/guild-members.js", () => ({
  getDisplayNameByDiscordTag,
  resolvePayoutDisplayName,
}));

const { payoutCommand } = await import("./payout.command.js");
const { payoutSummaryCommand } = await import("./payout-summary.command.js");
const { helpCommand } = await import("./help.command.js");
const { guildSchedCommand } = await import("./guildsched.command.js");
const { mySchedCommand } = await import("./mysched.command.js");
const { getGuildIcon } = await import("../utils/guild-schedule.js");

const allowedGuildId = "499171225046876170";
const allowedChannelId = "1470361558893723710";
const getSentEmbedData = <TData>(sendMock: jest.Mock): TData => {
  const [payload] = sendMock.mock.calls[0] as [
    { embeds: Array<{ data: TData }> },
  ];
  return payload.embeds[0].data;
};

const createInteraction = (overrides: Record<string, unknown> = {}) => ({
  guildId: allowedGuildId,
  channelId: allowedChannelId,
  guild: { id: allowedGuildId },
  client: {
    user: {
      avatarURL: jest.fn().mockReturnValue("https://example.com/avatar.png"),
    },
  },
  reply: jest.fn(),
  deferReply: jest.fn(),
  editReply: jest.fn(),
  options: {
    getString: jest.fn<(name: string) => string | null>().mockReturnValue(null),
    getBoolean: jest
      .fn<(name: string) => boolean | null>()
      .mockReturnValue(null),
  },
  ...overrides,
});

describe("command handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPayoutDetails.mockResolvedValue({
      pending: 100,
      shareReady: 0,
      distributed: 0,
      currency: "z",
    });
    getPayoutSummary.mockResolvedValue({
      shareReadyPayouts: [
        { displayName: "@alice", discordTag: "@alice", amount: 100 },
      ],
      totalShareReady: 100,
      currency: "z",
    });
  });

  it("shows help as an ephemeral embed", async () => {
    const interaction = createInteraction();

    await helpCommand.execute(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: [expect.anything()] }),
    );
    const reply = (interaction.reply as jest.Mock).mock.calls[0][0] as {
      embeds: Array<{
        data: { fields: Array<{ name: string; value: string }> };
      }>;
    };
    expect(reply.embeds[0].data.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "⌚ `/mysched`",
          value:
            "DM your signed-up and reserve schedules across accessible guilds",
        }),
        expect.objectContaining({
          name: "Parameters",
          value: expect.stringContaining(
            "**thisweekonly** (optional): Include completed runs from this schedule week, Monday 06:00 GMT through Sunday",
          ),
        }),
        expect.objectContaining({
          name: "Parameters",
          value: expect.stringContaining(
            "**grouping** (optional): Group schedules by date or guild (By Date default, By Guild)",
          ),
        }),
      ]),
    );
  });

  it("makes /mysched available in guilds and bot DMs", () => {
    expect(mySchedCommand.data.toJSON()).toMatchObject({
      integration_types: [ApplicationIntegrationType.GuildInstall],
      contexts: [InteractionContextType.Guild, InteractionContextType.BotDM],
      options: [
        expect.objectContaining({ name: "thisweekonly", type: 5 }),
        expect.objectContaining({ name: "grouping", type: 3 }),
      ],
    });
  });

  it("lists active schedules from bot embeds in the configured category", async () => {
    const permittedMember = {
      displayName: "Lucian Blight",
    };
    const accessibleChannelPermissions = {
      has: jest.fn().mockReturnValue(true),
    };
    const activeSchedule = {
      author: { id: "836060624911073291" },
      createdTimestamp: 2,
      embeds: [
        {
          title: "Endless Tower Wednesday",
          description: "*Your Time: <t:4070905800:F>*",
          fields: [],
        },
      ],
    };
    const previousSchedule = {
      author: { id: "836060624911073291" },
      createdTimestamp: 1,
      embeds: [
        {
          title: "Previous Schedule",
          description: "*Your Time: <t:4070905800:F>*",
          fields: [],
        },
      ],
    };
    const earlierSchedule = {
      author: { id: "836060624911073291" },
      createdTimestamp: 3,
      embeds: [
        {
          title: "Earlier Schedule",
          description: "*Your Time: <t:3470905800:F>*",
          fields: [],
        },
      ],
    };
    const interaction = createInteraction({
      user: { id: "user-id" },
      channel: {
        type: 0,
        parentId: "1481977001811247245",
      },
      guild: {
        id: allowedGuildId,
        members: {
          fetch: jest.fn().mockResolvedValue(permittedMember as never),
        },
        channels: {
          cache: new Map([
            [
              "schedule-channel",
              {
                type: 0,
                parentId: "1481977001811247245",
                url: "https://discord.com/channels/499171225046876170/schedule-channel",
                permissionsFor: jest
                  .fn()
                  .mockReturnValue(accessibleChannelPermissions),
                messages: {
                  fetch: jest.fn().mockResolvedValue(
                    new Map([
                      ["previous", previousSchedule],
                      ["active", activeSchedule],
                    ]) as never,
                  ),
                },
              },
            ],
            [
              "earlier-schedule-channel",
              {
                type: 0,
                parentId: "1481977001811247245",
                url: "https://discord.com/channels/499171225046876170/earlier-schedule-channel",
                permissionsFor: jest
                  .fn()
                  .mockReturnValue(accessibleChannelPermissions),
                messages: {
                  fetch: jest
                    .fn()
                    .mockResolvedValue(
                      new Map([["earlier", earlierSchedule]]) as never,
                    ),
                },
              },
            ],
            [
              "inaccessible-schedule-channel",
              {
                type: 0,
                parentId: "1481977001811247245",
                url: "https://discord.com/channels/499171225046876170/inaccessible-schedule-channel",
                permissionsFor: jest.fn().mockReturnValue({
                  has: jest.fn().mockReturnValue(false),
                }),
                messages: {
                  fetch: jest.fn(),
                },
              },
            ],
          ]),
        },
      },
    });

    await guildSchedCommand.execute(interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    const reply = (interaction.editReply as jest.Mock).mock.calls[0][0] as {
      embeds: Array<{ data: { description: string } }>;
    };
    expect(reply.embeds[0].data.description).toContain(
      "Endless Tower Wednesday",
    );
    expect(reply.embeds[0].data.description).not.toContain("Previous Schedule");
    expect(reply.embeds[0].data.description).toContain(
      "[Endless Tower Wednesday](https://discord.com/channels/499171225046876170/schedule-channel)",
    );
    expect(
      reply.embeds[0].data.description.indexOf("Earlier Schedule"),
    ).toBeLessThan(
      reply.embeds[0].data.description.indexOf("Endless Tower Wednesday"),
    );
  });

  it("makes guild schedules public when requested", async () => {
    const roleCache = new Map([
      ["1545320299220963458", { id: "1545320299220963458" }],
    ]);
    const interaction = createInteraction({
      options: {
        getString: jest
          .fn<(name: string) => string | null>()
          .mockReturnValue(null),
        getBoolean: jest
          .fn<(name: string) => boolean | null>()
          .mockReturnValue(true),
      },
      user: { id: "user-id" },
      channel: { type: 0, parentId: "1481977001811247245" },
      guild: {
        id: allowedGuildId,
        members: {
          fetch: jest.fn().mockResolvedValue({
            displayName: "Lucian Blight",
            roles: { cache: roleCache },
          } as never),
        },
        channels: { cache: new Map() },
      },
    });

    await guildSchedCommand.execute(interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({});
  });

  it("allows guild schedules in a configured exception channel", async () => {
    const interaction = createInteraction({
      user: { id: "user-id" },
      channelId: "499171225046876172",
      channel: { type: 0, parentId: "another-category" },
      guild: {
        id: allowedGuildId,
        members: {
          fetch: jest.fn().mockResolvedValue({
            displayName: "Lucian Blight",
            roles: { cache: new Map() },
          } as never),
        },
        channels: { cache: new Map() },
      },
    });

    await guildSchedCommand.execute(interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
  });

  it("denies public guild schedules to users without the required role", async () => {
    const interaction = createInteraction({
      options: {
        getString: jest
          .fn<(name: string) => string | null>()
          .mockReturnValue(null),
        getBoolean: jest
          .fn<(name: string) => boolean | null>()
          .mockReturnValue(true),
      },
      user: { id: "user-id" },
      channelId: "1542541803914403840", // Role-restricted channel without user having the role
      channel: { type: 0, parentId: "1481977001811247245" },
      guild: {
        id: allowedGuildId,
        members: {
          fetch: jest.fn().mockResolvedValue({
            displayName: "Lucian Blight",
            roles: { cache: new Map() }, // User has no roles
          } as never),
        },
        channels: { cache: new Map() },
      },
    });

    await guildSchedCommand.execute(interaction as never);

    // Should still defer (public reply), but the role-restricted channel should be excluded
    expect(interaction.deferReply).toHaveBeenCalledWith({});
  });

  it("sends personal schedules by DM across accessible guilds sorted by time", async () => {
    const sentDirectMessage = jest.fn();
    const permittedMember = {
      displayName: "Lucian Blight",
      roles: { cache: new Map() },
    };
    const accessibleChannelPermissions = {
      has: jest.fn().mockReturnValue(true),
    };
    const createScheduleGuild = ({
      guildId,
      guildName,
      payoutChannelId,
      categoryId,
      channelId,
      scheduleTitle,
      timestamp,
      rosterLine,
    }: {
      guildId: string;
      guildName: string;
      payoutChannelId: string;
      categoryId: string;
      channelId: string;
      scheduleTitle: string;
      timestamp: string;
      rosterLine: string;
    }) => ({
      id: guildId,
      name: guildName,
      members: {
        fetch: jest.fn().mockResolvedValue(permittedMember as never),
      },
      channels: {
        cache: new Map([
          [
            payoutChannelId,
            {
              type: 0,
              parentId: "payout-category",
              permissionsFor: jest
                .fn()
                .mockReturnValue(accessibleChannelPermissions),
            },
          ],
          [
            channelId,
            {
              type: 0,
              parentId: categoryId,
              name: `schedule-${guildId}`,
              url: `https://discord.com/channels/${guildId}/${channelId}`,
              permissionsFor: jest
                .fn()
                .mockReturnValue(accessibleChannelPermissions),
              messages: {
                fetch: jest.fn().mockResolvedValue(
                  new Map([
                    [
                      "schedule",
                      {
                        author: { id: "836060624911073291" },
                        createdTimestamp: 1,
                        embeds: [
                          {
                            title: scheduleTitle,
                            description: `*Your Time: ${timestamp}*\n${rosterLine}`,
                            fields: [],
                          },
                        ],
                      },
                    ],
                  ]) as never,
                ),
              },
            },
          ],
        ]),
      },
    });
    const laterGuild = createScheduleGuild({
      guildId: "499171225046876170",
      guildName: "Fate Stay Night",
      payoutChannelId: "1470361558893723710",
      categoryId: "1481977001811247245",
      channelId: "later-channel",
      scheduleTitle: "Later Run",
      timestamp: "<t:4070905800:F>",
      rosterLine: "- **Lucian Blight**",
    });
    laterGuild.channels.cache.set("not-signed-channel", {
      type: 0,
      parentId: "1481977001811247245",
      name: "not-signed-channel",
      url: "https://discord.com/channels/499171225046876170/not-signed-channel",
      permissionsFor: jest.fn().mockReturnValue(accessibleChannelPermissions),
      messages: {
        fetch: jest.fn().mockResolvedValue(
          new Map([
            [
              "schedule",
              {
                author: { id: "836060624911073291" },
                createdTimestamp: 1,
                embeds: [
                  {
                    title: "Not Signed Run",
                    description: "*Your Time: <t:3070905800:F>*",
                    fields: [],
                  },
                ],
              },
            ],
          ]) as never,
        ),
      },
    });
    const earlierGuild = createScheduleGuild({
      guildId: "92073842977030144",
      guildName: "Ragnarok M",
      payoutChannelId: "1465658706711547946",
      categoryId: "1494582316482297887",
      channelId: "earlier-channel",
      scheduleTitle: "Earlier Run",
      timestamp: "<t:3470905800:F>",
      rosterLine: "Reserve - **Lucian Blight** (Priest)",
    });
    const interaction = createInteraction({
      user: {
        id: "user-id",
        username: "alice",
        tag: "alice#0001",
        displayName: "Alice",
        displayAvatarURL: jest
          .fn()
          .mockReturnValue("https://example.com/user.png"),
        send: sentDirectMessage,
      },
      channelId: "any-visible-channel",
      channel: { type: 0, parentId: "any-category" },
      client: {
        guilds: {
          cache: new Map([
            ["499171225046876170", laterGuild],
            ["92073842977030144", earlierGuild],
          ]),
        },
      },
      guild: laterGuild,
    });

    await mySchedCommand.execute(interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(sentDirectMessage).toHaveBeenCalledWith({
      embeds: [expect.anything()],
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "Scheduled sent to your DM",
    });

    const embed = getSentEmbedData<{
      title: string;
      thumbnail: { url: string };
      description: string;
    }>(sentDirectMessage);
    expect(embed.title).toBe("Your upcoming schedules");
    expect(embed.thumbnail.url).toBe("https://example.com/user.png");
    expect(embed.description).toContain("**__📝 Signed Up / 🪑 Reserve__: **");
    expect(embed.description).toContain(
      `${getGuildIcon("92073842977030144")} - Ragnarok M\n🗓️ **[Earlier Run]`,
    );
    expect(embed.description).toContain(
      `${getGuildIcon("499171225046876170")} - Fate Stay Night\n🗓️ **[Later Run]`,
    );
    expect(embed.description.indexOf("Earlier Run")).toBeLessThan(
      embed.description.indexOf("Later Run"),
    );
    expect(embed.description).not.toContain("Not Signed Run");
    expect(embed.description).toContain("🪑 - Priest");

    const guildGroupedDm = jest.fn();
    const guildGroupedInteraction = createInteraction({
      options: {
        getString: jest.fn((name: string) =>
          name === "grouping" ? "guild" : null,
        ),
        getBoolean: jest
          .fn<(name: string) => boolean | null>()
          .mockReturnValue(null),
      },
      user: {
        id: "user-id",
        username: "alice",
        tag: "alice#0001",
        displayName: "Alice",
        displayAvatarURL: jest
          .fn()
          .mockReturnValue("https://example.com/user.png"),
        send: guildGroupedDm,
      },
      channelId: "another-visible-channel",
      channel: { type: 0, parentId: "another-category" },
      client: {
        guilds: {
          cache: new Map([
            ["499171225046876170", laterGuild],
            ["92073842977030144", earlierGuild],
          ]),
        },
      },
      guild: laterGuild,
    });

    await mySchedCommand.execute(guildGroupedInteraction as never);

    const guildGroupedDescription = getSentEmbedData<{ description: string }>(
      guildGroupedDm,
    ).description;
    expect(guildGroupedDescription.indexOf("Fate Stay Night")).toBeLessThan(
      guildGroupedDescription.indexOf("Ragnarok M"),
    );
    expect(guildGroupedDescription).toContain(
      `### ${getGuildIcon("499171225046876170")} - Fate Stay Night\n🗓️ **[Later Run]`,
    );
  });

  it("allows personal schedules to be requested directly from DM", async () => {
    const sentDirectMessage = jest.fn();
    const permittedMember = {
      displayName: "Lucian Blight",
      roles: { cache: new Map() },
    };
    const accessibleChannelPermissions = {
      has: jest.fn().mockReturnValue(true),
    };
    const scheduleGuild = {
      id: "499171225046876170",
      name: "Fate Stay Night",
      members: {
        fetch: jest.fn().mockResolvedValue(permittedMember as never),
      },
      channels: {
        cache: new Map([
          [
            "1470361558893723710",
            {
              type: 0,
              permissionsFor: jest
                .fn()
                .mockReturnValue(accessibleChannelPermissions),
            },
          ],
          [
            "schedule-channel",
            {
              type: 0,
              parentId: "1481977001811247245",
              name: "schedule-channel",
              url: "https://discord.com/channels/499171225046876170/schedule-channel",
              permissionsFor: jest
                .fn()
                .mockReturnValue(accessibleChannelPermissions),
              messages: {
                fetch: jest.fn().mockResolvedValue(
                  new Map([
                    [
                      "schedule",
                      {
                        author: { id: "836060624911073291" },
                        createdTimestamp: 1,
                        embeds: [
                          {
                            title: "DM Run",
                            description: "*Your Time: <t:4070905800:F>*",
                            fields: [],
                          },
                        ],
                      },
                    ],
                  ]) as never,
                ),
              },
            },
          ],
        ]),
      },
    };
    const interaction = createInteraction({
      guildId: null,
      guild: null,
      channel: { type: 1 },
      user: {
        id: "user-id",
        username: "alice",
        tag: "alice#0001",
        displayName: "Alice",
        displayAvatarURL: jest
          .fn()
          .mockReturnValue("https://example.com/user.png"),
        send: sentDirectMessage,
      },
      client: {
        guilds: {
          cache: new Map([["499171225046876170", scheduleGuild]]),
        },
      },
    });

    await mySchedCommand.execute(interaction as never);

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.deferReply).toHaveBeenCalledWith({});
    expect(sentDirectMessage).toHaveBeenCalledWith({
      embeds: [expect.anything()],
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "Scheduled sent to your DM",
    });
  });

  it("limits personal schedules to this week and updates the DM title", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-04T12:00:00Z"));
    const sentDirectMessage = jest.fn();
    const permittedMember = {
      displayName: "Lucian Blight",
      roles: { cache: new Map() },
    };
    const accessibleChannelPermissions = {
      has: jest.fn().mockReturnValue(true),
    };
    const getDiscordTimestamp = (date: string): string =>
      `<t:${Math.floor(new Date(date).getTime() / 1_000)}:F>`;
    const scheduleGuild = {
      id: "499171225046876170",
      name: "Fate Stay Night",
      members: {
        fetch: jest.fn().mockResolvedValue(permittedMember as never),
      },
      channels: {
        cache: new Map([
          [
            "finished-this-week",
            {
              type: 0,
              parentId: "1481977001811247245",
              name: "finished-this-week",
              url: "https://discord.com/channels/499171225046876170/finished-this-week",
              permissionsFor: jest
                .fn()
                .mockReturnValue(accessibleChannelPermissions),
              messages: {
                fetch: jest.fn().mockResolvedValue(
                  new Map([
                    [
                      "schedule",
                      {
                        author: { id: "836060624911073291" },
                        createdTimestamp: 1,
                        embeds: [
                          {
                            title: "Finished This Week",
                            description: `- **Lucian Blight**\nYour Time: ${getDiscordTimestamp("2026-09-01T08:00:00Z")}`,
                            fields: [],
                          },
                        ],
                      },
                    ],
                  ]) as never,
                ),
              },
            },
          ],
          [
            "outside-this-week",
            {
              type: 0,
              parentId: "1481977001811247245",
              name: "outside-this-week",
              url: "https://discord.com/channels/499171225046876170/outside-this-week",
              permissionsFor: jest
                .fn()
                .mockReturnValue(accessibleChannelPermissions),
              messages: {
                fetch: jest.fn().mockResolvedValue(
                  new Map([
                    [
                      "schedule",
                      {
                        author: { id: "836060624911073291" },
                        createdTimestamp: 1,
                        embeds: [
                          {
                            title: "Outside This Week",
                            description: `- **Lucian Blight**\nYour Time: ${getDiscordTimestamp("2026-09-08T08:00:00Z")}`,
                            fields: [],
                          },
                        ],
                      },
                    ],
                  ]) as never,
                ),
              },
            },
          ],
        ]),
      },
    };
    const interaction = createInteraction({
      options: {
        getString: jest
          .fn<(name: string) => string | null>()
          .mockReturnValue(null),
        getBoolean: jest.fn((name: string) => name === "thisweekonly"),
      },
      user: {
        id: "user-id",
        username: "alice",
        tag: "alice#0001",
        displayName: "Alice",
        displayAvatarURL: jest
          .fn()
          .mockReturnValue("https://example.com/user.png"),
        send: sentDirectMessage,
      },
      client: {
        guilds: {
          cache: new Map([["499171225046876170", scheduleGuild]]),
        },
      },
      guild: scheduleGuild,
    });

    try {
      await mySchedCommand.execute(interaction as never);
    } finally {
      jest.useRealTimers();
    }

    const embed = getSentEmbedData<{ title: string; description: string }>(
      sentDirectMessage,
    );
    expect(embed.title).toBe("Your Schedule - 31 Aug to 06 Sept");
    expect(embed.description).toContain("Finished This Week");
    expect(embed.description).not.toContain("Outside This Week");
  });

  it("denies payout commands outside the allowed server or channel", async () => {
    const outsideServer = createInteraction({ guildId: "other" });
    const outsideChannel = createInteraction({ channelId: "other" });

    await payoutCommand.execute(outsideServer as never);
    await payoutCommand.execute(outsideChannel as never);

    expect(outsideServer.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("not available"),
      }),
    );
    expect(outsideChannel.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("<#1470361558893723710>"),
      }),
    );
  });

  it("defers payout, then renders the matching payout or missing-member embed", async () => {
    const interaction = createInteraction();

    await payoutCommand.execute(interaction as never);
    expect(interaction.deferReply).toHaveBeenCalled();
    expect(buildPayoutEmbed).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [{ kind: "payout" }],
    });

    getPayoutDetails.mockResolvedValue({
      pending: 0,
      shareReady: 0,
      distributed: 0,
      currency: "z",
    });
    const missingMember = createInteraction();
    await payoutCommand.execute(missingMember as never);

    expect(buildPayoutEmbedNotJoined).toHaveBeenCalled();
  });

  it("applies the same permissions and renders an enriched payout summary", async () => {
    const blocked = createInteraction({ channelId: "other" });
    await payoutSummaryCommand.execute(blocked as never);
    expect(blocked.reply).toHaveBeenCalled();

    const interaction = createInteraction();
    await payoutSummaryCommand.execute(interaction as never);

    expect(getDisplayNameByDiscordTag).toHaveBeenCalledWith(interaction.guild);
    expect(resolvePayoutDisplayName).toHaveBeenCalled();
    expect(buildPayoutSummaryEmbed).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [{ kind: "summary" }],
    });
    expect(getPayoutSummary).toHaveBeenCalledWith(
      allowedGuildId,
      "amount",
      "desc",
    );

    const sortedInteraction = createInteraction({
      options: {
        getString: jest.fn((name: string) =>
          name === "sort" ? "name" : "asc",
        ),
      },
    });
    await payoutSummaryCommand.execute(sortedInteraction as never);

    expect(getPayoutSummary).toHaveBeenLastCalledWith(
      allowedGuildId,
      "name",
      "asc",
    );
  });
});
