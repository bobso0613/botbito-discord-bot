import { jest } from "@jest/globals";
import { MessageFlags } from "discord.js";
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

const allowedGuildId = "499171225046876170";
const allowedChannelId = "1470361558893723710";
const createInteraction = (overrides: Record<string, unknown> = {}) => ({
  guildId: allowedGuildId,
  channelId: allowedChannelId,
  guild: { id: allowedGuildId },
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
          fetch: jest
            .fn()
            .mockResolvedValue({ displayName: "Lucian Blight" } as never),
        },
        channels: { cache: new Map() },
      },
    });

    await guildSchedCommand.execute(interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
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
