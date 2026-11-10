import { EmbedBuilder, escapeMarkdown, type ColorResolvable } from "discord.js";
import type { InteractionContext } from "../types/interaction-context.js";
import type {
  PayoutStats,
  PayoutStatsOverall,
  StatsAmount,
  StatsView,
} from "../types/stats.js";
import { formatZeny } from "../utils/format-zeny.js";
import { getEmbedFooter } from "../utils/payout-embed.js";

export interface StatsDisplayUser {
  displayName: string;
  discordTag: string;
  avatarUrl: string;
}

const amountLabel = (amount: StatsAmount): string => {
  if (amount === "overall") return "Overall";
  return amount === "shareReady"
    ? "Share Ready"
    : amount[0]!.toUpperCase() + amount.slice(1);
};

const amountColor: Record<StatsAmount, ColorResolvable> = {
  overall: "#00b0f4",
  pending: "#8e7cc3",
  shareReady: "#ffd966",
  distributed: "#00ff00",
};

const formatRunCount = (
  joinedRuns: number,
  totalRuns: number,
  which: "Personal" | "Guild",
): string =>
  which === "Guild"
    ? `(${totalRuns} runs)`
    : `(${joinedRuns}/${totalRuns} joined)`;

const formatStatsAmount = (
  amount: number,
  joinedRuns: number,
  totalRuns: number,
  which: "Personal" | "Guild",
): string =>
  `${formatZeny(Math.trunc(amount))} ${formatRunCount(joinedRuns, totalRuns, which)}`;

const formatRankingPlayer = (
  player: NonNullable<PayoutStats["ranking"]>[number],
  includeRank: boolean,
): string => {
  const rankPrefix = includeRank ? `#${player.rank} ` : "";
  const discordName = escapeMarkdown(player.discordName);
  return `${rankPrefix}**${discordName}** - ${formatZeny(Math.trunc(player.amount))} (${player.impactPercent.toFixed(2)} %)`;
};

const formatPersonalImpact = (
  standing: PayoutStatsOverall["personalStanding"],
): string =>
  standing
    ? `\nImpact: \`${standing.impactPercent.toFixed(2)} %\` | Rank \`#${standing.rank}\` of \`${standing.playerCount}\``
    : "";

const addRankingFields = (
  embed: EmbedBuilder,
  ranking: NonNullable<PayoutStats["ranking"]>,
  personalStanding: PayoutStatsOverall["personalStanding"],
): void => {
  const medalFields = [
    { name: "🥇1st", player: ranking[0] },
    { name: "🥈2nd", player: ranking[1] },
    { name: "🥉3rd", player: ranking[2] },
  ].map(({ name, player }) => ({
    name,
    value: player ? formatRankingPlayer(player, false) : "No ranked player.",
    inline: false,
  }));
  const remainingPlayers = ranking
    .slice(3)
    .map((player) => formatRankingPlayer(player, true));
  embed.addFields(...medalFields, {
    name: "✨4th-10th",
    value: remainingPlayers.length
      ? remainingPlayers.join("\n")
      : "No other ranked players.",
    inline: false,
  });
  embed.addFields({
    name: "🎖️Your Rank",
    value: personalStanding
      ? `#${personalStanding.rank} - ${formatZeny(Math.trunc(personalStanding.amount))} (${personalStanding.impactPercent.toFixed(2)} %)`
      : "Your rank is unavailable.",
    inline: false,
  });
};

const addCategoryFields = (
  embed: EmbedBuilder,
  categories: PayoutStats["categories"],
  which: Exclude<StatsView, "Ranking">,
): void => {
  if (!categories.length) {
    embed.addFields({
      name: "No matching runs",
      value: "No run amounts were found.",
      inline: false,
    });
    return;
  }
  embed.addFields(
    categories.map((category) => ({
      name: `${category.emoji} ${category.name}`,
      value: formatStatsAmount(
        category.amount,
        category.joinedRuns,
        category.totalRuns,
        which,
      ),
      inline: false,
    })),
  );
};

const addTotalField = (
  embed: EmbedBuilder,
  stats: PayoutStats,
  which: Exclude<StatsView, "Ranking">,
): void => {
  embed.addFields({
    name: "📋 TOTAL",
    value:
      formatStatsAmount(
        stats.overall.amount,
        stats.overall.joinedRuns,
        stats.overall.totalRuns,
        which,
      ) +
      (which === "Personal"
        ? formatPersonalImpact(stats.overall.personalStanding)
        : ""),
    inline: false,
  });
};

const addNotesField = (embed: EmbedBuilder): void => {
  embed.addFields({
    name: "\u200b",
    value: [
      "-# Total may not equal the sum of instance types because some runs are combined into one signup (for example, B2B ET+EC runs).",
      "-# Subject to change",
      "-# Thanks for joining our runs 🙏",
    ].join("\n"),
    inline: false,
  });
};

/** Builds the selected Personal, Guild, or Ranking statistics embed. */
export const buildStatsEmbed = (
  stats: PayoutStats,
  context: InteractionContext,
  displayUser: StatsDisplayUser,
  which: StatsView,
): EmbedBuilder => {
  const guildName = context.guildName ?? "this server";
  const subject =
    which !== "Personal"
      ? guildName
      : `${displayUser.displayName} / ${guildName}`;
  const categories = [...stats.categories].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const footer = getEmbedFooter(context);
  const embed = new EmbedBuilder()
    .setAuthor({
      name:
        which !== "Personal"
          ? `📊 ${guildName}`
          : `📊 ${displayUser.displayName} (@${displayUser.discordTag})`,
    })
    .setTitle(`Statistics - ${which}`)
    .setDescription(
      `Showing ${amountLabel(stats.amount)} amounts for ${subject}.`,
    )
    .setColor(amountColor[stats.amount])
    .setFooter(footer)
    .setTimestamp();
  const thumbnailUrl =
    which !== "Personal" ? context.guildIconUrl : displayUser.avatarUrl;
  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);

  if (which === "Ranking") {
    addRankingFields(
      embed,
      stats.ranking ?? [],
      stats.overall.personalStanding,
    );
  } else {
    addCategoryFields(embed, categories, which);
    addTotalField(embed, stats, which);
  }
  if (which !== "Ranking") addNotesField(embed);
  return embed;
};
