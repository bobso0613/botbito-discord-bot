import { describe, expect, it, jest } from "@jest/globals";
import {
  Collection,
  DiscordAPIError,
  RESTJSONErrorCodes,
  type FetchArchivedThreadOptions,
} from "discord.js";
import {
  findExistingExport,
  recoverExportThread,
} from "./signup-export-forum.service.js";

const identifier = "-# Export ID: botbito-export:v1:test-id";
const buildThread = (
  id: string,
  content: string | null,
  authorId = "bot",
  archiveTimestamp: number | null = 1000,
) => ({
  id,
  name: "\u23f3Run - 01/10",
  archiveTimestamp,
  fetchStarterMessage: jest.fn(async () =>
    content === null ? null : { content, author: { id: authorId } },
  ),
});
type TestThread = ReturnType<typeof buildThread>;
const threads = (...values: TestThread[]) =>
  new Collection(values.map((thread) => [thread.id, thread]));
const createForum = () => ({
  client: { user: { id: "bot" } },
  threads: {
    fetchActive: jest.fn(async () => ({ threads: threads() })),
    fetchArchived: jest.fn(async (_options: FetchArchivedThreadOptions) => ({
      threads: threads(),
      hasMore: false,
    })),
  },
});

describe("signup export forum lookup", () => {
  it.each([
    { code: RESTJSONErrorCodes.UnknownChannel, missing: true },
    { code: RESTJSONErrorCodes.MissingAccess, missing: false },
  ])(
    "handles thread recovery error $code without hiding access failures",
    async ({ code, missing }) => {
      const error = new DiscordAPIError(
        { code, message: "Discord lookup failed" },
        code,
        404,
        "GET",
        "https://discord.com/api/channels/thread",
        {},
      );
      const forum = {
        threads: {
          fetch: jest.fn(async () => {
            throw error;
          }),
        },
      };
      const result = recoverExportThread(forum as never, "thread");
      if (missing) await expect(result).resolves.toBeNull();
      else await expect(result).rejects.toBe(error);
    },
  );
  it("fetches starters only for matching run dates across active and archived threads", async () => {
    const forum = createForum();
    const unrelated = buildThread("unrelated", identifier);
    unrelated.name = "\u23f3Other run - 02/10";
    const matching = buildThread("matching", identifier);
    matching.name = "\u23f3(ET) Renamed run - 01/10 [emoji]";
    forum.threads.fetchActive.mockResolvedValueOnce({
      threads: threads(unrelated),
    });
    forum.threads.fetchArchived.mockResolvedValueOnce({
      threads: threads(unrelated, matching),
      hasMore: false,
    });
    await expect(
      findExistingExport(forum as never, identifier, "2026-10-01"),
    ).resolves.toBe("matching");
    expect(unrelated.fetchStarterMessage).not.toHaveBeenCalled();
    expect(matching.fetchStarterMessage).toHaveBeenCalledTimes(1);
  });
  it.each(["active", "archived"])(
    "skips deleted %s starters and still finds another export",
    async (location) => {
      const forum = createForum();
      const deleted = buildThread("deleted", null);
      deleted.fetchStarterMessage.mockRejectedValueOnce(
        new DiscordAPIError(
          {
            code: RESTJSONErrorCodes.UnknownMessage,
            message: "Unknown Message",
          },
          RESTJSONErrorCodes.UnknownMessage,
          404,
          "GET",
          "https://discord.com/api/messages/deleted",
          {},
        ),
      );
      const candidates = threads(deleted, buildThread("match", identifier));
      if (location === "active")
        forum.threads.fetchActive.mockResolvedValueOnce({
          threads: candidates,
        });
      else
        forum.threads.fetchArchived.mockResolvedValueOnce({
          threads: candidates,
          hasMore: false,
        });
      await expect(
        findExistingExport(forum as never, identifier),
      ).resolves.toBe("match");
    },
  );
  it("recovers the original bot roster across message pages, excluding participant replies", async () => {
    const message = (id: string, content: string, authorId = "bot") => ({
      id,
      content,
      author: { id: authorId },
      createdTimestamp: Number(id),
    });
    const page = new Collection(
      Array.from({ length: 100 }, (_, index) => {
        const entry = message(
          String(200 - index),
          index === 0
            ? "**Payout roster continued:**\n02: DPS - <@followup>"
            : index === 1
              ? "Google Sheets updated"
              : "reply",
          index < 2 ? "bot" : "member",
        );
        return [entry.id, entry] as const;
      }),
    );
    const starter = message(
      "1",
      "**Party 1:**\n01: Champ - <@original>",
    );
    const fetch = jest
      .fn<(...args: unknown[]) => Promise<typeof page>>()
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce(
        new Collection([["1", starter]]),
      );
    const forum = {
      client: { user: { id: "bot" } },
      threads: {
        fetch: jest.fn(async () => ({
          fetchStarterMessage: jest.fn(async () => starter),
          messages: { fetch },
        })),
      },
    };
    await expect(
      recoverExportThread(forum as never, "existing"),
    ).resolves.toEqual({
      threadId: "existing",
      contents: [
        "**Party 1:**\n01: Champ - <@original>",
        "**Payout roster continued:**\n02: DPS - <@followup>",
      ],
    });
    expect(fetch).toHaveBeenNthCalledWith(2, { limit: 100, before: "101" });
  });
  it("finds an active bot-authored identifier footer and skips archives", async () => {
    const forum = createForum();
    forum.threads.fetchActive.mockResolvedValueOnce({
      threads: threads(buildThread("active", `Roster\n${identifier}\n  `)),
    });
    await expect(findExistingExport(forum as never, identifier)).resolves.toBe(
      "active",
    );
    expect(forum.threads.fetchArchived).not.toHaveBeenCalled();
  });

  it.each([
    { content: identifier, author: "someone-else" },
    { content: `${identifier}\nNot a footer`, author: "bot" },
    { content: `${identifier}-different`, author: "bot" },
    { content: null, author: "bot" },
  ])(
    "ignores unrelated starter content ($content, $author)",
    async ({ content, author }) => {
      const forum = createForum();
      forum.threads.fetchActive.mockResolvedValueOnce({
        threads: threads(buildThread("unrelated", content, author)),
      });
      await expect(
        findExistingExport(forum as never, identifier),
      ).resolves.toBeNull();
      expect(forum.threads.fetchArchived).toHaveBeenCalledTimes(1);
    },
  );

  it("returns null when active and archived posts are empty", async () => {
    await expect(
      findExistingExport(createForum() as never, identifier),
    ).resolves.toBeNull();
  });

  it("finds an archived match", async () => {
    const forum = createForum();
    forum.threads.fetchArchived.mockResolvedValueOnce({
      threads: threads(buildThread("archived", identifier)),
      hasMore: false,
    });
    await expect(findExistingExport(forum as never, identifier)).resolves.toBe(
      "archived",
    );
    expect(forum.threads.fetchArchived).toHaveBeenCalledWith({
      limit: 100,
      before: undefined,
    });
  });

  it("paginates archives using the last archive timestamp until it finds a match", async () => {
    const forum = createForum();
    forum.threads.fetchArchived
      .mockResolvedValueOnce({
        threads: threads(
          buildThread("newer", "Other run", "bot", 2000),
          buildThread("older", "Other run", "bot", 1000),
        ),
        hasMore: true,
      })
      .mockResolvedValueOnce({
        threads: threads(buildThread("match", identifier, "bot", 500)),
        hasMore: false,
      });
    await expect(findExistingExport(forum as never, identifier)).resolves.toBe(
      "match",
    );
    expect(forum.threads.fetchArchived).toHaveBeenNthCalledWith(2, {
      limit: 100,
      before: new Date(1000),
    });
  });

  it.each(["empty", "missing timestamp"])(
    "rejects an incomplete archive page with %s",
    async (reason) => {
      const forum = createForum();
      forum.threads.fetchArchived.mockResolvedValueOnce({
        threads:
          reason === "empty"
            ? threads()
            : threads(buildThread("broken", "Other", "bot", null)),
        hasMore: true,
      });
      await expect(
        findExistingExport(forum as never, identifier),
      ).rejects.toThrow("Could not finish checking archived exports.");
    },
  );

  it("rejects a stalled pagination cursor rather than looping or allowing duplicates", async () => {
    const forum = createForum();
    forum.threads.fetchArchived.mockResolvedValue({
      threads: threads(buildThread("same-page", "Other run")),
      hasMore: true,
    });
    await expect(
      findExistingExport(forum as never, identifier),
    ).rejects.toThrow("Could not finish checking archived exports.");
    expect(forum.threads.fetchArchived).toHaveBeenCalledTimes(2);
  });

  it.each(["active", "archived", "starter"])(
    "propagates %s read failures",
    async (source) => {
      const forum = createForum();
      const error = new Error("Missing read permission");
      if (source === "active")
        forum.threads.fetchActive.mockRejectedValueOnce(error);
      if (source === "archived")
        forum.threads.fetchArchived.mockRejectedValueOnce(error);
      if (source === "starter") {
        const thread = buildThread("unreadable", identifier);
        thread.fetchStarterMessage.mockRejectedValueOnce(error);
        forum.threads.fetchActive.mockResolvedValueOnce({
          threads: threads(thread),
        });
      }
      await expect(
        findExistingExport(forum as never, identifier),
      ).rejects.toThrow(error);
    },
  );
});
