import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ChannelType, REST, Routes, type APIMessage } from "discord.js";

type ExportHistory = Record<
  string,
  {
    threadId: string | null;
    contents?: string[];
  }
>;
type ActiveThread = {
  id: string;
  parent_id: string | null;
  name: string;
  thread_metadata?: { archived: boolean };
};
type MigrationPlan = {
  guildId: string;
  path: string;
  source: string | null;
  history: ExportHistory;
  added: number;
  updated: number;
};

/**
 * Resolves CLI paths without depending on source, dist, or flattened hosting script locations.
 * @param args Migration CLI arguments, excluding the node executable and script name.
 * @param workingDirectory Default bot root when --root is omitted.
 * @returns Absolute bot root and history directory, plus the dry-run setting.
 */
export const parseSignupExportMigrationOptions = (
  args = process.argv.slice(2),
  workingDirectory = process.cwd(),
) => {
  const { values } = parseArgs({
    args,
    options: {
      root: { type: "string" },
      directory: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const root = resolve(workingDirectory, values.root ?? ".");
  const directory = values.directory
    ? resolve(root, values.directory)
    : resolve(root, "private", "signup-exports");
  return { root, directory, dryRun: values["dry-run"] };
};

const loadHistory = async (path: string) => {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { source: null, history: {} as ExportHistory };
    }
    throw error;
  }
  const history = JSON.parse(source) as ExportHistory;
  if (
    !history ||
    Array.isArray(history) ||
    typeof history !== "object" ||
    Object.values(history).some(
      (entry) =>
        !entry ||
        (entry.threadId !== null && typeof entry.threadId !== "string") ||
        (entry.contents !== undefined &&
          (!Array.isArray(entry.contents) ||
            entry.contents.some((content) => typeof content !== "string"))),
    )
  ) {
    throw new Error(`Invalid signup-export history: ${path}`);
  }
  return { source, history };
};

const readThreadContents = async (
  rest: Pick<REST, "get">,
  threadId: string,
): Promise<string[]> => {
  const contents: string[] = [];
  let before: string | undefined;
  while (true) {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);
    const messages = (await rest.get(Routes.channelMessages(threadId), {
      query,
    })) as APIMessage[];
    for (const message of messages) {
      const text = [
        message.content,
        ...(message.embeds ?? []).flatMap((embed) => [
          embed.title,
          embed.description,
          ...(embed.fields ?? []).flatMap((field) => [field.name, field.value]),
          embed.footer?.text,
        ]),
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n");
      if (text) contents.push(text);
    }
    if (messages.length < 100) return contents;
    const nextBefore = messages.at(-1)!.id;
    if (nextBefore === before)
      throw new Error(`Stalled message history for ${threadId}`);
    before = nextBefore;
  }
};

const backfillThread = async (
  rest: Pick<REST, "get">,
  history: ExportHistory,
  threadId: string,
) => {
  const records = Object.values(history).filter(
    (entry) => entry.threadId === threadId,
  );
  const missingContents = records.filter((entry) => !entry.contents?.length);
  if (records.length && !missingContents.length)
    return { added: 0, updated: 0 };
  const contents = await readThreadContents(rest, threadId);
  if (!contents.length) {
    throw new Error(
      `No readable message contents in pending thread ${threadId}; check Message Content Intent and permissions`,
    );
  }
  if (records.length) {
    for (const record of missingContents) record.contents = contents;
    return { added: 0, updated: missingContents.length };
  }
  const key = JSON.stringify(["legacy-thread", threadId]);
  if (Object.hasOwn(history, key))
    throw new Error(`Migration key already exists: ${key}`);
  history[key] = { threadId, contents };
  return { added: 1, updated: 0 };
};

const planGuildMigration = async (
  rest: Pick<REST, "get">,
  guildId: string,
  forumId: string,
  directory: string,
): Promise<MigrationPlan> => {
  const forum = (await rest.get(Routes.channel(forumId))) as {
    type: ChannelType;
    guild_id?: string;
  };
  if (forum.type !== ChannelType.GuildForum || forum.guild_id !== guildId) {
    throw new Error(
      `Payout channel ${forumId} is not a forum in guild ${guildId}`,
    );
  }
  const path = resolve(directory, `${guildId}.json`);
  const { source, history } = await loadHistory(path);
  const active = (await rest.get(Routes.guildActiveThreads(guildId))) as {
    threads: ActiveThread[];
  };
  const pending = active.threads.filter(
    (thread) =>
      thread.parent_id === forumId &&
      !thread.thread_metadata?.archived &&
      thread.name.includes("\u23f3") &&
      !thread.name.toUpperCase().includes("NO SHARE"),
  );
  const results = await Promise.all(
    pending.map((thread) => backfillThread(rest, history, thread.id)),
  );
  return {
    guildId,
    path,
    source,
    history,
    added: results.reduce((total, result) => total + result.added, 0),
    updated: results.reduce((total, result) => total + result.updated, 0),
  };
};

const writeMigrationPlan = async (plan: MigrationPlan): Promise<void> => {
  if (plan.source !== null) {
    try {
      await writeFile(`${plan.path}.migration.bak`, plan.source, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const temporaryPath = `${plan.path}.${randomUUID()}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(plan.history, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, plan.path);
};

/**
 * Backfills export history from active pending threads in eligible guild payout forums.
 * Reads all message pages, including embed text, and preserves existing nonempty contents.
 * Plans every guild before writing; existing files receive a non-overwriting backup.
 * Run with the bot stopped to avoid concurrent export-history writes.
 * @param rest Authenticated Discord REST client with message-history access.
 * @param guildIds Eligible payout guild IDs; guilds without a configured forum are skipped.
 * @param forumIds Configured payoutSheetChannelId values indexed by guild ID.
 * @param directory Destination history directory; defaults to private/signup-exports under the working directory.
 * @param dryRun Whether to report changes without writing files or backups.
 * @returns Per-guild counts of added records and records with backfilled contents.
 */
export const migrateSignupExports = async (
  rest: Pick<REST, "get">,
  guildIds: readonly string[],
  forumIds: Readonly<Record<string, string>>,
  directory = resolve(process.cwd(), "private", "signup-exports"),
  dryRun = false,
) => {
  const eligible = [...new Set(guildIds)].filter(
    (guildId) => forumIds[guildId],
  );
  const scanned = await Promise.all(
    eligible.map((guildId) =>
      planGuildMigration(rest, guildId, forumIds[guildId]!, directory),
    ),
  );
  const plans = scanned.filter((plan) => plan.added || plan.updated);
  if (!dryRun && plans.length) {
    await mkdir(directory, { recursive: true });
    await Promise.all(plans.map(writeMigrationPlan));
  }
  return plans.map(({ guildId, path, added, updated }) => ({
    guildId,
    path,
    added,
    updated,
  }));
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { root, directory, dryRun } = parseSignupExportMigrationOptions();
    console.log(`Using bot root: ${root}`);
    console.log(`Using signup export directory: ${directory}`);
    process.chdir(root);
    await import("dotenv/config");
    if (!process.env.DISCORD_TOKEN)
      throw new Error("DISCORD_TOKEN must be set");
    const { DISCORD_SETTINGS } = await import("../config/discord-settings.js");
    const results = await migrateSignupExports(
      new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN),
      DISCORD_SETTINGS.payoutGuildIds,
      DISCORD_SETTINGS.payoutSheetChannelIdByGuild ?? {},
      directory,
      dryRun,
    );
    for (const result of results) {
      console.log(
        `${dryRun ? "Would update" : "Updated"} ${result.path}: ${result.added} added, ${result.updated} backfilled`,
      );
    }
    console.log(
      `${dryRun ? "Would update" : "Updated"} ${results.length} signup-export file(s). Guilds without a payout forum are skipped.`,
    );
  } catch (error) {
    console.error("Could not migrate signup exports:", error);
    process.exitCode = 1;
  }
}
