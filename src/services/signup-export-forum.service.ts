import {
  DiscordAPIError,
  escapeMarkdown,
  RESTJSONErrorCodes,
  type ForumChannel,
  type ThreadChannel,
} from "discord.js";
import type {
  RecoveredSignupExport,
  SignupExportPart,
} from "../types/signup-export.js";
import type { SignupSheet } from "../types/signup-sheet.js";
import { ORGANIZER_EXPORT_ERROR } from "../constants/signup.js";
import { buildExportTitle } from "../templates/signup-export.template.js";
import {
  buildExportIdentifier,
  canExportSheet,
  ExportValidationError,
  getExportDate,
  getExportInstanceTypes,
  getExportRunKey,
} from "../utils/signup-export.js";
import { getSignupSheet } from "./signup-sheet.service.js";
import { exportSignupRun } from "./signup-export.service.js";

/**
 * Reads every page of an existing export's bot-authored messages in chronological order.
 * @param channel Payout forum containing the export thread.
 * @param threadId Existing post ID from history or identifier lookup.
 * @returns Original roster contents, including follow-ups, rather than the current signup.
 * @throws If the thread is missing, message history is unreadable, or pagination stalls.
 */
export const recoverExportThread = async (
  channel: ForumChannel,
  threadId: string,
): Promise<RecoveredSignupExport> => {
  const thread = await channel.threads.fetch(threadId);
  if (!thread) throw new Error("Could not read the existing export thread.");
  const messages = [];
  let before: string | undefined;
  while (true) {
    const page = await thread.messages.fetch({ limit: 100, before });
    messages.push(...page.values());
    if (page.size < 100) break;
    const next = page.last()!.id;
    if (next === before)
      throw new Error("Could not finish reading the export roster.");
    before = next;
  }
  return {
    threadId,
    contents: messages
      .filter((message) => message.author.id === channel.client.user.id)
      .sort((first, second) => first.createdTimestamp - second.createdTimestamp)
      .map((message) => message.content),
  };
};

/** Finds an exact identifier footer in starter messages authored by this bot only. */
const findIdentifierInThreads = async (
  threads: Iterable<ThreadChannel>,
  identifier: string,
  botId: string,
  runDate?: string,
): Promise<string | null> => {
  const dateSuffix = runDate
    ? ` - ${runDate.slice(8, 10)}/${runDate.slice(5, 7)}`
    : null;
  const matches = await Promise.all(
    Array.from(threads, async (thread) => {
      if (
        dateSuffix &&
        !thread.name.endsWith(dateSuffix) &&
        !thread.name.includes(`${dateSuffix} [`)
      )
        return null;
      const starter = await thread
        .fetchStarterMessage()
        .catch((error: unknown) => {
          if (
            error instanceof DiscordAPIError &&
            error.code === RESTJSONErrorCodes.UnknownMessage
          )
            return null;
          throw error;
        });
      return starter?.author.id === botId &&
        starter.content.trimEnd().split("\n").at(-1) === identifier
        ? thread.id
        : null;
    }),
  );
  return matches.find((id) => id !== null) ?? null;
};

/** Searches all public archived pages, rejecting stalled cursors instead of skipping validation. */
const findArchivedExport = async (
  channel: ForumChannel,
  identifier: string,
  runDate?: string,
  before?: Date,
): Promise<string | null> => {
  const archived = await channel.threads.fetchArchived({ limit: 100, before });
  const found = await findIdentifierInThreads(
    archived.threads.values(),
    identifier,
    channel.client.user.id,
    runDate,
  );
  if (found || !archived.hasMore) return found;
  const timestamp = archived.threads.last()?.archiveTimestamp;
  if (!timestamp || (before && timestamp >= before.getTime())) {
    throw new Error("Could not finish checking archived exports.");
  }
  return findArchivedExport(channel, identifier, runDate, new Date(timestamp));
};

/**
 * Finds an exact bot-authored starter footer among active and all public archived posts.
 * Deleted starters are skipped; other read failures prevent new exports.
 * @param channel Configured payout forum.
 * @param identifier Stable guild/run/instance footer to match exactly.
 * @param runDate Optional YYYY-MM-DD run date; only matching DD/MM titles need starter fetches.
 * @returns Matching thread ID, or null after a complete successful lookup.
 * @throws If forum access fails or the archived-page cursor cannot advance.
 */
