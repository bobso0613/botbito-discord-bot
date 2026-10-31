import { jest } from "@jest/globals";
import { resolve } from "node:path";
import { Collection } from "discord.js";
import type { SignupSheet } from "../types/signup-sheet.js";
import type { SignupExportPart } from "../types/signup-export.js";

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
const settings = {
  payoutWorksheets: {} as Record<string, string>,
  cooldownInstanceTypesByGuild: {},
};
jest.unstable_mockModule("../config/discord-settings.js", () => ({
  DISCORD_SETTINGS: settings,
}));
const getSignupSheet = jest.fn<() => Promise<SignupSheet | null>>();
const readPayoutSpreadsheet = jest.fn(
  async (_worksheet: string): Promise<never> => {
    throw Object.assign(new Error("Missing spreadsheet access"), {
      code: 403,
    });
  },
);
jest.unstable_mockModule("./google-sheets.service.js", () => ({
  readPayoutSpreadsheet,
  writePayoutSpreadsheet: jest.fn(),
}));
jest.unstable_mockModule("./signup-sheet.service.js", () => ({
  getSignupSheet,
}));
const {
  exportSignupRun,
  getCurrentlyVendingThreads,
  getSignupExportOrganizerId,
} =
  await import("./signup-export.service.js");
const { sendExport } = await import("./signup-export-forum.service.js");
const { buildExportIdentifier, getExportRunKey } =
  await import("../utils/signup-export.js");

