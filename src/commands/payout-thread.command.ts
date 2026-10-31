import {
  ChannelType,
  SlashCommandBuilder,
  escapeMarkdown,
  type ChatInputCommandInteraction,
  type Guild,
  type Message,
  type TextBasedChannel,
  type ThreadChannel,
} from "discord.js";
import {
  DISCORD_SETTINGS,
  PAYOUT_GUILD_IDS,
} from "../config/discord-settings.js";
import { MAX_DISCORD_MESSAGE_LENGTH } from "../constants/signup.js";
import type { Command } from "../types/command.js";
import { ExpiringMap } from "../utils/signup-sheet.js";
import {
  queuePayoutSheetOperation,
  syncPayoutExport,
} from "../services/payout-sheet-export.service.js";

const exportIdentifierPattern =
  /^-# Export ID: botbito-export:v1:[a-f0-9]{64}$/;
const pendingShareParticipantUsers = new ExpiringMap<string, string>();

interface SharePost {
  thread: ThreadChannel;
  starter: Message;
  botId: string;
}

interface ParsedStarter {
  roster: string;
  metadataSuffix: string;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const getSharePost = async (
  guildId: string | null,
  guild: Guild | null,
  channel: TextBasedChannel | null,
  botId: string | null,
): Promise<SharePost> => {
  if (!guildId || !guild || !PAYOUT_GUILD_IDS.includes(guildId)) {
    throw new Error(
      "This command is only available in a payout-enabled server.",
    );
  }
  const payoutChannelId =
    DISCORD_SETTINGS.payoutSheetChannelIdByGuild?.[guildId];
  if (!payoutChannelId || !channel?.isThread()) {
    throw new Error(
      "Use this command inside a bot-generated payout thread in the configured payout channel.",
    );
  }
  const thread = channel as ThreadChannel;
  if (thread.parentId !== payoutChannelId || thread.guildId !== guildId) {
    throw new Error(
      "Use this command inside a bot-generated payout thread in the configured payout channel.",
    );
  }
  const parent = thread.parent ?? (await guild.channels.fetch(payoutChannelId));
  if (parent?.type !== ChannelType.GuildForum) {
    throw new Error("The configured payout channel is not a forum channel.");
  }
  if (!botId) throw new Error("The bot user is unavailable.");

  const starter = await thread.fetchStarterMessage();
  if (!starter) throw new Error("This payout thread has no starter post.");
  const identifier = starter.content.trimEnd().split("\n").at(-1);
  if (
    starter.author.id !== botId ||
    !identifier ||
    !exportIdentifierPattern.test(identifier)
  ) {
    throw new Error(
      "This thread was not created by the bot's payout export command.",
    );
  }
  if (!parseStarter(starter.content)) {
    throw new Error("The payout post is missing its Participants metadata.");
  }
  return { thread, starter, botId };
};

const parseStarter = (content: string): ParsedStarter | null => {
  const match = /^([\s\S]*?)\n\nParticipants: \*\*\d+\*\*([\s\S]*)$/.exec(
    content,
  );
  return match ? { roster: match[1]!, metadataSuffix: match[2]! } : null;
};

const getMentionedUserIds = (content: string): Set<string> =>
  new Set(Array.from(content.matchAll(/<@!?(\d+)>/g), (match) => match[1]!));

const isRosterContinuation = (content: string): boolean =>
  /^(?:\*\*Party \d+:\*\*|\d{2}: .+ - <@!?\d+>)/.test(content);

const fetchRosterMessages = async (
  thread: ThreadChannel,
  starter: Message,
  botId: string,
): Promise<Message[]> => {
  const messages: Message[] = [];
  let before: string | undefined;
  while (true) {
    const page = await thread.messages.fetch({ limit: 100, before });
    messages.push(...page.values());
    if (page.size < 100) break;
    const next = page.last()?.id;
    if (!next || next === before) {
      throw new Error("Could not finish reading the payout thread.");
    }
    before = next;
  }
  const rosterMessages = messages
    .filter(
      (message) =>
        message.author.id === botId &&
        (message.id === starter.id || isRosterContinuation(message.content)),
    )
    .sort((first, second) => first.createdTimestamp - second.createdTimestamp);
  if (!rosterMessages.some((message) => message.id === starter.id)) {
    rosterMessages.unshift(starter);
  }
  return rosterMessages;
};

const splitRosterLines = (
  roster: string,
  firstChunkLimit: number,
): string[] => {
  const [firstLine, ...remainingLines] = roster.split("\n");
  if (!firstLine || firstLine.length > firstChunkLimit) {
    throw new Error(
      "The first roster line does not fit beside the payout post metadata.",
    );
  }
  const chunks = [firstLine];
  for (const line of remainingLines) {
    const lastIndex = chunks.length - 1;
    const last = chunks[lastIndex]!;
    const limit =
      chunks.length === 1 ? firstChunkLimit : MAX_DISCORD_MESSAGE_LENGTH;
    const candidate = `${last}\n${line}`;
    if (candidate.length <= limit) {
      chunks[lastIndex] = candidate;
      continue;
    }
    if (line.length > MAX_DISCORD_MESSAGE_LENGTH) {
      throw new Error(
        "A roster line exceeds Discord's message limit. Shorten the line and try again.",
      );
    }
    chunks.push(line);
  }
  return chunks;
};

const splitRoster = (
  roster: string,
  participantCount: number,
  metadataSuffix: string,
): string[] => {
  const metadata = `\n\nParticipants: **${participantCount}**${metadataSuffix}`;
  const firstChunkLimit = MAX_DISCORD_MESSAGE_LENGTH - metadata.length;
  if (firstChunkLimit < 1) {
    throw new Error("The payout post metadata leaves no room for a roster.");
  }
  return splitRosterLines(roster, firstChunkLimit).map((chunk, index) =>
    index === 0 ? `${chunk}${metadata}` : chunk,
  );
};

const editRoster = async (
  thread: ThreadChannel,
  starter: Message,
  botId: string,
  rosterInput: string,
): Promise<{ count: number; contents: string[]; userIds: string[] }> => {
  const starterParts = parseStarter(starter.content);
  if (!starterParts) {
    throw new Error("The payout post is missing its Participants metadata.");
  }
  const roster = rosterInput.replace(/\r\n?/g, "\n").trim();
  if (!roster) throw new Error("Paste the updated roster after the command.");

  const rosterMessages = await fetchRosterMessages(thread, starter, botId);
  const oldRoster = [
    starterParts.roster,
    ...rosterMessages
      .filter((message) => message.id !== starter.id)
      .map((message) => message.content),
  ]
    .filter(Boolean)
    .join("\n");
  const oldUserIds = getMentionedUserIds(oldRoster);
  const newUserIds = getMentionedUserIds(roster);
  if (newUserIds.size === 0) {
    throw new Error("Include a Discord mention for each roster participant.");
  }
  const contents = splitRoster(
    roster,
    newUserIds.size,
    starterParts.metadataSuffix,
  );
  const memberList = await thread.members.fetch();
  await Promise.all([
    ...Array.from(newUserIds)
      .filter((userId) => !memberList.has(userId))
      .map((userId) => thread.members.add(userId)),
    ...Array.from(oldUserIds)
      .filter((userId) => !newUserIds.has(userId) && memberList.has(userId))
      .map((userId) => thread.members.remove(userId)),
  ]);

  const allowedMentions = { parse: [] as [] };
  await Promise.all(
    contents.map((content, index) => {
      const existing = rosterMessages[index];
      return existing
        ? existing.edit({ content, allowedMentions })
        : thread.send({ content, allowedMentions });
    }),
  );
  await Promise.all(
    rosterMessages.slice(contents.length).map((message) => message.delete()),
  );
  return { count: newUserIds.size, contents, userIds: [...newUserIds] };
};

/**
 * Changes the Discord vendor and the managed sheet's vendor cell without changing financial inputs.
 * Repeating an unchanged vendor retries pending Sheets work; failures retain the Discord edit.
 */
export const changeShareVendorCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("changesharevendor")
    .setDescription("Change the vendor on a bot-generated payout post")
    .addStringOption((option) =>
      option
        .setName("vendor")
        .setDescription("Vendor name, n/a, or none")
        .setRequired(true),
    ) as SlashCommandBuilder,
  guildIds: PAYOUT_GUILD_IDS,
  execute: async (interaction: ChatInputCommandInteraction) => {
    await interaction.deferReply();
    try {
      await queuePayoutSheetOperation(async () => {
        const { starter } = await getSharePost(
          interaction.guildId,
          interaction.guild,
          interaction.channel,
          interaction.client.user?.id ?? null,
        );
        const vendor = interaction.options.getString("vendor", true).trim();
        if (!vendor) throw new Error("Enter a vendor name, `n/a`, or `none`.");
        const line = `Vendor: **${escapeMarkdown(vendor.replace(/[\r\n]/g, " "))}**`;
        const updatedContent = /^Vendor:.*$/m.test(starter.content)
          ? starter.content.replace(/^Vendor:.*$/m, line)
          : starter.content.replace(
              /^(?:Instance Types:|\*Your Time:|-# Export ID:)/m,
              `${line}\n$&`,
            );
        await starter.edit({
          content: updatedContent,
          allowedMentions: { parse: [] },
        });
        const notice = await syncPayoutExport(
          interaction.guild!,
          interaction.channelId,
          {
            starterContent: updatedContent,
            vendor,
          },
        );
        await interaction.editReply(
          [
            `Vendor updated to **${escapeMarkdown(vendor.replace(/[\r\n]/g, " "))}**.`,
            notice,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      });
    } catch (error) {
      await interaction.editReply(
        `Could not update vendor: ${errorMessage(error)}`,
      );
    }
  },
};

/**
 * Prompts for a copied and edited roster, then updates the payout post and thread membership.
 * Linked pending Sheets shares are synchronized; processed balances require manual updates.
 * Existing run totals and reimbursements are preserved; no spacer columns are added for edits.
 */
export const changeShareParticipantsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("changeshareparticipants")
    .setDescription(
      "Replace the roster on a bot-generated payout post",
    ) as SlashCommandBuilder,
  guildIds: PAYOUT_GUILD_IDS,
  execute: async (interaction: ChatInputCommandInteraction) => {
    await interaction.deferReply();
    try {
      const { thread, starter, botId } = await getSharePost(
        interaction.guildId,
        interaction.guild,
        interaction.channel,
        interaction.client.user?.id ?? null,
      );
      const starterRoster = parseStarter(starter.content)!.roster;
      const rosterMessages = await fetchRosterMessages(thread, starter, botId);
      const roster = [
        starterRoster,
        ...rosterMessages
          .filter((message) => message.id !== starter.id)
          .map((message) => message.content),
      ]
        .filter(Boolean)
        .join("\n");
      pendingShareParticipantUsers.set(thread.id, interaction.user.id);
      const template =
        roster.length <= 1_700
          ? `Current roster:\n\`\`\`text\n${roster}\n\`\`\``
          : "Copy the current roster from this thread before editing it.";
      await interaction.editReply(
        `${template}\nPaste the updated party and participant lines as your next message in this thread. The participant total will be recalculated from unique user mentions.`,
      );
    } catch (error) {
      await interaction.editReply(
        `Could not prepare participant edit: ${errorMessage(error)}`,
      );
    }
  },
};

/**
 * Applies the invoking user's next roster message after `/changeshareparticipants`.
 * @param message The submitted roster from a configured bot-generated payout thread.
 */
export const handleShareParticipantsMessage = async (
  message: Message,
): Promise<void> => {
  const channel = message.channel;
  if (!message.guildId || message.author.bot || !channel.isThread()) {
    return;
  }
  if (
    pendingShareParticipantUsers.get(message.channelId) !== message.author.id
  ) {
    return;
  }
  try {
    await queuePayoutSheetOperation(async () => {
      if (
        pendingShareParticipantUsers.get(message.channelId) !==
        message.author.id
      )
        return;
      const { thread, starter, botId } = await getSharePost(
        message.guildId,
        message.guild,
        channel,
        message.client.user?.id ?? null,
      );
      const result = await editRoster(thread, starter, botId, message.content);
      pendingShareParticipantUsers.delete(thread.id);
      const notice = await syncPayoutExport(message.guild!, thread.id, {
        contents: result.contents,
        userIds: result.userIds,
      });
      await message.reply(
        [
          `Roster updated successfully. Participants: **${result.count}**.`,
          notice,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    });
  } catch (error) {
    await message.reply(`Could not update roster: ${errorMessage(error)}`);
  }
};
