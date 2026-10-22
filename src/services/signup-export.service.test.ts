import { jest } from "@jest/globals";
import { resolve } from "node:path";

const files = new Map<string, string>();
const readFile = jest.fn(async (path: string) => {
  const content = files.get(path);
  if (content === undefined) {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  }
  return content;
});
const writeFile = jest.fn(async (path: string, content: string) => {
  files.set(path, content);
});
const rename = jest.fn(async (from: string, to: string) => {
  files.set(to, files.get(from)!);
  files.delete(from);
});
jest.unstable_mockModule("node:fs/promises", () => ({
  mkdir: jest.fn(),
  readFile,
  writeFile,
  rename,
}));
const { exportSignupRun, getCurrentlyVendingThreads } =
  await import("./signup-export.service.js");

describe("signup export history", () => {
  beforeEach(() => {
    files.clear();
    jest.clearAllMocks();
  });

  it("lists only participating exports whose current thread title is still vending with shares", async () => {
    files.set(
      resolve(process.cwd(), "private", "signup-exports", "guild.json"),
      JSON.stringify({
        eligible: { threadId: "vending", contents: ["roster", "<@11111>"] },
        duplicate: { threadId: "vending", contents: ["<@11111>"] },
        completed: { threadId: "completed", contents: ["<@11111>"] },
        noShare: { threadId: "no-share", contents: ["<@11111>"] },
        otherMember: { threadId: "other", contents: ["<@111111>"] },
        legacy: { threadId: "legacy" },
        reserved: { threadId: null, contents: ["<@11111>"] },
        deleted: { threadId: "deleted", contents: ["<@11111>"] },
        otherGuild: { threadId: "other-guild", contents: ["<@11111>"] },
        notThread: { threadId: "channel", contents: ["<@11111>"] },
      }),
    );
    const names: Record<string, string> = {
      vending: "\u23f3 Run",
      completed: "Done",
      "no-share": "\u23f3 no share run",
    };
    const fetch = jest.fn(async (id: string) => {
      if (id === "deleted") throw new Error("Unknown Channel");
      return {
        id,
        guildId: id === "other-guild" ? "another-guild" : "guild",
        name: names[id] ?? "\u23f3 Run",
        isThread: () => id !== "channel",
      };
    });

    await expect(
      getCurrentlyVendingThreads(
        { channels: { fetch } } as never,
        "guild",
        "11111",
      ),
    ).resolves.toEqual(["<#vending>"]);
    expect(fetch).toHaveBeenCalledWith("vending");
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("returns no vending threads when the guild has no export history", async () => {
    const fetch = jest.fn();
    await expect(
      getCurrentlyVendingThreads(
        { channels: { fetch } } as never,
        "missing-guild",
        "11111",
      ),
    ).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("degrades malformed history to no vending links but keeps exports fail-closed", async () => {
    files.set(
      resolve(process.cwd(), "private", "signup-exports", "guild.json"),
      "{broken",
    );
    const fetch = jest.fn();
    await expect(
      getCurrentlyVendingThreads(
        { channels: { fetch } } as never,
        "guild",
        "member",
      ),
    ).resolves.toEqual([]);
    const create = jest.fn(async () => "thread");
    await expect(
      exportSignupRun("guild", "run", create),
    ).rejects.toBeInstanceOf(SyntaxError);
    expect(create).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retries a crashed reservation after checking all overlapping identifiers", async () => {
    const path = resolve(
      process.cwd(),
      "private",
      "signup-exports",
      "guild.json",
    );
    files.set(path, JSON.stringify({ combined: { threadId: null } }));
    const find = jest.fn(async () => null);
    const create = jest.fn(async () => "thread");
    await expect(
      exportSignupRun(
        "guild",
        "first",
        create,
        find,
        ["<@member>"],
        ["combined"],
      ),
    ).resolves.toEqual({ created: true, threadId: "thread" });
    expect(JSON.parse(files.get(path)!)).toEqual({
      first: { threadId: "thread", contents: ["<@member>"] },
    });
    expect(find).toHaveBeenCalledWith("first");
    expect(find).toHaveBeenCalledWith("combined");
  });

  it("keeps a crashed reservation when the forum check fails", async () => {
    const path = resolve(
      process.cwd(),
      "private",
      "signup-exports",
      "guild.json",
    );
    const saved = JSON.stringify({ run: { threadId: null } });
    files.set(path, saved);
    const create = jest.fn(async () => "thread");
    await expect(
      exportSignupRun("guild", "run", create, async () => {
        throw new Error("Missing permissions");
      }),
    ).rejects.toThrow("Missing permissions");
    expect(files.get(path)).toBe(saved);
    expect(create).not.toHaveBeenCalled();
  });

  it("persists the thread and rejects subsequent exports", async () => {
    const create = jest.fn(async () => "thread");
    await expect(exportSignupRun("guild", "run-date", create)).resolves.toEqual(
      {
        created: true,
        threadId: "thread",
      },
    );
    await expect(exportSignupRun("guild", "run-date", create)).resolves.toEqual(
      {
        created: false,
        threadId: "thread",
      },
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("honors a previously persisted export without creating a thread", async () => {
    const path = resolve(
      process.cwd(),
      "private",
      "signup-exports",
      "guild.json",
    );
    files.set(path, JSON.stringify({ "run-date": { threadId: "old-thread" } }));
    const create = jest.fn(async () => "new-thread");
    await expect(exportSignupRun("guild", "run-date", create)).resolves.toEqual(
      {
        created: false,
        threadId: "old-thread",
      },
    );
    expect(create).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("records a matching forum post instead of creating a duplicate", async () => {
    const create = jest.fn(async () => "new-thread");
    const findExisting = jest.fn(async () => ({
      threadId: "existing-thread",
      contents: ["original roster", "<@11111>"],
    }));
    await expect(
      exportSignupRun("guild", "run-date", create, findExisting),
    ).resolves.toEqual({
      created: false,
      threadId: "existing-thread",
    });
    expect(create).not.toHaveBeenCalled();
    await expect(
      exportSignupRun("guild", "run-date", create, findExisting),
    ).resolves.toEqual({
      created: false,
      threadId: "existing-thread",
    });
    expect(findExisting).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(
        files.get(
          resolve(process.cwd(), "private", "signup-exports", "guild.json"),
        )!,
      )["run-date"],
    ).toEqual({
      threadId: "existing-thread",
      contents: ["original roster", "<@11111>"],
    });
  });

  it.each([null, "existing-thread"])(
    "repairs roster contents for a saved thread ID of %s",
    async (threadId) => {
      const path = resolve(
        process.cwd(),
        "private",
        "signup-exports",
        "guild.json",
      );
      files.set(path, JSON.stringify({ "run-date": { threadId } }));
      const create = jest.fn(async () => "new-thread");
      const recovered = {
        threadId: "existing-thread",
        contents: ["<@original>", "<@followup>"],
      };
      await exportSignupRun(
        "guild",
        "run-date",
        create,
        async () => recovered,
        ["<@new-signup>"],
      );
      expect(JSON.parse(files.get(path)!)["run-date"]).toEqual(recovered);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("does not create a post if checking existing forum identifiers fails", async () => {
    const create = jest.fn(async () => "thread");
    const findExisting = jest
      .fn<() => Promise<string | null>>()
      .mockRejectedValue(new Error("Cannot read forum history"));
    await expect(
      exportSignupRun("guild", "run-date", create, findExisting),
    ).rejects.toThrow("Cannot read forum history");
    expect(create).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("persists a reservation before creating the Discord post", async () => {
    const path = resolve(
      process.cwd(),
      "private",
      "signup-exports",
      "guild.json",
    );
    const create = jest.fn(async () => {
      expect(JSON.parse(files.get(path)!)).toEqual({
        "run-date": { threadId: null },
      });
      return "thread";
    });
    await exportSignupRun("guild", "run-date", create);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not create a post when its reservation cannot be persisted", async () => {
    writeFile.mockRejectedValueOnce(new Error("disk failure"));
    const create = jest.fn(async () => "thread");
    await expect(exportSignupRun("guild", "run-date", create)).rejects.toThrow(
      "disk failure",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("serializes simultaneous attempts so only one thread is created", async () => {
    const create = jest.fn(async () => "thread");
    const results = await Promise.all([
      exportSignupRun("guild", "run-date", create),
      exportSignupRun("guild", "run-date", create),
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.created)).toEqual([true, false]);
  });

  it.each([false, true])(
    "serializes overlapping modes with split first=%s",
    async (splitFirst) => {
      const create = jest.fn(async () => "thread");
      const combined = () =>
        exportSignupRun(
          "guild",
          "combined",
          create,
          undefined,
          ["<@member>"],
          ["first", "second"],
        );
      const split = () =>
        exportSignupRun(
          "guild",
          "first",
          create,
          undefined,
          ["<@member>"],
          ["combined"],
        );
      const results = await Promise.all(
        splitFirst ? [split(), combined()] : [combined(), split()],
      );
      expect(results.map((result) => result.created)).toEqual([true, false]);
      expect(create).toHaveBeenCalledTimes(1);
    },
  );

  it("checks overlapping forum identifiers before reserving and saves only the recovered coverage", async () => {
    const create = jest.fn(async () => "new-thread");
    const recovered = {
      threadId: "old-thread",
      contents: ["<@original>", "<@followup>"],
    };
    const findExisting = jest.fn(async (key: string) =>
      key === "first" ? recovered : null,
    );
    await expect(
      exportSignupRun(
        "guild",
        "combined",
        create,
        findExisting,
        ["<@new>"],
        ["first", "second"],
      ),
    ).resolves.toEqual({ created: false, threadId: "old-thread" });
    expect(findExisting.mock.calls).toEqual([["combined"], ["first"]]);
    expect(create).not.toHaveBeenCalled();
    const path = resolve(
      process.cwd(),
      "private",
      "signup-exports",
      "guild.json",
    );
    expect(JSON.parse(files.get(path)!)).toEqual({ first: recovered });
    await exportSignupRun(
      "guild",
      "second",
      create,
      async () => null,
      ["<@new>"],
      ["combined"],
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("blocks overlapping combined exports but allows a missing split part", async () => {
    const create = jest.fn(async () => "thread");
    await exportSignupRun(
      "guild",
      "first",
      create,
      undefined,
      ["<@11111>"],
      ["combined"],
    );
    await expect(
      exportSignupRun("guild", "combined", create, undefined, undefined, [
        "first",
        "second",
      ]),
    ).resolves.toEqual({ created: false, threadId: "thread" });
    await exportSignupRun("guild", "second", create, undefined, undefined, [
      "combined",
    ]);
    expect(create).toHaveBeenCalledTimes(2);
    await exportSignupRun("other-guild", "combined", create);
    await expect(
      exportSignupRun("other-guild", "first", create, undefined, undefined, [
        "combined",
      ]),
    ).resolves.toEqual({ created: false, threadId: "thread" });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("allows another run, another date, or another guild", async () => {
    const create = jest.fn(async () => "thread");
    await exportSignupRun("guild", "run-date", create);
    await exportSignupRun("guild", "other-run-date", create);
    await exportSignupRun("guild", "run-other-date", create);
    await exportSignupRun("other-guild", "run-date", create);
    expect(create).toHaveBeenCalledTimes(4);
  });

  it("allows retry after thread creation fails", async () => {
    const create = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Discord failure"))
      .mockResolvedValue("thread");
    await expect(exportSignupRun("guild", "run-date", create)).rejects.toThrow(
      "Discord failure",
    );
    await expect(exportSignupRun("guild", "run-date", create)).resolves.toEqual(
      {
        created: true,
        threadId: "thread",
      },
    );
  });

  it("retains the reservation if persisting the created thread fails", async () => {
    const create = jest.fn(async () => "thread");
    rename
      .mockImplementationOnce(async (from, to) => {
        files.set(to, files.get(from)!);
        files.delete(from);
      })
      .mockRejectedValueOnce(new Error("disk failure"));
    await expect(exportSignupRun("guild", "run-date", create)).rejects.toThrow(
      "disk failure",
    );
    await expect(exportSignupRun("guild", "run-date", create)).resolves.toEqual(
      {
        created: false,
        threadId: null,
      },
    );
    expect(create).toHaveBeenCalledTimes(1);
  });
});
