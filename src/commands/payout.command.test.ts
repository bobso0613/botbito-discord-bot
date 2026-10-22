import { describe, expect, it, jest } from "@jest/globals";
import { MessageFlags } from "discord.js";
import type { PayoutDetails, PayoutLookup } from "../types/payout.js";

const getPayoutDetails =
  jest.fn<(lookup: PayoutLookup) => Promise<PayoutDetails>>();
const getCurrentlyVendingThreads = jest.fn<() => Promise<string[]>>();
const buildPayoutEmbed = jest.fn().mockReturnValue({ kind: "payout" });
const buildPayoutEmbedNotJoined = jest
  .fn()
  .mockReturnValue({ kind: "missing" });

jest.unstable_mockModule("../services/payout.service.js", () => ({
  getPayoutDetails,
}));
jest.unstable_mockModule("../services/signup-export.service.js", () => ({
  getCurrentlyVendingThreads,
}));
jest.unstable_mockModule("../templates/payout.template.js", () => ({
  buildPayoutEmbed,
  buildPayoutEmbedNotJoined,
}));
jest.unstable_mockModule("../utils/interaction-context.js", () => ({
  getInteractionContext: () => ({ discordTag: "alice", userId: "11111" }),
}));

const { payoutCommand } = await import("./payout.command.js");
const guildId = "499171225046876170";
const createInteraction = (guildIdValue: string | null = guildId) => ({
  guildId: guildIdValue,
  client: { channels: {} },
  reply: jest.fn(),
  deferReply: jest.fn(),
  editReply: jest.fn(),
  options: { getBoolean: jest.fn().mockReturnValue(false) },
});

describe("payout command", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCurrentlyVendingThreads.mockResolvedValue([]);
    getPayoutDetails.mockResolvedValue({
      pending: 1,
      shareReady: 0,
      distributed: 0,
      currency: "z",
    });
  });

  it("rejects guilds without configured payout data", async () => {
    const interaction = createInteraction("unsupported-guild");
    await payoutCommand.execute(interaction as never);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });

  it("loads and renders the invoking member's payout", async () => {
    const interaction = createInteraction();
    await payoutCommand.execute(interaction as never);
    expect(getPayoutDetails).toHaveBeenCalledWith({
      guildId,
      discordTag: "alice",
    });
    expect(getCurrentlyVendingThreads).toHaveBeenCalledWith(
      interaction.client,
      guildId,
      "11111",
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [{ kind: "payout" }],
    });
  });

  it("shows vending threads even when all sheet balances are zero", async () => {
    getPayoutDetails.mockResolvedValue({
      pending: 0,
      shareReady: 0,
      distributed: 0,
      currency: "z",
    });
    getCurrentlyVendingThreads.mockResolvedValue(["<#thread>"]);
    const interaction = createInteraction();
    await payoutCommand.execute(interaction as never);
    expect(buildPayoutEmbed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "11111" }),
      ["<#thread>"],
    );
    expect(buildPayoutEmbedNotJoined).not.toHaveBeenCalled();
  });

  it("keeps the not-joined response when balances and vending threads are empty", async () => {
    getPayoutDetails.mockResolvedValue({
      pending: 0,
      shareReady: 0,
      distributed: 0,
      currency: "z",
    });
    await payoutCommand.execute(createInteraction() as never);
    expect(buildPayoutEmbedNotJoined).toHaveBeenCalled();
  });
});
