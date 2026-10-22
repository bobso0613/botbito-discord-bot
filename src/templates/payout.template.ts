import { EmbedBuilder } from "discord.js";
import type { InteractionContext } from "../types/interaction-context.js";
import type { PayoutDetails, PayoutSummary } from "../types/payout.js";
import { formatZeny } from "../utils/format-zeny.js";
import { getEmbedFooter } from "../utils/payout-embed.js";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";

const pepeMoneyRainEmojiId = process.env.PEPEMONEYRAIN_EMOJI_ID;

const getClaimMessage = (context: InteractionContext): string =>
  DISCORD_SETTINGS.payoutToPingId === context.userId
    ? ""
    : `Please ping <@${DISCORD_SETTINGS.payoutToPingId}> (@${DISCORD_SETTINGS.payoutToPingTag}) if you want to claim.`;

/**
 * Builds payout balances with Currently Vending directly below Distributed.
 * Splits vending links into fields of at most 1,024 characters; an empty list displays None.
 * Shows the claim reminder after vending only for share-ready members other than the payout contact.
 * @param details Member's payout-sheet balances.
 * @param context Invoking member and guild display information.
 * @param vendingThreads Pre-filtered Discord thread mentions from signup-export history.
 * @returns Payout-status embed, including when only vending threads are present.
 */
export const buildPayoutEmbed = (
  details: PayoutDetails,
  context: InteractionContext,
  vendingThreads: readonly string[] = [],
): EmbedBuilder => {
  const footer = getEmbedFooter(context);
  const claimMessage = details.shareReady > 0 ? getClaimMessage(context) : "";
  const vendingFields: string[] = [];
  for (const thread of vendingThreads) {
    const lastIndex = vendingFields.length - 1;
    const previous = vendingFields[lastIndex];
    if (previous && previous.length + thread.length + 1 <= 1024) {
      vendingFields[lastIndex] = `${previous}\n${thread}`;
    } else {
      vendingFields.push(thread);
    }
  }
  if (vendingFields.length === 0) vendingFields.push("None");

  return new EmbedBuilder()
    .setAuthor({
      name: `💵 ${context.displayName} (@${context.discordTag})`,
    })
    .setTitle("Payout Status")
    .addFields(
      {
        name: `<a:pepemoneyrain:${pepeMoneyRainEmojiId}> Claimable`,
        value: `${formatZeny(details.shareReady)}`,
        inline: true,
      },
      {
        name: "⌛ Pending",
        value: formatZeny(details.pending),
        inline: true,
      },
      { name: "\u200b", value: "", inline: true },
      { name: "\u200b", value: "", inline: false },
      {
        name: "✅ Distributed",
        value: formatZeny(details.distributed),
        inline: false,
      },
      ...vendingFields.map((value, index) => ({
        name:
          index === 0
            ? "🛒Currently Vending"
            : "🛒Currently Vending (continued)",
        value,
        inline: false,
      })),
      ...(claimMessage
        ? [{ name: "\u200b", value: claimMessage, inline: false }]
        : []),
    )
    .setThumbnail(context.userAvatarUrl)
    .setColor("#00b0f4")
    .setFooter(footer)
    .setTimestamp();
};

/** Builds the not-joined response when all sheet balances are zero and no vending threads qualify. */
export const buildPayoutEmbedNotJoined = (
  context: InteractionContext,
): EmbedBuilder => {
  const footer = getEmbedFooter(context);

  return new EmbedBuilder()
    .setAuthor({
      name: `💵 ${context.displayName} (@${context.discordTag})`,
    })
    .setTitle("Payout Status")
    .setDescription(
      `Hello ${context.displayName}, I cannot see your name in the list. 🫠\nPlease join our runs 🥺🙏`,
    )
    .setColor("#ff9494")
    .setThumbnail(context.userAvatarUrl)
    .setFooter(footer)
    .setTimestamp();
};

/** Builds the guild-wide payout summary, omitting the claim reminder for the payout contact. */
export const buildPayoutSummaryEmbed = (
  summary: PayoutSummary,
  context: InteractionContext,
): EmbedBuilder => {
  const footer = getEmbedFooter(context);
  const claimMessage = getClaimMessage(context);
  const nameColumnWidth = 16;
  const amountColumnWidth = 16;
  const amountLabel =
    summary.amount === "shareReady"
      ? "Share Ready"
      : summary.amount[0].toUpperCase() + summary.amount.slice(1);
  const payoutHeader = `${"Name".padEnd(nameColumnWidth)} ${amountLabel.padStart(amountColumnWidth)}`;
  const payoutDivider = `${"-".repeat(nameColumnWidth)} ${"-".repeat(amountColumnWidth)}`;
  const payoutList = summary.payouts.length
    ? summary.payouts
        .map((payout) => {
          const amount = `${payout.amount.toLocaleString()} z`;
          return `${payout.displayName.padEnd(nameColumnWidth)} ${amount.padStart(amountColumnWidth)}`;
        })
        .join("\n")
    : `No ${amountLabel} payouts.`;

  let description = "";
  if (summary.amount === "shareReady") {
    description = "Available for release:";
  } else if (summary.amount === "pending") {
    description = "Currently vending:";
  }
  const embed = new EmbedBuilder()
    .setTitle("Payout Summary")
    .setThumbnail(context.guildIconUrl)
    .setColor("#fff194")
    .setFooter(footer)
    .setTimestamp();

  if (description !== undefined) {
    const descriptionBlock = description ? `${description}\n` : "";
    embed.setDescription(
      `${descriptionBlock}\`\`\`\n${payoutHeader}\n${payoutDivider}\n${payoutList}\n\`\`\``,
    );
  }

  return embed.addFields(
    {
      name: "Total",
      value: formatZeny(summary.total),
      inline: false,
    },
    ...(summary.amount === "shareReady" && claimMessage
      ? [
          {
            name: "Distribution",
            value: claimMessage,
            inline: false,
          },
        ]
      : []),
  );
};
