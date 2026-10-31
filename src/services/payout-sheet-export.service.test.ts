import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { sheets_v4 } from "googleapis";
import type { SignupExportHistoryEntry } from "../types/signup-export.js";
import type { PayoutSheetSnapshot } from "../types/payout-sheet-export.js";
import {
  buildPendingShareCell,
  PAYOUT_EXPORT_METADATA_KEY,
} from "../utils/payout-sheet-export.js";

jest.unstable_mockModule("../config/discord-settings.js", () => ({
  DISCORD_SETTINGS: {
    payoutWorksheets: {
      "92073842977030144": "Ghostz 2026",
      "499171225046876170": "FSN 2026",
      "1115484031455346718": "DevTestSheet",
    },
  },
}));

const readPayoutSpreadsheet =
  jest.fn<
    (
      worksheet: string,
      includeAllWorksheets?: boolean,
    ) => Promise<sheets_v4.Schema$Spreadsheet>
  >();
const writePayoutSpreadsheet =
  jest.fn<(requests: sheets_v4.Schema$Request[]) => Promise<void>>();
jest.unstable_mockModule("./google-sheets.service.js", () => ({
  readPayoutSpreadsheet,
  writePayoutSpreadsheet,
}));
let entry: SignupExportHistoryEntry;
let historyResolutionError: Error | undefined;
const save = jest.fn<() => Promise<void>>();
jest.unstable_mockModule("./signup-export.service.js", () => ({
  withSignupExportHistory: async (
    _guildId: string,
    _threadId: string,
    action: (
      current: SignupExportHistoryEntry,
      persist: () => Promise<void>,
    ) => Promise<string>,
  ) => {
    if (historyResolutionError) throw historyResolutionError;
    return action(entry, save);
  },
}));
const { queuePayoutSheetOperation, syncPayoutExport } =
  await import("./payout-sheet-export.service.js");

