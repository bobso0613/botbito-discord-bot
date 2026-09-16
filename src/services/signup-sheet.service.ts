import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SignupSheet } from "../types/signup-sheet.js";

const getGuildStoragePath = (guildId: string): string =>
  resolve(process.cwd(), "private", "signup-sheets", `${guildId}.json`);

type SignupSheets = Record<string, SignupSheet>;
// Serializes reads-then-writes per guild so concurrent saves/deletes for different channels don't clobber each other.
const mutationQueues = new Map<string, Promise<void>>();

/** Reads all persisted signup sheets for a guild, returning an empty object when the storage file doesn't exist yet. */
const readGuildSheets = async (guildId: string): Promise<SignupSheets> => {
  const filePath = getGuildStoragePath(guildId);
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as SignupSheets;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
};

/** Returns the persisted signup sheet for a channel, or `null` when none exists. */
export const getSignupSheet = async (
  guildId: string,
  channelId: string,
): Promise<SignupSheet | null> =>
  (await readGuildSheets(guildId))[channelId] ?? null;

/**
 * Queues a read-modify-write against the guild's storage file, applying `mutate`
 * in memory, then writing to a temporary file and renaming it into place so a
 * crash mid-write can't corrupt the storage file. Mutations for the same guild
 * run one at a time even when called concurrently.
 */
const mutateGuildSheets = async (
  guildId: string,
  mutate: (sheets: SignupSheets) => boolean | void,
): Promise<void> => {
  const filePath = getGuildStoragePath(guildId);
  const currentQueue = mutationQueues.get(guildId) ?? Promise.resolve();
  const operation = currentQueue.then(async () => {
    const sheets = await readGuildSheets(guildId);
    const shouldWrite = mutate(sheets);
    if (shouldWrite === false) return;
    await mkdir(dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(sheets, null, 2), "utf8");
    await rename(temporaryPath, filePath);
  });
  mutationQueues.set(
    guildId,
    operation.catch(() => undefined),
  );
  await operation;
};

/** Creates or overwrites the signup sheet for `sheet`'s guild/channel. */
export const saveSignupSheet = async (sheet: SignupSheet): Promise<void> => {
  await mutateGuildSheets(sheet.guildId, (sheets) => {
    sheets[sheet.channelId] = sheet;
  });
};

/**
 * Atomically mutates a channel's signup sheet inside a queued critical section.
 * Reads the latest sheets, applies `mutate` to a clone of the channel's sheet,
 * and persists the updated sheet if `mutate` returns null (success).
 * Returns `{ sheet: null, error: "MISSING_SHEET" }` when no sheet exists for the channel.
 */
export const mutateSignupSheet = async (
  guildId: string,
  channelId: string,
  mutate: (sheet: SignupSheet) => string | null,
): Promise<{ sheet: SignupSheet | null; error: string | null }> => {
  let resultSheet: SignupSheet | null = null;
  let resultError: string | null = null;

  await mutateGuildSheets(guildId, (sheets) => {
    const current = sheets[channelId];
    if (!current) {
      resultError = "MISSING_SHEET";
      return false;
    }
    const cloned = structuredClone(current);
    const error = mutate(cloned);
    if (error) {
      resultError = error;
      return false;
    }
    sheets[channelId] = cloned;
    resultSheet = cloned;
  });

  return { sheet: resultSheet, error: resultError };
};

/** Removes the persisted signup sheet for a channel, if one exists. */
export const deleteSignupSheet = async (
  guildId: string,
  channelId: string,
): Promise<void> => {
  await mutateGuildSheets(guildId, (sheets) => {
    delete sheets[channelId];
  });
};
