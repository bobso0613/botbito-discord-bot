import { jest } from "@jest/globals";
import { MessageFlags } from "discord.js";
import type { PayoutStats } from "../types/stats.js";

const getPayoutStats = jest.fn<() => Promise<PayoutStats>>();
const getDisplayNameByDiscordTag = jest
  .fn<() => Promise<Map<string, string>>>()
  .mockResolvedValue(new Map([["player1", "*Player_1*"]]));
const getInteractionContext = jest.fn().mockReturnValue({
  userId: "user-id",
  username: "alice",
  discordTag: "alice",
  displayName: "Alice",
  userAvatarUrl: "https://example.com/alice.png",
  guildId: "guild",
  guildName: "Test Guild",
  guildIconUrl: "https://example.com/guild.png",
});

jest.unstable_mockModule("../config/discord-settings.js", () => ({
  DISCORD_SETTINGS: {
    payoutWorksheets: { guild: "Guild 2026" },
    cooldownInstanceTypesByGuild: {},
  },
  PAYOUT_GUILD_IDS: ["guild"],
}));
jest.unstable_mockModule("../services/stats.service.js", () => ({
  getPayoutStats,
}));
jest.unstable_mockModule("../utils/guild-members.js", () => ({
  getDisplayNameByDiscordTag,
}));
jest.unstable_mockModule("../utils/interaction-context.js", () => ({
  getInteractionContext,
}));

const { statsCommand } = await import("./stats.command.js");

const createInteraction = (overrides: Record<string, unknown> = {}) => ({
  guildId: "guild",
  guild: { members: { cache: { get: jest.fn() } } },
  reply: jest.fn(),
  deferReply: jest.fn(),
  editReply: jest.fn(),
  options: {
    getString: jest.fn<(name: string) => string | null>().mockReturnValue(null),
    getBoolean: jest
      .fn<(name: string) => boolean | null>()
      .mockReturnValue(null),
    getUser: jest.fn().mockReturnValue(null),
  },
  ...overrides,
});

