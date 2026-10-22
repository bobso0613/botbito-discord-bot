import type { ForumChannel, ThreadChannel } from "discord.js";

/** Finds an exact identifier footer in starter messages authored by this bot only. */
const findIdentifierInThreads = async (
  threads: Iterable<ThreadChannel>,
  identifier: string,
  botId: string,
): Promise<string | null> => {
  const matches = await Promise.all(
    Array.from(threads, async (thread) => {
      const starter = await thread.fetchStarterMessage();
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
  before?: Date,
): Promise<string | null> => {
  const archived = await channel.threads.fetchArchived({ limit: 100, before });
  const found = await findIdentifierInThreads(
    archived.threads.values(),
    identifier,
    channel.client.user.id,
  );
  if (found || !archived.hasMore) return found;
  const timestamp = archived.threads.last()?.archiveTimestamp;
  if (!timestamp || (before && timestamp >= before.getTime())) {
    throw new Error("Could not finish checking archived exports.");
  }
  return findArchivedExport(channel, identifier, new Date(timestamp));
};

/** Recovers a duplicate thread from active or archived posts; unreadable history rejects the lookup. */
export const findExistingExport = async (
  channel: ForumChannel,
  identifier: string,
): Promise<string | null> => {
  const active = await channel.threads.fetchActive();
  const found = await findIdentifierInThreads(
    active.threads.values(),
    identifier,
    channel.client.user.id,
  );
  return found ?? findArchivedExport(channel, identifier);
};