describe("signup export history", () => {
  beforeEach(() => {
    files.clear();
    settings.payoutWorksheets = {};
    jest.clearAllMocks();
  });

  it("keeps the confirmed Discord export and reports a manual-update warning when Sheets fails", async () => {
    const sheet: SignupSheet = {
      guildId: "499171225046876170",
      channelId: "signup",
      title: "Endless Tower",
      organizerId: "organizer",
      organizerName: "Organizer",
      organizerAvatarUrl: "",
      partySizes: [1],
      slots: [
        {
          number: 1,
          role: "DPS",
          signupUserId: "111",
          signupDisplayName: "Alice",
          charNote: null,
        },
      ],
      reserves: [],
      notes: null,
      thumbnailUrl: null,
      color: null,
      instanceType: "Endless Tower",
      timestamp: Date.UTC(2026, 9, 29) / 1000,
      serverTimezone: "GMT",
      scheduleTimezone: null,
    };
    settings.payoutWorksheets[sheet.guildId] = "Payout";
    getSignupSheet.mockResolvedValue(sheet);
    const forum = {
      guild: {
        id: sheet.guildId,
        members: {
          fetch: jest.fn(async () => ({
            displayName: "Alice",
            user: { username: "alice" },
          })),
        },
      },
      client: { user: { id: "bot" } },
      threads: {
        create: jest.fn(async () => ({ id: "post", send: jest.fn() })),
        fetchActive: jest.fn(async () => ({ threads: new Collection() })),
        fetchArchived: jest.fn(async () => ({
          threads: new Collection(),
          hasMore: false,
        })),
      },
    };
    const part: SignupExportPart = {
      runKey: getExportRunKey(sheet),
      identifier: buildExportIdentifier(sheet),
      sheet,
      slots: sheet.slots,
      contents: ["<@111>"],
      vendor: "Vendor",
    };
    const result = await sendExport("organizer", forum as never, sheet, part);
    expect(result).toContain("Exported the signup roster to <#post>");
    expect(result).toContain("Sheets API error 403");
    expect(result).toContain("Please update Google Sheets manually");
    expect(forum.threads.create).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(
      files.get(
        resolve(
          process.cwd(),
          "private",
          "signup-exports",
          `${sheet.guildId}.json`,
        ),
      )!,
    );
    expect(saved[part.runKey].threadId).toBe("post");
    expect(saved[part.runKey].sheetsSync.status).toBe("pending");
  });

  it.each([
    { selection: "cleared", instanceType: null },
    {
      selection: "replaced",
      instanceType: ["Different One", "Different Two"],
    },
  ])(
    "does not post again after ET/EC split selections are $selection",
    async ({ instanceType }) => {
      const sheet: SignupSheet = {
        guildId: "guild",
        channelId: "signup",
        title: "Endless Tower",
        organizerId: "organizer",
        organizerName: "Organizer",
        organizerAvatarUrl: "",
        partySizes: [1],
        slots: [
          {
            number: 1,
            role: "DPS",
            signupUserId: "member",
            signupDisplayName: "Member",
            charNote: null,
          },
        ],
        reserves: [],
        notes: null,
        thumbnailUrl: null,
        color: null,
        instanceType: ["Endless Tower", "Endless Cellar"],
        timestamp: Date.UTC(2026, 9, 1) / 1000,
        serverTimezone: "GMT",
        scheduleTimezone: null,
      };
      getSignupSheet.mockImplementation(async () => sheet);
      const create = jest.fn(async () => ({
        id: "post",
        send: jest.fn(),
      }));
      const forum = {
        client: { user: { id: "bot" } },
        threads: {
          create,
          fetchActive: jest.fn(async () => ({
            threads: new Collection(),
          })),
          fetchArchived: jest.fn(async () => ({
            threads: new Collection(),
            hasMore: false,
          })),
        },
      };
      const part = (instanceName?: string): SignupExportPart => ({
        runKey: getExportRunKey(sheet, instanceName),
        identifier: buildExportIdentifier(sheet, instanceName),
        sheet: instanceName
          ? { ...sheet, instanceType: [instanceName] }
          : sheet,
        slots: sheet.slots,
        contents: ["<@member>"],
        vendor: "Vendor",
      });
      await sendExport(
        "organizer",
        forum as never,
        sheet,
        part("Endless Tower"),
      );
      await sendExport(
        "organizer",
        forum as never,
        sheet,
        part("Endless Cellar"),
      );
      sheet.instanceType = instanceType;
      sheet.title = "  ENDLESS   TOWER  ";
      await expect(
        sendExport("organizer", forum as never, sheet, part()),
      ).resolves.toContain("already been exported");
      expect(create).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    { selection: "cleared", currentSplitKeys: [] },
    {
      selection: "replaced",
      currentSplitKeys: [
        JSON.stringify(["endless tower", "2026-10-01", "Different Instance"]),
      ],
    },
  ])(
    "blocks a combined export after split selections are $selection",
    async ({ currentSplitKeys }) => {
      const combined = JSON.stringify(["endless tower", "2026-10-01"]);
      const first = JSON.stringify([
        "endless tower",
        "2026-10-01",
        "Endless Tower",
      ]);
      const second = JSON.stringify([
        "endless tower",
        "2026-10-01",
        "Endless Cellar",
      ]);
      const create = jest.fn(async () => "split-thread");
      await exportSignupRun(
        "guild",
        first,
        create,
        undefined,
        ["<@member>"],
        [combined],
      );
      await exportSignupRun(
        "guild",
        second,
        create,
        undefined,
        ["<@member>"],
        [combined],
      );
      await expect(
        exportSignupRun(
          "guild",
          combined,
          create,
          undefined,
          undefined,
          currentSplitKeys,
        ),
      ).resolves.toEqual({ created: false, threadId: "split-thread" });
      expect(create).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps missing split parts retryable without matching unrelated titles or dates", async () => {
    const combined = JSON.stringify(["run", "2026-10-01"]);
    const first = JSON.stringify(["run", "2026-10-01", "ET"]);
    const second = JSON.stringify(["run", "2026-10-01", "EC"]);
    const create = jest.fn(async () => "thread");
    await exportSignupRun("guild", first, create);
    await expect(
      exportSignupRun("guild", second, create, undefined, undefined, [
        combined,
      ]),
    ).resolves.toEqual({ created: true, threadId: "thread" });
    await exportSignupRun(
      "guild",
      JSON.stringify(["other", "2026-10-01"]),
      create,
    );
    await exportSignupRun(
      "guild",
      JSON.stringify(["run", "2026-10-02"]),
      create,
    );
    expect(create).toHaveBeenCalledTimes(4);
  });

  it("recovers an earlier split identity from a pending entry after selections are cleared", async () => {
    const combined = JSON.stringify(["run", "2026-10-01"]);
    const split = JSON.stringify(["run", "2026-10-01", "Endless Tower"]);
    const path = resolve(
      process.cwd(),
      "private",
      "signup-exports",
      "guild.json",
    );
    files.set(path, JSON.stringify({ [split]: { threadId: null } }));
    const recovered = {
      threadId: "original",
      contents: ["<@original-member>"],
    };
    const find = jest.fn(async (key: string) =>
      key === split ? recovered : null,
    );
    const create = jest.fn(async () => "duplicate");
    await expect(
      exportSignupRun("guild", combined, create, find, ["<@changed-member>"]),
    ).resolves.toEqual({ created: false, threadId: "original" });
    expect(find).toHaveBeenCalledWith(split, undefined);
    expect(JSON.parse(files.get(path)!)[split]).toEqual(recovered);
    expect(create).not.toHaveBeenCalled();
  });

  it("rechecks identifiers and retries an ID-only entry whose original thread is deleted", async () => {
    const path = resolve(
      process.cwd(),
      "private",
      "signup-exports",
      "guild.json",
    );
    files.set(path, JSON.stringify({ run: { threadId: "deleted" } }));
    const find = jest.fn(async () => null);
    const create = jest.fn(async () => "replacement");
    await expect(
      exportSignupRun("guild", "run", create, find),
    ).resolves.toEqual({ created: true, threadId: "replacement" });
    expect(find.mock.calls).toEqual([["run", "deleted"], ["run"]]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("lists only participating exports whose current thread title is still vending with shares", async () => {
    files.set(
      resolve(process.cwd(), "private", "signup-exports", "guild.json"),
      JSON.stringify({
        eligible: {
          threadId: "vending",
          contents: ["roster", "<@11111>"],
        },
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
    const sheetsSync = {
      identifier: "identifier",
      title: "ET 01/10",
      vendor: "Vendor",
      userIds: ["member"],
      mode: "create" as const,
      status: "pending" as const,
      createIfMissing: true,
    };
    const create = jest.fn(async () => {
      expect(JSON.parse(files.get(path)!)).toEqual({
        "run-date": {
          threadId: null,
          organizerId: "organizer",
          contents: ["<@member>"],
          sheetsSync,
        },
      });
      return "thread";
    });
    await exportSignupRun(
      "guild",
      "run-date",
      create,
      undefined,
      ["<@member>"],
      [],
      sheetsSync,
      "organizer",
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(JSON.parse(files.get(path)!)).toEqual({
      "run-date": {
        threadId: "thread",
        organizerId: "organizer",
        contents: ["<@member>"],
        sheetsSync,
      },
    });
    await expect(getSignupExportOrganizerId("guild", "thread")).resolves.toBe(
      "organizer",
    );
  });

  it("preserves reservation ownership and Sheets retry input when recovering a created post", async () => {
    const path = resolve(
      process.cwd(),
      "private",
      "signup-exports",
      "guild.json",
    );
    const sheetsSync = {
      identifier: "identifier",
      title: "ET 01/10",
      vendor: "Vendor",
      userIds: ["member"],
      mode: "create" as const,
      status: "pending" as const,
      createIfMissing: true,
    };
    files.set(
      path,
      JSON.stringify({
        run: { threadId: null, organizerId: "organizer", sheetsSync },
      }),
    );
    const create = jest.fn(async () => "duplicate");
    const findExisting = jest.fn(async () => ({
      threadId: "recovered",
      contents: ["<@member>"],
    }));

    await expect(
      exportSignupRun(
        "guild",
        "run",
        create,
        findExisting,
        ["<@member>"],
        [],
        sheetsSync,
        "organizer",
      ),
    ).resolves.toEqual({ created: false, threadId: "recovered" });
    expect(JSON.parse(files.get(path)!)).toEqual({
      run: {
        threadId: "recovered",
        organizerId: "organizer",
        contents: ["<@member>"],
        sheetsSync,
      },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("blocks Sheets synchronization when recovery finds an incomplete roster", async () => {
    const path = resolve(
      process.cwd(),
      "private",
      "signup-exports",
      "guild.json",
    );
    const sheetsSync = {
      identifier: "identifier",
      title: "ET 01/10",
      vendor: "Vendor",
      userIds: ["member"],
      mode: "create" as const,
      status: "pending" as const,
      createIfMissing: true,
    };
    files.set(
      path,
      JSON.stringify({
        run: {
          threadId: null,
          organizerId: "organizer",
          contents: ["<@member>", "<@followup>"],
          sheetsSync,
        },
      }),
    );

    await exportSignupRun(
      "guild",
      "run",
      jest.fn(async () => "duplicate"),
      async () => ({ threadId: "recovered", contents: ["<@member>"] }),
      ["<@member>", "<@followup>"],
      [],
      sheetsSync,
      "organizer",
    );
    expect(JSON.parse(files.get(path)!).run.sheetsSync).toEqual({
      ...sheetsSync,
      deliveryIncomplete: true,
    });
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
