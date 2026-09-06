import { EmbedBuilder } from "discord.js";
import type { InteractionContext } from "../types/interaction-context.js";
import type { PayoutDetails, PayoutSummary } from "../types/payout.js";
import { formatZeny } from "../utils/format-zeny.js";
import { getEmbedFooter } from "../utils/payout-embed.js";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";

const pepeMoneyRainEmojiId = process.env.PEPEMONEYRAIN_EMOJI_ID;

const getClaimMessage = (context: InteractionContext): string =>
  `Please ping <@${DISCORD_SETTINGS.payoutToPingId}> (@${DISCORD_SETTINGS.payoutToPingTag}) if you want to claim.${
    DISCORD_SETTINGS.payoutToPingId === context.userId
      ? " Oh wait, that's me! lol"
      : ""
  }`;

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
          details.shareReady > 0 ? `\n\n${getClaimMessage(context)}` : ""
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

/** Builds the guild-wide payout summary embed for the selected amount. */
export const buildPayoutSummaryEmbed = (
  summary: PayoutSummary,
  context: InteractionContext,
): EmbedBuilder => {
  const footer = getEmbedFooter(context);
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

  const description =
    summary.amount === "shareReady"
      ? "Available for release:"
      : summary.amount === "pending"
        ? "Currently vending:"
        : "";
  const embed = new EmbedBuilder()
    .setTitle("Payout Summary")
    .setThumbnail(context.guildIconUrl)
    .setColor("#fff194")
    .setFooter(footer)
    .setTimestamp();

  if (description !== undefined) {
    embed.setDescription(
      `${description ? `${description}\n` : ""}\`\`\`\n${payoutHeader}\n${payoutDivider}\n${payoutList}\n\`\`\``,
    );
  }

  return embed.addFields(
    {
      name: "Total",
      value: formatZeny(summary.total),
      inline: false,
    },
    ...(summary.amount === "shareReady"
      ? [
          {
            name: "Distribution",
            value: getClaimMessage(context),
            inline: false,
          },
        ]
      : []),
  );
};