describe("/stats command", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPayoutStats.mockResolvedValue({
      amount: "overall",
      categories: [
        {
          name: "Endless Tower",
          emoji: "🪜",
          amount: 500_000_000.9,
          joinedRuns: 2,
          totalRuns: 3,
        },
        {
          name: "Endless Cellar",
          emoji: "📉",
          amount: 400_000_000,
          joinedRuns: 1,
          totalRuns: 2,
        },
      ],
      overall: {
        amount: 900_000_000,
        joinedRuns: 3,
        totalRuns: 4,
        personalStanding: {
          amount: 900_000_000,
          impactPercent: 37.5,
          rank: 3,
          playerCount: 10,
        },
      },
    });
  });

  it("defaults to Overall personal stats and builds the requested embed", async () => {
    const interaction = createInteraction();

    await statsCommand.execute(interaction as never);

    expect(getPayoutStats).toHaveBeenCalledWith(
      expect.objectContaining({
        worksheet: "Guild 2026",
        amount: "overall",
        discordTag: "alice",
      }),
    );
    const [reply] = (interaction.editReply as jest.Mock).mock.calls[0] as [
      { embeds: Array<{ toJSON: () => Record<string, unknown> }> },
    ];
    expect(reply.embeds[0]!.toJSON()).toMatchObject({
      author: { name: "📊 Alice (@alice)" },
      title: "Statistics - Personal",
      description: "Showing Overall amounts for Alice / Test Guild.",
      fields: [
        {
          name: "📉 Endless Cellar",
          value: "`400,000,000 z` (1/2 joined)",
          inline: false,
        },
        {
          name: "🪜 Endless Tower",
          value: "`500,000,000 z` (2/3 joined)",
          inline: false,
        },
        {
          name: "📋 TOTAL",
          value:
            "`900,000,000 z` (3/4 joined)\nImpact: `37.50 %` | Rank `#3` of `10`",
          inline: false,
        },
        {
          name: "\u200b",
          value: [
            "-# Total may not equal the sum of instance types because some runs are combined into one signup (for example, B2B ET+EC runs).",
            "-# Subject to change",
            "-# Thanks for joining our runs 🙏",
          ].join("\n"),
          inline: false,
        },
      ],
      thumbnail: { url: "https://example.com/alice.png" },
      color: 0x00b0f4,
      footer: {
        text: "Test Guild",
      },
    });
  });

  it("defers privately and accepts Guild totals without a user", async () => {
    getPayoutStats.mockResolvedValueOnce({
      amount: "pending",
      categories: [
        {
          name: "Endless Tower",
          emoji: "🪜",
          amount: 10,
          joinedRuns: 1,
          totalRuns: 2,
        },
      ],
      overall: { amount: 10, joinedRuns: 1, totalRuns: 2 },
    });
    const interaction = createInteraction({
      options: {
        getString: jest.fn((name: string) =>
          name === "which" ? "Guild" : name === "amount" ? "pending" : null,
        ),
        getBoolean: jest.fn((name: string) =>
          name === "sendprivately" ? true : null,
        ),
        getUser: jest.fn().mockReturnValue(null),
      },
    });

    await statsCommand.execute(interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(getPayoutStats).toHaveBeenCalledWith(
      expect.objectContaining({ worksheet: "Guild 2026", amount: "pending" }),
    );
    const [reply] = (interaction.editReply as jest.Mock).mock.calls[0] as [
      { embeds: Array<{ toJSON: () => Record<string, unknown> }> },
    ];
    expect(reply.embeds[0]!.toJSON()).toMatchObject({
      author: { name: "📊 Test Guild" },
      thumbnail: { url: "https://example.com/guild.png" },
      color: 0x8e7cc3,
      fields: [
        {
          name: "🪜 Endless Tower",
          value: "`10 z` (2 runs)",
          inline: false,
        },
        {
          name: "📋 TOTAL",
          value: "`10 z` (2 runs)",
          inline: false,
        },
        {
          name: "\u200b",
          value: [
            "-# Total may not equal the sum of instance types because some runs are combined into one signup (for example, B2B ET+EC runs).",
            "-# Subject to change",
            "-# Thanks for joining our runs 🙏",
          ].join("\n"),
          inline: false,
        },
      ],
    });
  });

  it("renders the top-ten Ranking fields with literal user tags", async () => {
    getPayoutStats.mockResolvedValueOnce({
      amount: "overall",
      categories: [],
      overall: {
        amount: 1_000_000,
        joinedRuns: 10,
        totalRuns: 10,
        personalStanding: {
          amount: 37_000.9,
          impactPercent: 4.5,
          rank: 12,
          playerCount: 20,
        },
      },
      ranking: Array.from({ length: 10 }, (_, index) => ({
        discordName: index === 0 ? "*Player_1*" : `player${index + 1}`,
        amount: 100_000 - index * 1_000,
        impactPercent: 10 - index,
        rank: index + 1,
      })),
    });
    const interaction = createInteraction({
      options: {
        getString: jest.fn((name: string) =>
          name === "which" ? "Ranking" : null,
        ),
        getBoolean: jest.fn().mockReturnValue(null),
        getUser: jest.fn().mockReturnValue(null),
      },
    });

    await statsCommand.execute(interaction as never);

    expect(getPayoutStats).toHaveBeenCalledWith(
      expect.objectContaining({
        worksheet: "Guild 2026",
        amount: "overall",
        includeRanking: true,
        rankingViewerTag: "alice",
      }),
    );
    const [reply] = (interaction.editReply as jest.Mock).mock.calls[0] as [
      { embeds: Array<{ toJSON: () => Record<string, unknown> }> },
    ];
    const embed = reply.embeds[0]!.toJSON();
    expect(embed).toMatchObject({
      title: "Statistics - Ranking",
      fields: [
        {
          name: "🥇1st",
          value: "**\\*Player\\_1\\*** - `100,000 z` (10.00 %)",
          inline: false,
        },
        {
          name: "🥈2nd",
          value: "**player2** - `99,000 z` (9.00 %)",
          inline: false,
        },
        {
          name: "🥉3rd",
          value: "**player3** - `98,000 z` (8.00 %)",
          inline: false,
        },
        {
          name: "✨4th-10th",
          value: [
            "#4 **player4** - `97,000 z` (7.00 %)",
            "#5 **player5** - `96,000 z` (6.00 %)",
            "#6 **player6** - `95,000 z` (5.00 %)",
            "#7 **player7** - `94,000 z` (4.00 %)",
            "#8 **player8** - `93,000 z` (3.00 %)",
            "#9 **player9** - `92,000 z` (2.00 %)",
            "#10 **player10** - `91,000 z` (1.00 %)",
          ].join("\n"),
          inline: false,
        },
        {
          name: "🎖️Your Rank",
          value: "#12 - `37,000 z` (4.50 %)",
          inline: false,
        },
      ],
    });
    expect(JSON.stringify(embed)).not.toContain("<@");
    expect(getDisplayNameByDiscordTag).toHaveBeenCalledWith(interaction.guild);
  });

  it("uses yellow for Share Ready statistics", async () => {
    getPayoutStats.mockResolvedValueOnce({
      amount: "shareReady",
      categories: [],
      overall: { amount: 0, joinedRuns: 0, totalRuns: 0 },
    });
    const interaction = createInteraction({
      options: {
        getString: jest.fn((name: string) =>
          name === "amount" ? "shareReady" : null,
        ),
        getBoolean: jest.fn().mockReturnValue(null),
        getUser: jest.fn().mockReturnValue(null),
      },
    });

    await statsCommand.execute(interaction as never);

    const [reply] = (interaction.editReply as jest.Mock).mock.calls[0] as [
      { embeds: Array<{ toJSON: () => { color: number } }> },
    ];
    expect(reply.embeds[0]!.toJSON().color).toBe(0xffd966);
  });

  it.each(["Guild", "Ranking"] as const)(
    "rejects a user selection with %s statistics",
    async (which) => {
      const interaction = createInteraction({
        options: {
          getString: jest.fn().mockReturnValue(which),
          getBoolean: jest.fn().mockReturnValue(null),
          getUser: jest.fn().mockReturnValue({ id: "other-user" }),
        },
      });

      await statsCommand.execute(interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: "The user option can only be used with Personal statistics.",
        flags: MessageFlags.Ephemeral,
      });
      expect(getPayoutStats).not.toHaveBeenCalled();
    },
  );
});
