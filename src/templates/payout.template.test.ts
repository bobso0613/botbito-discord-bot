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

  it("adds the self-aware claim message when the payout contact invokes payout", () => {
    const embed = buildPayoutEmbed(
      { pending: 500, shareReady: 1_000, distributed: 2_000, currency: "z" },
      { ...context, userId: DISCORD_SETTINGS.payoutToPingId },
    );
    const distributedField = embed.data.fields?.find(
      (field) => field.name === "✅ Distributed",
    );

    expect(distributedField?.value).toContain("Oh wait, that's me! lol");
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
        amount: "shareReady",
        payouts: [{ displayName: "Alice", discordTag: "alice", amount: 1_000 }],
        total: 1_000,
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

  it("adds the self-aware claim message to a Share Ready summary", () => {
    const embed = buildPayoutSummaryEmbed(
      {
        amount: "shareReady",
        payouts: [{ displayName: "Alice", discordTag: "alice", amount: 1_000 }],
        total: 1_000,
        currency: "z",
      },
      { ...context, userId: DISCORD_SETTINGS.payoutToPingId },
    );
    const distributionField = embed.data.fields?.find(
      (field) => field.name === "Distribution",
    );

    expect(distributionField?.value).toContain("Oh wait, that's me! lol");
  });

  it("renders the empty summary state when no payouts are share ready", () => {
    const embed = buildPayoutSummaryEmbed(
      { amount: "shareReady", payouts: [], total: 0, currency: "z" },
      context,
    );

    expect(embed.data.description).toContain("No Share Ready payouts.");
  });

  it("renders Pending without the distribution field", () => {
    const embed = buildPayoutSummaryEmbed(
      {
        amount: "pending",
        payouts: [{ displayName: "Alice", discordTag: "alice", amount: 500 }],
        total: 500,
        currency: "z",
      },
      context,
    );

    expect(embed.data.description).toContain("Currently vending:");
    expect(embed.data.fields).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Distribution" }),
      ]),
    );
  });

  it("renders Distributed without a description label or distribution field", () => {
    const embed = buildPayoutSummaryEmbed(
      { amount: "distributed", payouts: [], total: 0, currency: "z" },
      context,
    );

    expect(embed.data.description).not.toContain("Available for release:");
    expect(embed.data.description).toContain("Distributed");
    expect(embed.data.fields).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Distribution" }),
      ]),
    );
  });
});
