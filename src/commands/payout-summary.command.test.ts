import { describe, expect, it, jest } from "@jest/globals";
import { MessageFlags, type Guild } from "discord.js";
import type {
  PayoutAmount,
  PayoutSort,
  PayoutSortDirection,
  PayoutSummary,
} from "../types/payout.js";

const getPayoutSummary = jest.fn(
  async (
    _guildId: string,
    _amount: PayoutAmount,
    _sortBy: PayoutSort,
    _direction: PayoutSortDirection,
  ): Promise<PayoutSummary> => ({
    amount: "shareReady",
    payouts: [],
    total: 0,
    currency: "z",
  }),
);
const getDisplayNameByDiscordTag = jest.fn(
  async (_guild: Guild): Promise<Map<string, string>> =>
    new Map<string, string>(),
);
const resolvePayoutDisplayName = jest.fn().mockReturnValue("Alice");
const buildPayoutSummaryEmbed = jest.fn().mockReturnValue({ kind: "summary" });

jest.unstable_mockModule("../services/payout.service.js", () => ({
  getPayoutSummary,
}));
jest.unstable_mockModule("../utils/guild-members.js", () => ({
  getDisplayNameByDiscordTag,
  resolvePayoutDisplayName,
}));
jest.unstable_mockModule("../templates/payout.template.js", () => ({
  buildPayoutSummaryEmbed,
}));
jest.unstable_mockModule("../utils/interaction-context.js", () => ({
  getInteractionContext: () => ({}),
}));

const { payoutSummaryCommand } = await import("./payout-summary.command.js");
const createInteraction = (guildId: string | null = "499171225046876170") => ({
  guildId,
  guild: guildId ? { id: guildId } : null,
  reply: jest.fn(),
  deferReply: jest.fn(),
  editReply: jest.fn(),
  options: {
    getBoolean: jest.fn().mockReturnValue(false),
    getString: jest.fn().mockReturnValue(null),
  },
});

describe("payout summary command", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPayoutSummary.mockImplementation(
      async (): Promise<PayoutSummary> => ({
        amount: "shareReady",
        payouts: [{ discordTag: "alice", displayName: "alice", amount: 10 }],
        total: 10,
        currency: "z",
      }),
    );
  });

  it("rejects an unsupported guild", async () => {
    const interaction = createInteraction("unsupported-guild");
    await payoutSummaryCommand.execute(interaction as never);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });

  it("uses default summary choices and renders display names", async () => {
    const interaction = createInteraction();
    await payoutSummaryCommand.execute(interaction as never);
    expect(getPayoutSummary).toHaveBeenCalledWith(
      "499171225046876170",
      "shareReady",
      "amount",
      "desc",
    );
    expect(buildPayoutSummaryEmbed).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [{ kind: "summary" }],
    });
  });
});
