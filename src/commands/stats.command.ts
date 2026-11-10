import {
  type Guild,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type User,
} from "discord.js";
import {
  DISCORD_SETTINGS,
  PAYOUT_GUILD_IDS,
} from "../config/discord-settings.js";
import { COOLDOWN_INSTANCE_TYPES } from "../constants/cooldowns.js";
import { getPayoutStats } from "../services/stats.service.js";
import {
  buildStatsEmbeds,
  type StatsDisplayUser,
} from "../templates/stats.template.js";
import type { Command } from "../types/command.js";
import type { InteractionContext } from "../types/interaction-context.js";
import type { PayoutStats, StatsAmount, StatsView } from "../types/stats.js";
import { getDisplayNameByDiscordTag } from "../utils/guild-members.js";
import { getInteractionContext } from "../utils/interaction-context.js";

const unavailableMessage =
  "This command is not available in this server because it has no configured payout data.";

const resolveStatsView = (value: string | null): StatsView =>
  value === "Guild" || value === "Ranking" ? value : "Personal";

const getPayoutWorksheet = (
  guildId: string | null,
  guild: Guild | null,
): string | undefined => {
  if (!guildId || !guild || !PAYOUT_GUILD_IDS.includes(guildId)) {
    return undefined;
  }
  return DISCORD_SETTINGS.payoutWorksheets?.[guildId];
};

const resolveDisplayUser = async (
  guild: Guild,
  selectedUser: User | null,
  context: InteractionContext,
): Promise<StatsDisplayUser> => {
  if (!selectedUser) {
    return {
      displayName: context.displayName,
      discordTag: context.discordTag,
      avatarUrl: context.userAvatarUrl,
    };
  }
  const member = await guild.members
    .fetch(selectedUser.id)
    .catch(() => undefined);
  return {
    displayName:
      member?.displayName ?? selectedUser.globalName ?? selectedUser.username,
    discordTag: selectedUser.tag,
    avatarUrl: selectedUser.displayAvatarURL(),
  };
};

const sendStatsEmbeds = async (
  interaction: ChatInputCommandInteraction,
  embeds: ReturnType<typeof buildStatsEmbeds>,
  sendPrivately: boolean,
): Promise<void> => {
  await interaction.editReply({ embeds: [embeds[0]!] });
  await embeds.slice(1).reduce(async (previous, embed) => {
    await previous;
    await interaction.followUp({
      embeds: [embed],
      ...(sendPrivately ? { flags: MessageFlags.Ephemeral } : {}),
    });
  }, Promise.resolve());
};

/** Shows Personal, Guild, or top-ten Ranking statistics from the invoking guild's payout sheet. */
export const statsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription("View share statistics by instance")
    .addStringOption((option) =>
      option
        .setName("which")
        .setDescription(
          "Choose Personal, Guild, or Ranking (default: Personal)",
        )
        .setRequired(false)
        .addChoices(
          { name: "Personal", value: "Personal" },
          { name: "Guild", value: "Guild" },
          { name: "Ranking", value: "Ranking" },
        ),
    )
    .addBooleanOption((option) =>
      option
        .setName("sendprivately")
        .setDescription("Send the statistics privately")
        .setRequired(false),
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Show this user's personal statistics")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("amount")
        .setDescription(
          "Choose amount (Overall default; Share Ready, Pending, Distributed)",
        )
        .setRequired(false)
        .addChoices(
          { name: "Overall", value: "overall" },
          { name: "Share Ready", value: "shareReady" },
          { name: "Pending", value: "pending" },
          { name: "Distributed", value: "distributed" },
        ),
    ) as SlashCommandBuilder,
  guildIds: PAYOUT_GUILD_IDS,
  execute: async (interaction: ChatInputCommandInteraction) => {
    const guildId = interaction.guildId;
    const guild = interaction.guild;
    const worksheet = getPayoutWorksheet(guildId, guild);
    if (!guildId || !guild || !worksheet) {
      await interaction.reply({
        content: unavailableMessage,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const which = resolveStatsView(interaction.options.getString("which"));
    const selectedUser = interaction.options.getUser("user");
    if (which !== "Personal" && selectedUser) {
      await interaction.reply({
        content: "The user option can only be used with Personal statistics.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sendPrivately =
      interaction.options.getBoolean("sendprivately") ?? false;
    await interaction.deferReply(
      sendPrivately ? { flags: MessageFlags.Ephemeral } : {},
    );

    const context = getInteractionContext(interaction);
    const amount = (interaction.options.getString("amount") ??
      "overall") as StatsAmount;
    const instanceTypes =
      DISCORD_SETTINGS.cooldownInstanceTypesByGuild[guildId] ??
      COOLDOWN_INSTANCE_TYPES;
    let displayUser: StatsDisplayUser;
    let stats: PayoutStats;
    try {
      displayUser = await resolveDisplayUser(guild, selectedUser, context);
      const displayNameByDiscordTag =
        which === "Ranking"
          ? await getDisplayNameByDiscordTag(guild)
          : undefined;
      stats = await getPayoutStats({
        worksheet,
        amount,
        instanceTypes,
        ...(which === "Personal" ? { discordTag: displayUser.discordTag } : {}),
        ...(which === "Ranking" ? { includeRanking: true } : {}),
        ...(which === "Ranking"
          ? { rankingViewerTag: context.discordTag }
          : {}),
        ...(displayNameByDiscordTag ? { displayNameByDiscordTag } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await interaction.editReply({
        content: `Could not load statistics: ${message.slice(0, 250)}`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const embeds = buildStatsEmbeds(stats, context, displayUser, which);
    await sendStatsEmbeds(interaction, embeds, sendPrivately);
  },
};
