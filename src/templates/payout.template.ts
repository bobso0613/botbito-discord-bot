import { EmbedBuilder } from "discord.js";
import type { PayoutDetails } from "../services/payout.service.js";

export const buildPayoutEmbed = (details: PayoutDetails): EmbedBuilder => {
  return new EmbedBuilder()
    .setTitle("Payout Details")
    .setColor(0x2ecc71)
    .addFields(
      { name: "Recipient", value: `<@${details.recipient}>`, inline: true },
      {
        name: "Amount",
        value: `${details.amount} ${details.currency}`,
        inline: true,
      },
      { name: "Status", value: details.status, inline: true },
    )
    .setTimestamp();
};
