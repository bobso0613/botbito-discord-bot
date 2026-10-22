import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Client } from "discord.js";
import type {
  ExportHistory,
  FindExistingThread,
  SignupExportResult,
} from "../types/signup-export.js";
export type {
  RecoveredSignupExport,
  SignupExportResult,
} from "../types/signup-export.js";

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
 * Discord titles must contain the hourglass (U+23F3) and omit NO SHARE (case-insensitive).
 * Skips missing contents or IDs, unreadable channels, non-threads, and other guilds.
 * @param client Discord client used to resolve thread titles, using cached channels when available.
 * @param guildId Guild whose private/signup-exports history is searched.
 * @param userId Invoking member's Discord ID, not their payout-sheet tag.
 * @returns Unique thread mentions, or an empty list for no matches, absent history, or malformed JSON.
 * @throws For history read failures other than missing files or invalid JSON.
 */
export const getCurrentlyVendingThreads = async (
  client: Client,
  guildId: string,
  userId: string,
): Promise<string[]> => {
  let history: ExportHistory;
  try {
    history = await readHistory(
      resolve(process.cwd(), "private", "signup-exports", `${guildId}.json`),
    );
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
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
      const thread = await client.channels.fetch(threadId).catch(() => null);
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

/** Backfills ID-only or pending history from the original forum post without using a new roster. */
const repairHistoryEntry = async (
  path: string,
  history: ExportHistory,
  key: string,
  findExistingThread: FindExistingThread,
): Promise<void> => {
  const saved = history[key]!;
  if (saved.contents) return;
  const recovered = await findExistingThread(key, saved.threadId ?? undefined);
  if (!recovered) return;
  history[key] =
    typeof recovered === "string" ? { threadId: recovered } : recovered;
  await writeHistory(path, history);
};

/** Finds overlapping saved coverage, releasing empty reservations only when forum lookup is available. */
const findSavedExport = async (
  path: string,
  history: ExportHistory,
  keys: readonly string[],
  findExistingThread: FindExistingThread | undefined,
): Promise<SignupExportResult | null> => {
  for (const key of keys) {
    if (!Object.hasOwn(history, key)) continue;
    if (findExistingThread)
      await repairHistoryEntry(path, history, key, findExistingThread);
    const threadId = history[key]!.threadId;
    if (threadId || !findExistingThread) return { created: false, threadId };
    delete history[key];
  }
  return null;
};

/**
 * Serializes guild exports, checks history/forum identifiers, and reserves before creating a post.
 * Failed post creation releases the reservation; failed confirmation writes retain it for safety.
 * Empty reservations may retry after a successful forum recheck; lookup failures stay blocked.
 * @param guildId Guild whose private export history owns this run.
 * @param runKey Normalized full title/date key including the year and optional split instance.
 * @param createThread Creates a post and returns its ID after any roster delivery attempt.
 * @param findExistingThread Looks up coverage or recovers contents for a known thread ID. Without it, pending history stays blocked.
 * @param contents Exported roster messages saved with a newly created thread for participant lookup.
 * @param overlappingRunKeys Combined or per-instance keys whose coverage would duplicate this post.
 * @returns Whether a new post was created and its ID, or null while an earlier export is pending.
 * @throws For unreadable history, unsuccessful forum checks, creation failures, or persistence failures.
 */
export const exportSignupRun = async (
  guildId: string,
  runKey: string,
  createThread: () => Promise<string>,
  findExistingThread?: FindExistingThread,
  contents?: readonly string[],
  overlappingRunKeys: readonly string[] = [],
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
    const keys = [...new Set([runKey, ...overlappingRunKeys])];
    const saved = await findSavedExport(
      path,
      history,
      keys,
      findExistingThread,
    );
    if (saved) {
      result = saved;
      return;
    }
    for (const key of keys) {
      const recovered = await findExistingThread?.(key);
      if (recovered) {
        history[key] =
          typeof recovered === "string" ? { threadId: recovered } : recovered;
        await writeHistory(path, history);
        result.threadId = history[key]!.threadId;
        return;
      }
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
