import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Client } from "discord.js";

/** Durable run-key history; a null thread ID reserves an export that may be interrupted. */
type ExportHistory = Record<
  string,
  { threadId: string | null; contents?: readonly string[] }
>;

/** Outcome of attempting a new export or recovering an existing forum post. */
export interface SignupExportResult {
  created: boolean;
  threadId: string | null;
}

const exportQueues = new Map<string, Promise<void>>();

/** Loads saved export history, treating an absent file as an empty history. */
const readHistory = async (path: string): Promise<ExportHistory> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ExportHistory;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
};

/**
 * Lists unique thread mentions from this guild's saved signup exports for a member.
 * Participation requires the exact `<@userId>` mention in stored contents.
 * Fresh Discord titles must contain the hourglass (U+23F3) and omit NO SHARE (case-insensitive).
 * Skips missing contents or IDs, unreadable channels, non-threads, and other guilds.
 * @param client Discord client used to fetch current thread titles, bypassing cache.
 * @param guildId Guild whose private/signup-exports history is searched.
 * @param userId Invoking member's Discord ID, not their payout-sheet tag.
 * @returns Thread mentions, or an empty list when no exports qualify or history is absent.
 */
export const getCurrentlyVendingThreads = async (
  client: Client,
  guildId: string,
  userId: string,
): Promise<string[]> => {
  const history = await readHistory(
    resolve(process.cwd(), "private", "signup-exports", `${guildId}.json`),
  );
  const mention = `<@${userId}>`;
  const threadIds = new Set(
    Object.values(history)
      .filter((entry) =>
        entry.contents?.some((content) => content.includes(mention)),
      )
      .flatMap((entry) => (entry.threadId ? [entry.threadId] : [])),
  );
  const matches = await Promise.all(
    Array.from(threadIds, async (threadId) => {
      const thread = await client.channels
        .fetch(threadId, { force: true })
        .catch(() => null);
      return thread?.isThread() &&
        thread.guildId === guildId &&
        thread.name.includes("\u23f3") &&
        !thread.name.toUpperCase().includes("NO SHARE")
        ? `<#${thread.id}>`
        : null;
    }),
  );
  return matches.filter((thread) => thread !== null);
};

/** Atomically persists export history through a temporary file and rename. */
const writeHistory = async (
  path: string,
  history: ExportHistory,
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(history, null, 2), "utf8");
  await rename(temporaryPath, path);
};

/**
 * Serializes guild exports, checks history/forum identifiers, and reserves before creating a post.
 * Failed post creation releases the reservation; failed confirmation writes retain it for safety.
 * @param guildId Guild whose private export history owns this run.
 * @param runKey Normalized full run title and calendar date, including the year.
 * @param createThread Creates a post and returns its ID after any roster delivery attempt.
 * @param findExistingThread Finds an existing forum identifier when saved history has no record.
 * @param contents Exported roster messages saved with a newly created thread for participant lookup.
 * @returns Whether a new post was created and its ID, or null while an earlier export is pending.
 */
export const exportSignupRun = async (
  guildId: string,
  runKey: string,
  createThread: () => Promise<string>,
  findExistingThread: () => Promise<string | null> = () =>
    Promise.resolve(null),
  contents?: readonly string[],
): Promise<SignupExportResult> => {
  const path = resolve(
    process.cwd(),
    "private",
    "signup-exports",
    `${guildId}.json`,
  );
  let result: SignupExportResult = { created: false, threadId: null };
  const previous = exportQueues.get(guildId) ?? Promise.resolve();
  const operation = previous.then(async () => {
    const history = await readHistory(path);
    if (Object.hasOwn(history, runKey)) {
      result.threadId = history[runKey]!.threadId;
      return;
    }
    const existingThreadId = await findExistingThread();
    if (existingThreadId) {
      history[runKey] = { threadId: existingThreadId };
      await writeHistory(path, history);
      result.threadId = existingThreadId;
      return;
    }
    history[runKey] = { threadId: null };
    await writeHistory(path, history);
    let threadId: string;
    try {
      threadId = await createThread();
    } catch (error) {
      delete history[runKey];
      await writeHistory(path, history);
      throw error;
    }
    history[runKey] = { threadId, ...(contents && { contents }) };
    await writeHistory(path, history);
    result = { created: true, threadId };
  });
  exportQueues.set(
    guildId,
    operation.catch(() => undefined),
  );
  await operation;
  return result;
};
