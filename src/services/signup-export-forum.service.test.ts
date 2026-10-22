import { describe, expect, it, jest } from "@jest/globals";
import { Collection } from "discord.js";
import { findExistingExport } from "./signup-export-forum.service.js";

const identifier = "-# Export ID: botbito-export:v1:test-id";
const buildThread = (
  id: string,
  content: string | null,
  authorId = "bot",
  archiveTimestamp: number | null = 1000,
) => ({
  id,
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
    fetchArchived: jest.fn(async () => ({
      threads: threads(),
      hasMore: false,
    })),
  },
});

describe("signup export forum lookup", () => {
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