const snapshot = (): PayoutSheetSnapshot => ({
  identifier: "one",
  title: "ET 29/10",
  vendor: "Vendor",
  mode: "create",
  status: "pending",
  createIfMissing: true,
  userIds: ["111"],
  members: [{ userId: "111", displayName: "Alice", discordTag: "alice" }],
});
const grid = (linked = false): sheets_v4.Schema$Spreadsheet => {
  const rows = Array.from(
    { length: 11 },
    (): sheets_v4.Schema$RowData => ({ values: [] }),
  );
  rows[4]!.values![7] = { userEnteredValue: { stringValue: "Unclaimed" } };
  rows[8]!.values = [
    { userEnteredValue: { stringValue: "Name" } },
    {},
    { userEnteredValue: { stringValue: "Discord" } },
  ];
  rows[9]!.values![2] = { userEnteredValue: { stringValue: "@alice" } };
  rows[9]!.values![6] = buildPendingShareCell(6, 1);
  return {
    sheets: [
      {
        properties: {
          title: "FSN 2026",
          sheetId: 1,
          gridProperties: { rowCount: 11, columnCount: 10 },
        },
        data: [{ rowData: rows }],
        developerMetadata: linked
          ? [
              {
                metadataKey: PAYOUT_EXPORT_METADATA_KEY,
                metadataValue: "one",
                location: {
                  dimensionRange: {
                    sheetId: 1,
                    dimension: "COLUMNS",
                    startIndex: 6,
                    endIndex: 7,
                  },
                },
              },
            ]
          : [],
      },
      {
        properties: {
          title: "Combined",
          sheetId: 2,
          gridProperties: { rowCount: 10, columnCount: 4 },
        },
        data: [
          {
            rowData: [
              {},
              {
                values: [{ userEnteredValue: { stringValue: "Discord Tag" } }],
              },
              {
                values: [
                  { userEnteredValue: { stringValue: "@alice" } },
                  {
                    userEnteredValue: {
                      formulaValue:
                        "=IFERROR(VLOOKUP($A3,'FSN 2026'!$C$10:$Z$100,8,FALSE),0)",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
};
const originalStarter = "Roster\n*Your Time: <t:123:F>*\n-# Export ID: one";
const editStarter = jest.fn<(options: unknown) => Promise<void>>();
const fetchStarterMessage = jest.fn(async () => ({
  content: originalStarter,
  edit: editStarter,
}));
const guild = (legacyTags = false) => ({
  id: "499171225046876170",
  channels: {
    fetch: jest.fn(async (_id: string) => ({
      isThread: () => true,
      fetchStarterMessage,
    })),
  },
  members: {
    fetch: jest.fn(async (options: unknown) => {
      const userId = (options as { user: string }).user;
      return userId === "222"
        ? {
            displayName: "Bob",
            user: {
              username: "bob",
              tag: legacyTags ? "bob#1234" : "bob",
            },
          }
        : {
            displayName: "Alice",
            user: {
              username: "alice",
              tag: legacyTags ? "alice#1234" : "alice",
            },
          };
    }),
  },
});

describe("payout Sheets synchronization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    historyResolutionError = undefined;
    editStarter.mockReset().mockResolvedValue();
    fetchStarterMessage.mockReset().mockImplementation(async () => ({
      content: originalStarter,
      edit: editStarter,
    }));
    entry = {
      threadId: "thread",
      contents: ["old"],
      sheetsSync: snapshot(),
    };
    readPayoutSpreadsheet.mockResolvedValue(grid());
    writePayoutSpreadsheet.mockResolvedValue();
    save.mockResolvedValue();
  });

  it("reconciles every potentially committed roster after consecutive timeouts", async () => {
    const spreadsheet = grid(true);
    const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
    rows[10]!.values![2] = { userEnteredValue: { stringValue: "@bob" } };
    rows[11] = { values: [] };
    rows[11]!.values![2] = { userEnteredValue: { stringValue: "@cara" } };
    const combinedRows = spreadsheet.sheets![1]!.data![0]!.rowData!;
    for (const [offset, tag] of ["bob", "cara"].entries()) {
      const row = offset + 3;
      combinedRows[row] = {
        values: [
          { userEnteredValue: { stringValue: `@${tag}` } },
          {
            userEnteredValue: {
              formulaValue: `=IFERROR(VLOOKUP($A${row + 1},'FSN 2026'!$C$10:$Z$100,8,FALSE),0)`,
            },
          },
        ],
      };
    }
    const currentGuild = guild();
    currentGuild.members.fetch.mockImplementation(async (options: unknown) => {
      const userId = (options as { user: string }).user;
      const tag =
        userId === "111" ? "alice" : userId === "222" ? "bob" : "cara";
      return { displayName: tag, user: { username: tag, tag } };
    });
    entry.sheetsSync!.status = "synced";
    readPayoutSpreadsheet.mockResolvedValue(spreadsheet);
    let attempts = 0;
    writePayoutSpreadsheet.mockImplementation(async (requests) => {
      for (const request of requests) {
        const update = request.updateCells;
        if (update?.start?.sheetId !== 1) continue;
        rows[update.start.rowIndex!]!.values![update.start.columnIndex!] =
          update.rows![0]!.values![0]!;
      }
      if (++attempts <= 2) throw new Error("timeout after commit");
    });
    await syncPayoutExport(currentGuild as never, "thread", {
      userIds: ["111", "222"],
    });
    entry = JSON.parse(JSON.stringify(entry)) as SignupExportHistoryEntry;
    await syncPayoutExport(currentGuild as never, "thread", {
      userIds: ["111", "222", "333"],
    });
    entry = JSON.parse(JSON.stringify(entry)) as SignupExportHistoryEntry;
    expect(
      entry.sheetsSync?.pendingRosters?.map((roster) => roster.userIds),
    ).toEqual([["111", "222"]]);

    const notice = await syncPayoutExport(currentGuild as never, "thread", {
      userIds: ["111"],
    });
    expect(notice).toContain("Google Sheets updated");
    expect(writePayoutSpreadsheet).toHaveBeenCalledTimes(3);
    expect(entry.sheetsSync?.pendingRosters).toBeUndefined();
    expect(rows[9]!.values![6]!.userEnteredValue?.formulaValue).toBe(
      "=(G$6-G$8)/1",
    );
    expect(rows[10]!.values![6]!.userEnteredValue).toBeUndefined();
    expect(rows[11]!.values![6]!.userEnteredValue).toBeUndefined();
  });

  it("resolves changed usernames and migrates retained user IDs instead of appending", async () => {
    entry.sheetsSync!.status = "synced";
    const currentGuild = guild(true);
    readPayoutSpreadsheet.mockResolvedValue(grid(true));
    const notice = await syncPayoutExport(currentGuild as never, "thread", {
      userIds: ["111"],
    });
    expect(notice).toContain("Google Sheets updated");
    expect(readPayoutSpreadsheet).toHaveBeenCalledWith("FSN 2026", true);
    const requests = writePayoutSpreadsheet.mock.calls[0]![0];
    expect(JSON.stringify(requests)).toContain("@alice#1234");
    expect(requests.some((request) => request.copyPaste)).toBe(false);
    expect(entry.sheetsSync?.syncedMembers?.[0]?.discordTag).toBe("alice#1234");
  });

  it("skips all Sheets work for an unmapped guild", async () => {
    expect(
      await syncPayoutExport({ id: "unmapped-guild" } as never, "thread"),
    ).toBe("");
    expect(readPayoutSpreadsheet).not.toHaveBeenCalled();
  });

  it("persists roster history edits for an unmapped guild without Sheets work", async () => {
    expect(
      await syncPayoutExport({ id: "unmapped-guild" } as never, "thread", {
        contents: ["new roster"],
        userIds: ["222"],
      }),
    ).toBe("");
    expect(entry.contents).toEqual(["new roster"]);
    expect(entry.participantUserIds).toEqual(["222"]);
    expect(entry.sheetsSync?.userIds).toEqual(["222"]);
    expect(entry.sheetsSync?.mode).toBe("roster");
    expect(entry.sheetsSync?.status).toBe("pending");
    expect(save).toHaveBeenCalledTimes(1);
    expect(readPayoutSpreadsheet).not.toHaveBeenCalled();
    expect(writePayoutSpreadsheet).not.toHaveBeenCalled();
  });

  it("preserves roster IDs independently of a vendor containing a removed member mention", async () => {
    entry.participantUserIds = ["222"];
    entry.sheetsSync = undefined;
    entry.contents = [
      "01: Champ - <@222>\n\nParticipants: **1**\nVendor: **none**",
    ];
    await syncPayoutExport({ id: "unmapped-guild" } as never, "thread", {
      starterContent:
        "01: Champ - <@222>\n\nParticipants: **1**\nVendor: **<@111>**",
      vendor: "<@111>",
    });
    expect(entry.participantUserIds).toEqual(["222"]);
  });

  it("reports history persistence failures for unmapped roster edits", async () => {
    save.mockRejectedValueOnce(new Error("disk failure"));
    await expect(
      syncPayoutExport({ id: "unmapped-guild" } as never, "thread", {
        contents: ["new roster"],
        userIds: ["222"],
      }),
    ).resolves.toContain(
      "Payout export history could not be saved: disk failure",
    );
    expect(readPayoutSpreadsheet).not.toHaveBeenCalled();
  });

  it("synchronizes the configured development worksheet in the same spreadsheet", async () => {
    const spreadsheet = grid();
    spreadsheet.sheets![0]!.properties!.title = "DevTestSheet";
    spreadsheet.sheets![1]!.data![0]!.rowData![2]!.values![1]!.userEnteredValue =
      {
        formulaValue:
          "=IFERROR(VLOOKUP($A3,'DevTestSheet'!$C$10:$Z$100,8,FALSE),0)",
      };
    readPayoutSpreadsheet.mockResolvedValueOnce(spreadsheet);
    const developmentGuild = { ...guild(), id: "1115484031455346718" };
    expect(
      await syncPayoutExport(developmentGuild as never, "thread"),
    ).toContain("Google Sheets updated: DevTestSheet");
    expect(readPayoutSpreadsheet).toHaveBeenCalledWith("DevTestSheet");
    expect(writePayoutSpreadsheet).toHaveBeenCalledTimes(1);
  });

  it.each([
    "History file could not be read",
    "Invalid history JSON",
    "The export history is missing",
    "The export history is ambiguous",
  ])("warns about stale history when resolution fails: %s", async (message) => {
    historyResolutionError = new Error(message);

    const notice = await syncPayoutExport(guild() as never, "thread", {
      contents: ["edited roster"],
      userIds: ["222"],
    });

    expect(notice).toContain(
      `Payout export history could not be resolved: ${message}`,
    );
    expect(notice).toContain("Currently Vending list may be stale");
    expect(notice).toContain("contact an administrator");
    expect(notice).toContain("Google Sheets was not confirmed updated");
    expect(notice).toContain("Please update Google Sheets manually");
    expect(entry.contents).toEqual(["old"]);
    expect(save).not.toHaveBeenCalled();
    expect(readPayoutSpreadsheet).not.toHaveBeenCalled();
    expect(writePayoutSpreadsheet).not.toHaveBeenCalled();
  });

  it("does not report stale history for a Sheets failure after persisting the roster", async () => {
    readPayoutSpreadsheet.mockRejectedValueOnce(
      new Error("Sheets unavailable"),
    );

    const notice = await syncPayoutExport(guild() as never, "thread", {
      contents: ["edited roster"],
      userIds: ["111"],
    });

    expect(notice).toContain("Google Sheets was not confirmed updated");
    expect(notice).not.toContain("Currently Vending list may be stale");
    expect(notice).not.toContain("Payout export history could not be");
    expect(entry.contents).toEqual(["edited roster"]);
    expect(save).toHaveBeenCalled();
    expect(writePayoutSpreadsheet).not.toHaveBeenCalled();
  });

  it("reports mapped history save failures with the stale-history warning", async () => {
    entry.sheetsSync!.status = "synced";
    save.mockRejectedValueOnce(new Error("disk failure"));

    const notice = await syncPayoutExport(guild() as never, "thread", {
      contents: ["edited roster"],
      userIds: ["111"],
    });

    expect(notice).toContain(
      "Payout export history could not be saved: disk failure",
    );
    expect(notice).toContain("Currently Vending list may be stale");
    expect(notice).toContain("contact an administrator");
    expect(notice).toContain("Google Sheets was not confirmed updated");
    expect(notice).toContain("Please update Google Sheets manually");
    expect(readPayoutSpreadsheet).not.toHaveBeenCalled();
    expect(writePayoutSpreadsheet).not.toHaveBeenCalled();
  });

  it("keeps the previous synced roster while applying a roster edit", async () => {
    entry.sheetsSync!.status = "synced";
    const spreadsheet = grid(true);
    const combinedRows = spreadsheet.sheets![1]!.data![0]!.rowData!;
    combinedRows[2]!.values![1] = {
      userEnteredValue: {
        formulaValue:
          "=IFERROR(VLOOKUP($A3,'FSN 2026'!$C$10:$Z$100,8,FALSE),0)",
      },
    };
    readPayoutSpreadsheet.mockResolvedValueOnce(spreadsheet);

    await syncPayoutExport(guild() as never, "thread", {
      contents: ["updated roster"],
      userIds: ["111", "222"],
    });

    expect(entry.sheetsSync?.syncedParticipantCount).toBe(2);
    expect(entry.sheetsSync?.syncedMembers).toEqual([
      {
        userId: "111",
        displayName: "Alice",
        discordTag: "alice",
      },
      {
        userId: "222",
        displayName: "Bob",
        discordTag: "bob",
      },
    ]);
    expect(JSON.stringify(writePayoutSpreadsheet.mock.calls[0]?.[0])).toContain(
      "=(G$6-G$8)/2",
    );
  });

  it("uses the legacy Discord tag when resolving participant rows", async () => {
    entry.sheetsSync!.members = undefined;
    entry.sheetsSync!.mode = "roster";
    entry.sheetsSync!.status = "pending";
    const spreadsheet = grid(true);
    const sheetRows = spreadsheet.sheets![0]!.data![0]!.rowData!;
    sheetRows[9]!.values![2] = {
      userEnteredValue: { stringValue: "@alice#1234" },
    };
    const combinedRows = spreadsheet.sheets![1]!.data![0]!.rowData!;
    combinedRows[2]!.values![0] = {
      userEnteredValue: { stringValue: "@alice#1234" },
    };
    readPayoutSpreadsheet.mockResolvedValueOnce(spreadsheet);

    await syncPayoutExport(guild(true) as never, "thread");

    expect(entry.sheetsSync?.members).toEqual([
      { userId: "111", displayName: "Alice", discordTag: "alice#1234" },
    ]);
    expect(writePayoutSpreadsheet).toHaveBeenCalled();
  });

  it("accepts an uncertain previous write matching the pending roster", async () => {
    const spreadsheet = grid(true);
    const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
    rows[9]!.values![6] = buildPendingShareCell(6, 2);
    rows[10]!.values![0] = { userEnteredValue: { stringValue: "Bob" } };
    rows[10]!.values![2] = { userEnteredValue: { stringValue: "@bob" } };
    rows[10]!.values![6] = buildPendingShareCell(6, 2);
    const combinedRows = spreadsheet.sheets![1]!.data![0]!.rowData!;
    combinedRows[2]!.values![1] = {
      userEnteredValue: {
        formulaValue:
          "=IFERROR(VLOOKUP($A3,'FSN 2026'!$C$10:$Z$100,8,FALSE),0)",
      },
    };
    entry.sheetsSync = {
      ...snapshot(),
      mode: "roster",
      status: "pending",
      userIds: ["111", "222"],
      members: [
        { userId: "111", displayName: "Alice", discordTag: "alice" },
        { userId: "222", displayName: "Bob", discordTag: "bob" },
      ],
      syncedParticipantCount: 1,
      syncedMembers: [
        { userId: "111", displayName: "Alice", discordTag: "alice" },
      ],
      previousPendingRoster: {
        userIds: ["111"],
        members: [{ userId: "111", displayName: "Alice", discordTag: "alice" }],
      },
    };
    readPayoutSpreadsheet.mockResolvedValueOnce(spreadsheet);

    await syncPayoutExport(guild() as never, "thread");

    expect(entry.sheetsSync?.status).toBe("synced");
    expect(entry.sheetsSync?.syncedParticipantCount).toBe(2);
  });

  it("persists success and makes repeated exports a no-op", async () => {
    const first = await queuePayoutSheetOperation(() =>
      syncPayoutExport(guild() as never, "thread"),
    );
    expect(first).toBe(
      "Google Sheets updated: FSN 2026 (**ET 29/10**).\nNote: Cell formulas are defaults. Please review and adjust them if needed.",
    );
    expect(entry.sheetsSync?.status).toBe("synced");
    expect(entry.sheetsSync?.syncedParticipantCount).toBe(1);
    expect(entry.sheetsSync?.syncedMembers).toEqual(entry.sheetsSync?.members);
    expect(await syncPayoutExport(guild() as never, "thread")).toContain(
      "already synchronized",
    );
    expect(writePayoutSpreadsheet).toHaveBeenCalledTimes(1);
  });

  it("edits the starter after Sheets succeeds and persists it without changing continuations", async () => {
    entry.contents = [originalStarter, "continuation"];
    await syncPayoutExport(guild() as never, "thread");
    const content =
      "Roster\n*Your Time: <t:123:F>*\nGoogle Sheets: FSN 2026 (**ET 29/10**)\n-# Export ID: one";
    expect(editStarter).toHaveBeenCalledWith({
      content,
      allowedMentions: { parse: [] },
    });
    expect(entry.contents).toEqual([content, "continuation"]);
    expect(writePayoutSpreadsheet.mock.invocationCallOrder[0]).toBeLessThan(
      editStarter.mock.invocationCallOrder[0]!,
    );
  });

  it("retries a failed starter edit without rewriting already synchronized Sheets", async () => {
    editStarter.mockRejectedValueOnce(new Error("Missing Permissions"));
    const result = await syncPayoutExport(guild() as never, "thread");
    expect(result).toContain("Google Sheets updated");
    expect(result).toContain("first post could not be updated");
    expect(result).not.toContain("Please update Google Sheets manually");
    expect(entry.sheetsSync?.status).toBe("synced");
    await syncPayoutExport(guild() as never, "thread");
    expect(editStarter).toHaveBeenCalledTimes(2);
    expect(writePayoutSpreadsheet).toHaveBeenCalledTimes(1);
  });

  it("does not edit a starter that already contains the destination", async () => {
    const content =
      "Roster\n*Your Time: <t:123:F>*\nGoogle Sheets: FSN 2026 (**ET 29/10**)\n-# Export ID: one";
    fetchStarterMessage.mockResolvedValueOnce({ content, edit: editStarter });
    await syncPayoutExport(guild() as never, "thread");
    expect(editStarter).not.toHaveBeenCalled();
  });

  it("reports write failures without rejecting or discarding retry input", async () => {
    writePayoutSpreadsheet.mockRejectedValueOnce(
      Object.assign(new Error("denied"), { code: 403 }),
    );
    expect(await syncPayoutExport(guild() as never, "thread")).toContain(
      "Please update Google Sheets manually",
    );
    expect(entry.sheetsSync?.status).toBe("pending");
    expect(entry.sheetsSync?.title).toBe("ET 29/10");
    expect(editStarter).not.toHaveBeenCalled();
  });

  it("looks up the marker after an uncertain write instead of inserting twice", async () => {
    writePayoutSpreadsheet.mockRejectedValueOnce(
      Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
    );
    await syncPayoutExport(guild() as never, "thread");
    readPayoutSpreadsheet.mockResolvedValueOnce(grid(true));
    expect(await syncPayoutExport(guild() as never, "thread")).toContain(
      "Google Sheets updated",
    );
    expect(writePayoutSpreadsheet).toHaveBeenCalledTimes(1);
  });

  it("never creates a guessed column for a legacy export", async () => {
    entry.sheetsSync = undefined;
    const result = await syncPayoutExport(guild() as never, "thread", {
      starterContent: "updated vendor",
      vendor: "none",
    });
    expect(result).toContain("older export");
    expect(result).toContain("manually");
    expect(entry.contents).toEqual(["updated vendor"]);
    expect(writePayoutSpreadsheet).not.toHaveBeenCalled();
  });

  it("updates vendor without touching existing monetary inputs", async () => {
    entry.sheetsSync!.status = "synced";
    entry.sheetsSync!.createIfMissing = false;
    readPayoutSpreadsheet.mockResolvedValueOnce(grid(true));
    await syncPayoutExport(guild() as never, "thread", {
      starterContent: "new",
      vendor: "n/a",
    });
    expect(writePayoutSpreadsheet.mock.calls[0]![0]).toHaveLength(1);
    expect(
      writePayoutSpreadsheet.mock.calls[0]![0][0]!.updateCells?.start?.rowIndex,
    ).toBe(6);
    expect(entry.sheetsSync?.vendor).toBe("n/a");
  });

  it("retains failed roster work when a later vendor edit arrives", async () => {
    entry.sheetsSync!.status = "synced";
    readPayoutSpreadsheet.mockResolvedValue(grid(true));
    writePayoutSpreadsheet.mockRejectedValueOnce(
      new Error("temporary failure"),
    );
    await syncPayoutExport(guild() as never, "thread", {
      contents: ["new roster"],
      userIds: ["111"],
    });
    expect(entry.sheetsSync?.mode).toBe("roster");
    expect(entry.sheetsSync?.status).toBe("pending");
    await syncPayoutExport(guild() as never, "thread", {
      starterContent: "new vendor",
      vendor: "none",
    });
    expect(
      writePayoutSpreadsheet.mock.calls[1]![0].some(
        (request) => request.updateCells?.start?.rowIndex === 9,
      ),
    ).toBe(true);
    expect(
      writePayoutSpreadsheet.mock.calls[1]![0].find(
        (request) => request.updateCells?.start?.rowIndex === 6,
      )?.updateCells?.rows?.[0]?.values?.[0]?.userEnteredValue?.stringValue,
    ).toBe("none");
    expect(entry.contents?.[0]).toContain(
      "Google Sheets: FSN 2026 (**ET 29/10**)",
    );
  });

  it("does not sync an incompletely delivered Discord roster on a duplicate export", async () => {
    entry.sheetsSync!.deliveryIncomplete = true;
    expect(await syncPayoutExport(guild() as never, "thread")).toContain(
      "delivery was incomplete",
    );
    expect(writePayoutSpreadsheet).not.toHaveBeenCalled();
  });

  it("keeps spreadsheet operations ordered and continues after an error", async () => {
    const order: number[] = [];
    const first = queuePayoutSheetOperation(async () => {
      order.push(1);
      throw new Error("failed");
    });
    const second = queuePayoutSheetOperation(async () => {
      order.push(2);
    });
    await expect(first).rejects.toThrow("failed");
    await second;
    expect(order).toEqual([1, 2]);
  });
});
