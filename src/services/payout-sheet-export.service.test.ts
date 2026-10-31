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
  jest.fn<() => Promise<sheets_v4.Schema$Spreadsheet>>();
const writePayoutSpreadsheet =
  jest.fn<(requests: sheets_v4.Schema$Request[]) => Promise<void>>();
jest.unstable_mockModule("./google-sheets.service.js", () => ({
  readPayoutSpreadsheet,
  writePayoutSpreadsheet,
}));
let entry: SignupExportHistoryEntry;
const save = jest.fn<() => Promise<void>>();
jest.unstable_mockModule("./signup-export.service.js", () => ({
  withSignupExportHistory: async (
    _guildId: string,
    _threadId: string,
    action: (
      current: SignupExportHistoryEntry,
      persist: () => Promise<void>,
    ) => Promise<string>,
  ) => action(entry, save),
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
                values: [{ userEnteredValue: { stringValue: "@alice" } }],
              },
            ],
          },
        ],
      },
    ],
  };
};
const guild = () => ({
  id: "499171225046876170",
  members: {
    fetch: jest.fn(async (_options: unknown) => ({
      displayName: "Alice",
      user: { username: "alice" },
    })),
  },
});

describe("payout Sheets synchronization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    entry = {
      threadId: "thread",
      contents: ["old"],
      sheetsSync: snapshot(),
    };
    readPayoutSpreadsheet.mockResolvedValue(grid());
    writePayoutSpreadsheet.mockResolvedValue();
    save.mockResolvedValue();
  });

  it("skips all Sheets work for an unmapped guild", async () => {
    expect(
      await syncPayoutExport({ id: "unmapped-guild" } as never, "thread"),
    ).toBe("");
    expect(readPayoutSpreadsheet).not.toHaveBeenCalled();
  });

  it("synchronizes the configured development worksheet in the same spreadsheet", async () => {
    const spreadsheet = grid();
    spreadsheet.sheets![0]!.properties!.title = "DevTestSheet";
    readPayoutSpreadsheet.mockResolvedValueOnce(spreadsheet);
    const developmentGuild = { ...guild(), id: "1115484031455346718" };
    expect(
      await syncPayoutExport(developmentGuild as never, "thread"),
    ).toContain("Google Sheets updated: DevTestSheet");
    expect(readPayoutSpreadsheet).toHaveBeenCalledWith("DevTestSheet");
    expect(writePayoutSpreadsheet).toHaveBeenCalledTimes(1);
  });

  it("persists success and makes repeated exports a no-op", async () => {
    const first = await queuePayoutSheetOperation(() =>
      syncPayoutExport(guild() as never, "thread"),
    );
    expect(first).toBe(
      "Google Sheets updated: FSN 2026 (ET 29/10).\nNote: Cell formulas are defaults. Please review and adjust them if needed.",
    );
    expect(entry.sheetsSync?.status).toBe("synced");
    expect(await syncPayoutExport(guild() as never, "thread")).toContain(
      "already synchronized",
    );
    expect(writePayoutSpreadsheet).toHaveBeenCalledTimes(1);
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
    expect(entry.contents).toEqual(["new vendor"]);
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
