import { jest } from "@jest/globals";

const getPayoutDetails = jest.fn();
const getPayoutSummary = jest.fn();
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
  .fn()
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

const allowedGuildId = "499171225046876170";
const allowedChannelId = "1470361558893723710";
const createInteraction = (overrides: Record<string, unknown> = {}) => ({
  guildId: allowedGuildId,
  channelId: allowedChannelId,
  guild: { id: allowedGuildId },
  reply: jest.fn(),
  deferReply: jest.fn(),
  editReply: jest.fn(),
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
  });
});
