import { EmbedBuilder } from "discord.js";
import type { InteractionContext } from "../types/interaction-context.js";
import type { PayoutDetails, PayoutSummary } from "../types/payout.js";
import { formatZeny } from "../utils/format-zeny.js";
import { getEmbedFooter } from "../utils/payout-embed.js";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";

const pepeMoneyRainEmojiId = process.env.PEPEMONEYRAIN_EMOJI_ID;

/** Builds the standard payout-status embed for a member. */
export const buildPayoutEmbed = (
  details: PayoutDetails,
  context: InteractionContext,
): EmbedBuilder => {
  const footer = getEmbedFooter(context);

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
        value: `${formatZeny(details.distributed)}${
          details.shareReady > 0
            ? `\n\nPlease ping <@${DISCORD_SETTINGS.payoutToPingId}> (@${DISCORD_SETTINGS.payoutToPingTag}) if you want to claim.`
            : ""
        }`,
        inline: false,
      },
    )
    .setThumbnail(context.userAvatarUrl)
    .setColor("#00b0f4")
    .setFooter(footer)
    .setTimestamp();
};

/** Builds the payout-status embed shown when a member is not in the payout sheet. */
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

/** Builds the guild-wide Share Ready payout summary embed. */
export const buildPayoutSummaryEmbed = (
  summary: PayoutSummary,
  context: InteractionContext,
): EmbedBuilder => {
  const footer = getEmbedFooter(context);
  const nameColumnWidth = 16;
  const amountColumnWidth = 16;
  const shareReadyHeader = `${"Name".padEnd(nameColumnWidth)} ${"Share Ready".padStart(amountColumnWidth)}`;
  const shareReadyDivider = `${"-".repeat(nameColumnWidth)} ${"-".repeat(amountColumnWidth)}`;
  const shareReadyList = summary.shareReadyPayouts.length
    ? summary.shareReadyPayouts
        .map((payout) => {
          const amount = `${payout.amount.toLocaleString()} z`;
          return `${payout.displayName.padEnd(nameColumnWidth)} ${amount.padStart(amountColumnWidth)}`;
        })
        .join("\n")
    : "No Share Ready payouts.";

  return new EmbedBuilder()
    .setTitle("Payout Summary")
    .setDescription(
      `Available for release:\n\`\`\`\n${shareReadyHeader}\n${shareReadyDivider}\n${shareReadyList}\n\`\`\``,
    )
    .addFields(
      {
        name: "Total",
        value: formatZeny(summary.totalShareReady),
        inline: false,
      },
      {
        name: "Distribution",
        value: `Please ping <@${DISCORD_SETTINGS.payoutToPingId}> (@${DISCORD_SETTINGS.payoutToPingTag}) if you want to claim.`,
        inline: false,
      },
    )
    .setThumbnail(context.guildIconUrl)
    .setColor("#fff194")
    .setFooter(footer)
    .setTimestamp();
};