export const findExistingExport = async (
  channel: ForumChannel,
  identifier: string,
  runDate?: string,
): Promise<string | null> => {
  const active = await channel.threads.fetchActive();
  const found = await findIdentifierInThreads(
    active.threads.values(),
    identifier,
    channel.client.user.id,
    runDate,
  );
  return found ?? findArchivedExport(channel, identifier, runDate);
};

/** Rechecks organizer ownership and run identity inside the queue before creating a post. */
const validateCurrentExport = async (
  sheet: SignupSheet,
  userId: string,
): Promise<void> => {
  const current = await getSignupSheet(sheet.guildId, sheet.channelId);
  if (!current || !canExportSheet(current, userId)) {
    throw new ExportValidationError(ORGANIZER_EXPORT_ERROR);
  }
  if (
    current.timestamp === null ||
    getExportRunKey(current) !== getExportRunKey(sheet)
  ) {
    throw new ExportValidationError(
      "The run title or date changed while exporting. Please run `/export` again.",
    );
  }
};

/**
 * Creates or recovers one payout post through the guild's serialized export history.
 * Revalidates ownership before creation and limits mentions to the exported roster.
 * @param userId Invoking organizer's Discord ID.
 * @param channel Configured payout forum.
 * @param sheet Original signup used for run identity and overlapping coverage checks.
 * @param part Validated combined or per-instance roster with non-null message contents.
 * @returns Public notice including the existing/created thread and any partial delivery failure.
 * @throws Propagates lookup or creation failures before a thread is created.
 */
export const sendExport = async (
  userId: string,
  channel: ForumChannel,
  sheet: SignupSheet,
  part: SignupExportPart,
): Promise<string> => {
  const { slots, runKey, identifier } = part;
  const contents = part.contents!;
  const recipientIds = [...new Set(slots.map((slot) => slot.signupUserId!))];
  const messageOptions = (content: string) => ({
    content,
    allowedMentions: {
      parse: [] as [],
      users: recipientIds.filter((id) => content.includes(`<@${id}>`)),
    },
  });
  let remainingFailed = false;
  let createdThreadId: string | null = null;
  let result;
  const combinedKey = getExportRunKey(sheet);
  const overlapping =
    runKey === combinedKey
      ? getExportInstanceTypes(sheet).map((type) => ({
          key: getExportRunKey(sheet, type.name),
          identifier: buildExportIdentifier(sheet, type.name),
        }))
      : [{ key: combinedKey, identifier: buildExportIdentifier(sheet) }];
  const identifiers = new Map([
    [runKey, identifier],
    ...overlapping.map((entry) => [entry.key, entry.identifier] as const),
  ]);
  try {
    result = await exportSignupRun(
      sheet.guildId,
      runKey,
      async () => {
        await validateCurrentExport(sheet, userId);
        const thread = await channel.threads.create({
          name: buildExportTitle(part.sheet, part.initials),
          message: messageOptions(contents[0]!),
        });
        createdThreadId = thread.id;
        try {
          await contents.slice(1).reduce(async (previous, content) => {
            await previous;
            await thread.send(messageOptions(content));
          }, Promise.resolve());
        } catch {
          remainingFailed = true;
        }
        return thread.id;
      },
      async (key, savedThreadId) => {
        const threadId =
          savedThreadId ??
          (await findExistingExport(
            channel,
            identifiers.get(key)!,
            getExportDate(sheet).toISOString().slice(0, 10),
          ));
        return threadId ? recoverExportThread(channel, threadId) : null;
      },
      contents,
      overlapping.map((entry) => entry.key),
    );
  } catch (error) {
    if (error instanceof ExportValidationError) return error.message;
    if (!createdThreadId) throw error;
    return `Created <#${createdThreadId}>, but could not save the export confirmation. Export is blocked to prevent a duplicate; ask an administrator to check the export history.`;
  }
  if (!result.created) {
    return result.threadId
      ? `This run has already been exported for this date: <#${result.threadId}>.`
      : "An export for this run and date is already pending. Ask an administrator to check the export history if it remains blocked.";
  }
  return remainingFailed
    ? `Created <#${result.threadId}>, but could not send the remaining roster. Check the bot's permissions and complete the roster in that post; exporting again is blocked to prevent duplicates.`
    : `Exported the signup roster to <#${result.threadId}>. Vendor - **${escapeMarkdown(part.vendor.replace(/[\r\n]/g, " "))}**`;
};
