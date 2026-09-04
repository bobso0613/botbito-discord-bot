import { describe, expect, it } from "@jest/globals";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import type { InteractionContext } from "../types/interaction-context.js";
import {
  buildPayoutEmbed,
  buildPayoutEmbedNotJoined,
  buildPayoutSummaryEmbed,
} from "./payout.template.js";

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

describe("payout embed builders", () => {
  it("builds a payout status embed with balances and a claim contact", () => {
    const embed = buildPayoutEmbed(
      { pending: 500, shareReady: 1_000, distributed: 2_000, currency: "z" },
      context,
    );

    expect(embed.data).toMatchObject({
      author: { name: "💵 Alice (@alice)" },
      title: "Payout Status",
      thumbnail: { url: context.userAvatarUrl },
    });
    expect(embed.data.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: `<a:pepemoneyrain:${process.env.PEPEMONEYRAIN_EMOJI_ID}> Claimable`,
          value: "`1,000 z`",
        }),
        expect.objectContaining({ name: "⌛ Pending", value: "`500 z`" }),
        expect.objectContaining({
          name: "✅ Distributed",
          value: expect.stringContaining(
            `<@${DISCORD_SETTINGS.payoutToPingId}>`,
          ),
        }),
      ]),
    );
  });

  it("omits the claim contact when no payout is share ready", () => {
    const embed = buildPayoutEmbed(
      { pending: 500, shareReady: 0, distributed: 2_000, currency: "z" },
      context,
    );
    const distributedField = embed.data.fields?.find(
      (field) => field.name === "✅ Distributed",
    );

    expect(distributedField?.value).toBe("`2,000 z`");
  });

  it("builds the not-joined payout status message", () => {
    const embed = buildPayoutEmbedNotJoined(context);

    expect(embed.data).toMatchObject({
      author: { name: "💵 Alice (@alice)" },
      title: "Payout Status",
      description: expect.stringContaining("Hello Alice"),
      thumbnail: { url: context.userAvatarUrl },
    });
  });

  it("builds a payout summary with payout rows and distribution contact", () => {
    const embed = buildPayoutSummaryEmbed(
      {
        shareReadyPayouts: [
          { displayName: "Alice", discordTag: "alice", amount: 1_000 },
        ],
        totalShareReady: 1_000,
        currency: "z",
      },
      context,
    );

    expect(embed.data).toMatchObject({
      title: "Payout Summary",
      description: expect.stringContaining("Alice"),
      thumbnail: { url: context.guildIconUrl },
    });
    expect(embed.data.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Total", value: "`1,000 z`" }),
        expect.objectContaining({
          name: "Distribution",
          value: expect.stringContaining(
            `<@${DISCORD_SETTINGS.payoutToPingId}>`,
          ),
        }),
      ]),
    );
  });

  it("renders the empty summary state when no payouts are share ready", () => {
    const embed = buildPayoutSummaryEmbed(
      { shareReadyPayouts: [], totalShareReady: 0, currency: "z" },
      context,
    );

    expect(embed.data.description).toContain("No Share Ready payouts.");
  });
});
