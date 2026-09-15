import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { reloadDiscordSettings } from "../config/discord-settings.js";
import {
  COOLDOWN_INSTANCE_TYPES,
  MULTIPLIER_INSTANCE_TYPES,
} from "../constants/cooldowns.js";
import type { GuildSettings } from "../types/discord-settings.js";

/** Returns the private JSON storage path for one guild's schedule settings. */
const getGuildSettingsPath = (guildId: string): string =>
  resolve(process.cwd(), "private", "guild-settings", `${guildId}.json`);

/** Creates the default settings persisted when the bot first joins a guild. */
const createEmptyGuildSettings = (): GuildSettings => ({
  guildScheduleSource: {
    categoryIds: [],
    excludedChannelIds: [],
    roleRestrictedChannels: {},
    scheduleTextChannelIds: [],
  },
  guildIcons: { DEV: "", PROD: "" },
  cooldownInstanceTypes: structuredClone([...COOLDOWN_INSTANCE_TYPES]),
  multiplierInstanceTypes: [...MULTIPLIER_INSTANCE_TYPES],
});

const mutationQueues = new Map<string, Promise<void>>();

/** Reads a guild's settings, returning null when the file has not been created yet. */
const readGuildSettings = async (
  guildId: string,
): Promise<GuildSettings | null> => {
  try {
    return JSON.parse(
      await readFile(getGuildSettingsPath(guildId), "utf8"),
    ) as GuildSettings;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

/** Atomically writes a guild's settings JSON, avoiding partial files on process interruption. */
const writeGuildSettings = async (
  guildId: string,
  settings: GuildSettings,
): Promise<void> => {
  const filePath = getGuildSettingsPath(guildId);
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(settings, null, 2), "utf8");
  await rename(temporaryPath, filePath);
};

/** Queues a read-modify-write operation so concurrent settings changes cannot overwrite each other. */
const mutateGuildSettings = async (
  guildId: string,
  mutate: (settings: GuildSettings) => void,
): Promise<void> => {
  const currentQueue = mutationQueues.get(guildId) ?? Promise.resolve();
  const operation = currentQueue.then(async () => {
    const settings =
      (await readGuildSettings(guildId)) ?? createEmptyGuildSettings();
    settings.cooldownInstanceTypes ??= structuredClone([
      ...COOLDOWN_INSTANCE_TYPES,
    ]);
    settings.multiplierInstanceTypes ??= [...MULTIPLIER_INSTANCE_TYPES];
    mutate(settings);
    await writeGuildSettings(guildId, settings);
    reloadDiscordSettings();
  });
  mutationQueues.set(
    guildId,
    operation.catch(() => undefined),
  );
  await operation;
};

/** Creates a guild settings file if the bot has not seen the guild before. */
export const ensureGuildSettings = async (guildId: string): Promise<void> => {
  await mutateGuildSettings(guildId, () => undefined);
};

/** Updates a guild's schedule source settings and reloads the runtime aggregate. */
export const updateGuildScheduleSource = async (
  guildId: string,
  update: (source: GuildSettings["guildScheduleSource"]) => void,
): Promise<void> => {
  await mutateGuildSettings(guildId, (settings) =>
    update(settings.guildScheduleSource),
  );
};

/** Updates the cooldown instance configuration for one guild. */
export const updateGuildCooldownSettings = async (
  guildId: string,
  update: (
    settings: Pick<
      GuildSettings,
      "cooldownInstanceTypes" | "multiplierInstanceTypes"
    >,
  ) => void,
): Promise<void> => {
  await mutateGuildSettings(guildId, update);
};
