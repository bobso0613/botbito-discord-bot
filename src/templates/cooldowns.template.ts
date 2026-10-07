import { EmbedBuilder } from "discord.js";
import type { InstanceType } from "../constants/cooldowns.js";
import type { InteractionContext } from "../types/interaction-context.js";
import { getEmbedFooter } from "../utils/payout-embed.js";

/**
 * Formats a single cooldown entry with instance type emoji, name, and attempt counts.
 * Omits the attempt limit for any type with maxAttempts set to zero.
 * A null type is displayed as Others with its default emoji.
 */
export const formatCooldownEntry = (
  instanceType: InstanceType | null,
  count: number,
): string => {
  if (!instanceType) {
    return `💀 Others - **${count}**`;
  }

  if (instanceType.maxAttempts === 0) {
    return `${instanceType.emoji} ${instanceType.name} - **${count}**`;
  }

  return `${instanceType.emoji} ${instanceType.name} - **${count}** out of **${instanceType.maxAttempts}**`;
};

/** Builds the cooldowns embed for the command response. */
export const buildMyCooldownsEmbed = (
  cooldownText: string,
  dateRange: string,
  guildsWithSignups: string[],
  context: InteractionContext,
): EmbedBuilder => {
  const footer: { text: string; iconURL?: string } = getEmbedFooter(context);

  // Build disclaimer message
  const disclaimerText =
    guildsWithSignups.length > 0
      ? `**Disclaimer**:\n- *only counted from **${guildsWithSignups.join(", ")}** schedules. If you have sign-ups elsewhere, I cannot count those.*\n- *I also cannot count lockouts*`
      : "*No signups found for this week.*";

  return new EmbedBuilder()
    .setAuthor({
      name: `⏲️ ${context.displayName} (@${context.discordTag})`,
    })
    .setTitle(`Your Attempts - ${dateRange}`)
    .setColor("#d16200")
    .setThumbnail(context.userAvatarUrl)
    .setDescription(cooldownText || "No signups found for this week.")
    .addFields(
      {
        name: "\u200b",
        value: `${disclaimerText}\ntype \`@instanceinfo\` in game for more accurate counting.`,
      },
      {
        name: "\u200b",
        value: `command invoked by <@${context.userId}>\nuse \`/mysched thisweekonly=true\` for more details`,
      },
    )
    .setTimestamp()
    .setFooter(footer);
};
