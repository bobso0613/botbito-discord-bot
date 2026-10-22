import { describe, expect, it } from "@jest/globals";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import type { InteractionContext } from "../types/interaction-context.js";
import {
  buildPayoutEmbed,
  buildPayoutEmbeds,
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
  it.each([300, 1500])(
    "paginates %s vending links within message character and field limits",
    (count) => {
      const threads = Array.from(
        { length: count },
        (_, index) => `<#${String(1234567890123456789n + BigInt(index))}>`,
      );
      const pages = buildPayoutEmbeds(
        {
          pending: 123456,
          shareReady: 999999,
          distributed: 456789,
          currency: "z",
        },
        {
          ...context,
          displayName: "Member".repeat(20),
          guildName: "Guild".repeat(20),
        },
        threads,
      );
      expect(pages.length).toBeGreaterThan(1);
      for (const page of pages) {
        const data = page.toJSON();
        const textLength =
          (data.author?.name.length ?? 0) +
          (data.title?.length ?? 0) +
          (data.description?.length ?? 0) +
          (data.footer?.text.length ?? 0) +
          data.fields!.reduce(
            (sum, field) => sum + field.name.length + field.value.length,
            0,
          );
        expect(textLength).toBeLessThanOrEqual(6000);
        expect(data.fields!.length).toBeLessThanOrEqual(25);
        expect(data.fields!.every((field) => field.value.length <= 1024)).toBe(
          true,
        );
      }
      const allFields = pages.flatMap((page) => page.toJSON().fields!);
      expect(
        allFields
          .filter((field) => field.name.startsWith("🛒 Currently Vending"))
          .flatMap((field) => field.value.split("\n")),
      ).toEqual(threads);
      expect(
        allFields.filter((field) => field.name.includes("Distributed")),
      ).toHaveLength(1);
      expect(allFields.at(-1)?.value).toContain("Please ping");
    },
  );
  it("lists vending threads after a single non-inline spacer below Distributed", () => {
    const embed = buildPayoutEmbed(
      { pending: 0, shareReady: 0, distributed: 0, currency: "z" },
      context,
      ["<#first-thread>", "<#second-thread>"],
    );
    const fields = embed.toJSON().fields!;
    const distributedIndex = fields.findIndex(
      (field) => field.name === "✅ Distributed",
    );
    expect(fields.slice(distributedIndex + 1, distributedIndex + 3)).toEqual([
      { name: "\u200b", value: "", inline: false },
      {
        name: "🛒 Currently Vending",
        value: "<#first-thread>\n<#second-thread>",
        inline: false,
      },
    ]);
  });

  it("splits long vending lists without dropping threads", () => {
    const threads = Array.from(
      { length: 60 },
      (_, index) => `<#1234567890123456${index.toString().padStart(2, "0")}>`,
    );
    const fields = buildPayoutEmbed(
      { pending: 0, shareReady: 0, distributed: 0, currency: "z" },
      context,
      threads,
    )
      .toJSON()
      .fields!.filter((field) => field.name.startsWith("🛒 Currently Vending"));
    expect(fields).toHaveLength(2);
    expect(fields.map((field) => field.name)).toEqual([
      "🛒 Currently Vending",
      "🛒 Currently Vending (continued)",
    ]);
    expect(fields.every((field) => field.value.length <= 1024)).toBe(true);
    expect(fields.flatMap((field) => field.value.split("\n"))).toEqual(threads);
  });

  it("shows the empty vending state", () => {
    const embed = buildPayoutEmbed(
      { pending: 0, shareReady: 0, distributed: 1, currency: "z" },
      context,
    );
    expect(embed.toJSON().fields).toContainEqual({
      name: "🛒 Currently Vending",
      value: "None",
      inline: false,
    });
  });

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
          value: "`2,000 z`",
        }),
        expect.objectContaining({
          name: "\u200b",
          value: expect.stringContaining(
            `<@${DISCORD_SETTINGS.payoutToPingId}>`,
          ),
        }),
      ]),
    );
    const fields = embed.toJSON().fields!;
    expect(fields.at(-2)?.name).toBe("🛒 Currently Vending");
    expect(fields.at(-1)?.value).toContain("Please ping");
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
    expect(JSON.stringify(embed.toJSON())).not.toContain("Please ping");
  });

  it("omits the entire claim reminder when the payout contact invokes payout", () => {
    const embed = buildPayoutEmbed(
      { pending: 500, shareReady: 1_000, distributed: 2_000, currency: "z" },
      { ...context, userId: DISCORD_SETTINGS.payoutToPingId },
    );
    const distributedField = embed.data.fields?.find(
      (field) => field.name === "✅ Distributed",
    );

    expect(distributedField?.value).toBe("`2,000 z`");
    const data = embed.toJSON();
    expect(JSON.stringify(data)).not.toContain("Please ping");
    expect(JSON.stringify(data)).not.toContain("Oh wait");
    expect(data.fields?.at(-1)?.name).toBe("🛒 Currently Vending");
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

  it("omits the entire Distribution field when the payout contact invokes a Share Ready summary", () => {
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

    expect(distributionField).toBeUndefined();
    expect(JSON.stringify(embed.toJSON())).not.toContain("Please ping");
    expect(JSON.stringify(embed.toJSON())).not.toContain("Oh wait");
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
