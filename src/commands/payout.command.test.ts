import { describe, expect, it, jest } from "@jest/globals";
import { MessageFlags } from "discord.js";
import type { PayoutDetails, PayoutLookup } from "../types/payout.js";

const getPayoutDetails =
  jest.fn<(lookup: PayoutLookup) => Promise<PayoutDetails>>();
const buildPayoutEmbed = jest.fn().mockReturnValue({ kind: "payout" });
const buildPayoutEmbedNotJoined = jest
  .fn()
  .mockReturnValue({ kind: "missing" });

jest.unstable_mockModule("../services/payout.service.js", () => ({
  getPayoutDetails,
}));
jest.unstable_mockModule("../templates/payout.template.js", () => ({
  buildPayoutEmbed,
  buildPayoutEmbedNotJoined,
}));
jest.unstable_mockModule("../utils/interaction-context.js", () => ({
  getInteractionContext: () => ({ discordTag: "alice" }),
}));

const { payoutCommand } = await import("./payout.command.js");
const guildId = "499171225046876170";
const createInteraction = (guildIdValue: string | null = guildId) => ({
  guildId: guildIdValue,
  reply: jest.fn(),
  deferReply: jest.fn(),
  editReply: jest.fn(),
  options: { getBoolean: jest.fn().mockReturnValue(false) },
});

describe("payout command", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [{ kind: "payout" }],
    });
  });
});
