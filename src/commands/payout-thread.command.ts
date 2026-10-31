import {
  ChannelType,
  PermissionFlagsBits,
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
import { getSignupExportOrganizerId } from "../services/signup-export.service.js";
import { isExportRosterContinuation } from "../utils/signup-export-roster.js";

const exportIdentifierPattern =
  /^-# Export ID: botbito-export:v1:[a-f0-9]{64}$/;
const continuationPrefix = "**Payout roster continued:**\n";
const maximumRosterEditLength = 100_000;

interface PendingRosterEdit {
  userId: string;
  chunks: string[];
  length: number;
}

const pendingShareParticipantUsers = new ExpiringMap<
  string,
  PendingRosterEdit
>();

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
  const match = /^(?:([\s\S]*?)\n\n)?Participants: \*\*\d+\*\*([\s\S]*)$/.exec(
    content,
  );
  return match ? { roster: match[1] ?? "", metadataSuffix: match[2]! } : null;
};

const normalizeUserMentions = (content: string): string =>
  content.replace(/<@!(\d+)>/g, "<@$1>");

const getMentionedUserIds = (content: string): Set<string> =>
  new Set(Array.from(content.matchAll(/<@!?(\d+)>/g), (match) => match[1]!));

const getRosterContinuationContents = (content: string): string =>
  content.startsWith(continuationPrefix)
    ? content.slice(continuationPrefix.length)
    : content;

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
        (message.id === starter.id || isExportRosterContinuation(message.content)),
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
  const chunks = [""];
  const continuationLimit =
    MAX_DISCORD_MESSAGE_LENGTH - continuationPrefix.length;
  for (const line of roster.split("\n")) {
    const lastIndex = chunks.length - 1;
    const last = chunks[lastIndex];
    const limit = chunks.length === 1 ? firstChunkLimit : continuationLimit;
    const candidate = last ? `${last}\n${line}` : line;
    if (candidate.length <= limit) {
      chunks[lastIndex] = candidate;
      continue;
    }
    if (line.length > continuationLimit) {
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
  if (firstChunkLimit < 0) {
    throw new Error(
      "The payout post metadata exceeds Discord's message limit.",
    );
  }
  const chunks = splitRosterLines(roster, firstChunkLimit);
  return chunks.map((chunk, index) => {
    if (index !== 0) return `${continuationPrefix}${chunk}`;
    return chunk ? `${chunk}${metadata}` : metadata.slice(2);
  });
};

type RosterOperation = () => Promise<unknown>;

interface RosterChanges {
  completedAdds: string[];
  completedRemoves: string[];
  editedMessages: Array<{ message: Message; content: string }>;
  sentMessages: Message[];
  deletedMessages: string[];
}

const runRosterOperations = (operations: RosterOperation[]): Promise<void> =>
  operations.reduce(async (previous, operation) => {
    await previous;
    await operation();
  }, Promise.resolve());

const changeRosterMembership = async (
  thread: ThreadChannel,
  memberList: ReadonlyMap<string, unknown>,
  oldUserIds: Set<string>,
  newUserIds: Set<string>,
  changes: RosterChanges,
): Promise<void> => {
  const additions = [...newUserIds]
    .filter((userId) => !memberList.has(userId))
    .map((userId) => async () => {
      await thread.members.add(userId);
      changes.completedAdds.push(userId);
    });
  const removals = [...oldUserIds]
    .filter((userId) => !newUserIds.has(userId) && memberList.has(userId))
    .map((userId) => async () => {
      await thread.members.remove(userId);
      changes.completedRemoves.push(userId);
    });
  await runRosterOperations([...additions, ...removals]);
};

const changeRosterMessages = async (
  thread: ThreadChannel,
  rosterMessages: Message[],
  contents: string[],
  changes: RosterChanges,
): Promise<void> => {
  const allowedMentions = { parse: [] as [] };
  const writes = contents.map((content, index) => async () => {
    const existing = rosterMessages[index];
    if (existing) {
      changes.editedMessages.push({
        message: existing,
        content: existing.content,
      });
      await existing.edit({ content, allowedMentions });
    } else {
      changes.sentMessages.push(
        await thread.send({ content, allowedMentions }),
      );
    }
  });
  const deletions = rosterMessages
    .slice(contents.length)
    .reverse()
    .map((message) => async () => {
      await message.delete();
      changes.deletedMessages.push(message.content);
    });
  await runRosterOperations([...writes, ...deletions]);
};

const reverseRosterOperations = <Item>(
  items: Item[],
  operation: (item: Item) => Promise<unknown>,
): RosterOperation[] =>
  items.reduceRight<RosterOperation[]>((operations, item) => {
    operations.push(() => operation(item));
    return operations;
  }, []);

const rollbackRosterChanges = async (
  thread: ThreadChannel,
  changes: RosterChanges,
): Promise<unknown[]> => {
  const allowedMentions = { parse: [] as [] };
  const errors: unknown[] = [];
  const operations = [
    ...reverseRosterOperations(changes.deletedMessages, (content) =>
      thread.send({ content, allowedMentions }),
    ),
    ...reverseRosterOperations(changes.editedMessages, ({ message, content }) =>
      message.edit({ content, allowedMentions }),
    ),
    ...reverseRosterOperations(changes.sentMessages, (message) =>
      message.delete(),
    ),
    ...reverseRosterOperations(changes.completedRemoves, (userId) =>
      thread.members.add(userId),
    ),
    ...reverseRosterOperations(changes.completedAdds, (userId) =>
      thread.members.remove(userId),
    ),
  ];
  await runRosterOperations(
    operations.map((operation) => async () => {
      try {
        await operation();
      } catch (error) {
        errors.push(error);
      }
    }),
  );
  return errors;
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
  const roster = normalizeUserMentions(
    rosterInput.replace(/\r\n?/g, "\n").trim(),
  );
  if (!roster) throw new Error("Paste the updated roster after the command.");
  if (roster.length > maximumRosterEditLength) {
    throw new Error("The updated roster is too large to process.");
  }

  const rosterMessages = await fetchRosterMessages(thread, starter, botId);
  const oldRoster = [
    starterParts.roster,
    ...rosterMessages
      .filter((message) => message.id !== starter.id)
      .map((message) => getRosterContinuationContents(message.content)),
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
  const changes: RosterChanges = {
    completedAdds: [],
    completedRemoves: [],
    editedMessages: [],
    sentMessages: [],
    deletedMessages: [],
  };
  try {
    await changeRosterMembership(
      thread,
      memberList,
      oldUserIds,
      newUserIds,
      changes,
    );
    await changeRosterMessages(thread, rosterMessages, contents, changes);
  } catch (error) {
    const rollbackErrors = await rollbackRosterChanges(thread, changes);
    if (rollbackErrors.length) {
      throw new Error(
        `Could not apply the roster edit (${errorMessage(error)}), and ${rollbackErrors.length} rollback operation(s) failed. Repair the thread roster and membership manually before syncing Sheets.`,
      );
    }
    throw error;
  }
  return { count: newUserIds.size, contents, userIds: [...newUserIds] };
};

const requireShareEditor = async (
  guildId: string,
  threadId: string,
  userId: string,
  isPayoutManager: boolean,
): Promise<void> => {
  if (
    !isPayoutManager &&
    (await getSignupExportOrganizerId(guildId, threadId)) !== userId
  ) {
    throw new Error(
      "Only the original organizer or a member with Manage Server permission can edit this payout.",
    );
  }
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
        await requireShareEditor(
          interaction.guildId!,
          interaction.channelId,
          interaction.user.id,
          interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ??
            false,
        );
        const vendor = interaction.options.getString("vendor", true).trim();
        if (!vendor) throw new Error("Enter a vendor name, `n/a`, or `none`.");
        const line = `Vendor: **${escapeMarkdown(vendor.replace(/[\r\n]/g, " "))}**`;
        const updatedContent = /^Vendor:.*$/m.test(starter.content)
          ? starter.content.replace(/^Vendor:.*$/m, () => line)
          : starter.content.replace(
              /^(?:Instance Types:|\*Your Time:|-# Export ID:)/m,
              (match) => `${line}\n${match}`,
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
        await interaction.editReply({
          content: [
            `Vendor updated to **${escapeMarkdown(vendor.replace(/[\r\n]/g, " "))}**.`,
            notice,
          ]
            .filter(Boolean)
            .join("\n"),
          allowedMentions: { parse: [] },
        });
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
      await requireShareEditor(
        interaction.guildId!,
        interaction.channelId,
        interaction.user.id,
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ??
          false,
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
      pendingShareParticipantUsers.set(thread.id, {
        userId: interaction.user.id,
        chunks: [],
        length: 0,
      });
      const template =
        roster.length <= 1_700
          ? `Current roster:\n\`\`\`text\n${roster}\n\`\`\``
          : "Copy the current roster from this thread before editing it.";
      await interaction.editReply(
        `${template}\nPaste the updated party and participant lines in one or more messages in this thread. Send \`done\` when the complete roster has been submitted. The participant total will be recalculated from unique user mentions.`,
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
  const guildId = message.guildId;
  if (!guildId || message.author.bot || !channel.isThread()) {
    return;
  }
  if (
    pendingShareParticipantUsers.get(message.channelId)?.userId !==
    message.author.id
  ) {
    return;
  }
  try {
    await queuePayoutSheetOperation(async () => {
      const pendingEdit = pendingShareParticipantUsers.get(message.channelId);
      if (pendingEdit?.userId !== message.author.id) return;
      if (message.content.trim().toLowerCase() !== "done") {
        const separator = pendingEdit.chunks.length ? 1 : 0;
        const nextLength =
          pendingEdit.length + separator + message.content.length;
        if (nextLength > maximumRosterEditLength) {
          throw new Error("The updated roster is too large to process.");
        }
        pendingEdit.chunks.push(message.content);
        pendingEdit.length = nextLength;
        pendingShareParticipantUsers.set(message.channelId, pendingEdit);
        await message.reply(
          `Roster part received (${pendingEdit.length} characters). Send \`done\` when the complete roster has been submitted.`,
        );
        return;
      }
      if (pendingEdit.chunks.length === 0) {
        await message.reply("Paste at least one roster message before `done`.");
        return;
      }
      const { thread, starter, botId } = await getSharePost(
        guildId,
        message.guild,
        channel,
        message.client.user?.id ?? null,
      );
      await requireShareEditor(
        guildId,
        thread.id,
        message.author.id,
        message.member?.permissions.has(PermissionFlagsBits.ManageGuild) ??
          false,
      );
      const result = await editRoster(
        thread,
        starter,
        botId,
        pendingEdit.chunks.join("\n"),
      );
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
