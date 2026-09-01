import { EmbedBuilder } from "discord.js";
import type { PayoutDetails } from "../services/payout.service.js";
import type { InteractionContext } from "../utils/interaction-context.js";

export const buildPayoutEmbed = (
  details: PayoutDetails,
  context: InteractionContext,
): EmbedBuilder => {
  const formatAmount = (amount: number): string =>
    `\`${amount.toLocaleString()} ${details.currency}\``;
  const footer = context.guildIconUrl
    ? {
        text: context.guildName ?? "Direct Message",
        iconURL: context.guildIconUrl,
      }
    : { text: context.guildName ?? "Direct Message" };

  return new EmbedBuilder()
    .setAuthor({
      name: `💵 ${context.displayName} (@${context.discordTag})`,
    })
    .setTitle("Payout Status")
    .addFields(
      {
        name: "⌛ Pending",
        value: `${formatAmount(details.pending)}`,
        inline: true,
      },
      { name: "\u200b", value: "", inline: true },
      {
        name: "✅ Distributed",
        value: `${formatAmount(details.distributed)}`,
        inline: true,
      },
      { name: "\u200b", value: "", inline: false },
      {
        name: "☑️ Share Ready",
        value: `${formatAmount(details.shareReady)}\nYour monies are ready 🙏`,
        inline: false,
      },
    )
    .setThumbnail(context.userAvatarUrl)
    .setColor("#00b0f4")
    .setFooter(footer)
    .setTimestamp();
};
