import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SignupSheet } from "../types/signup-sheet.js";

const storagePath = resolve(process.cwd(), "private", "signup-sheets.json");
type SignupSheets = Record<string, SignupSheet>;
// Serializes reads-then-writes so concurrent saves/deletes for different sheets don't clobber each other.
let mutationQueue = Promise.resolve();

const sheetKey = (guildId: string, channelId: string): string =>
  `${guildId}:${channelId}`;

/** Reads all persisted signup sheets, returning an empty object when the storage file doesn't exist yet. */
const readSheets = async (): Promise<SignupSheets> => {
  try {
    return JSON.parse(await readFile(storagePath, "utf8")) as SignupSheets;
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
  (await readSheets())[sheetKey(guildId, channelId)] ?? null;

/**
 * Queues a read-modify-write against the storage file, applying `mutate` in
 * memory, then writing to a temporary file and renaming it into place so a
 * crash mid-write can't corrupt the storage file. Mutations run one at a time
 * even when called concurrently, since each call awaits the prior operation.
 */
const mutateSheets = async (
  mutate: (sheets: SignupSheets) => void,
): Promise<void> => {
  const operation = mutationQueue.then(async () => {
    const sheets = await readSheets();
    mutate(sheets);
    await mkdir(dirname(storagePath), { recursive: true });
    const temporaryPath = `${storagePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(sheets, null, 2), "utf8");
    await rename(temporaryPath, storagePath);
  });
  mutationQueue = operation.catch(() => undefined);
  await operation;
};

/** Creates or overwrites the signup sheet for `sheet`'s guild/channel. */
export const saveSignupSheet = async (sheet: SignupSheet): Promise<void> => {
  await mutateSheets((sheets) => {
    sheets[sheetKey(sheet.guildId, sheet.channelId)] = sheet;
  });
};

/** Removes the persisted signup sheet for a channel, if one exists. */
export const deleteSignupSheet = async (
  guildId: string,
  channelId: string,
): Promise<void> => {
  await mutateSheets((sheets) => {
    delete sheets[sheetKey(guildId, channelId)];
  });
};
