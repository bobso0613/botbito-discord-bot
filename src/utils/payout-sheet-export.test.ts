import { describe, expect, it } from "@jest/globals";
import type { sheets_v4 } from "googleapis";
import type {
  PayoutSheetMember,
  PayoutSheetSnapshot,
} from "../types/payout-sheet-export.js";
import {
  buildPendingShareCell,
  findUnclaimedColumn,
  payoutColumnLabel,
  validatePendingShareCell,
  planPayoutSheetExport,
  PAYOUT_EXPORT_METADATA_KEY,
} from "./payout-sheet-export.js";

const text = (value: string): sheets_v4.Schema$CellData => ({
  userEnteredValue: { stringValue: value },
});
const formula = (value: string): sheets_v4.Schema$CellData => ({
  userEnteredValue: { formulaValue: value },
});

export const buildSpreadsheet = (): sheets_v4.Schema$Spreadsheet => {
  const rows = Array.from(
    { length: 14 },
    (): sheets_v4.Schema$RowData => ({ values: [] }),
  );
  rows[4]!.values![7] = text("Unclaimed");
  rows[4]!.values![6] = text("Previous run");
  rows[8]!.values = [text("Name"), text("Active?"), text("Discord")];
  rows[9]!.values![0] = text("Alice");
  rows[9]!.values![2] = text("@alice");
  rows[9]!.values![5] = buildPendingShareCell(5, 3);
  rows[9]!.values![9] = formula("=SUM(F10:G10)");
  return {
    sheets: [
      {
        properties: {
          sheetId: 1,
          title: "FSN 2026",
          gridProperties: { rowCount: 14, columnCount: 12 },
        },
        data: [{ rowData: rows }],
      },
      {
        properties: {
          sheetId: 2,
          title: "Combined",
          gridProperties: { rowCount: 10, columnCount: 5 },
        },
        data: [
          {
            rowData: [
              {
                values: [text(""), text("499171225046876170")],
              },
              {
                values: [
                  text("Discord"),
                  text("Pending"),
                  text("Share Ready"),
                  text("Distributed"),
                ],
              },
              {
                values: [
                  text("@alice"),
                  formula(
                    "=IFERROR(VLOOKUP($A3,'FSN 2026'!$C$10:$Z$100,8,FALSE),0)",
                  ),
                ],
              },
            ],
          },
        ],
      },
    ],
  };
};

export const buildSnapshot = (): PayoutSheetSnapshot & {
  members: PayoutSheetMember[];
} => ({
  identifier: "export-one",
  title: "Wolfchev 29/10",
  vendor: "Sadboys 2013",
  userIds: ["111"],
  members: [{ userId: "111", displayName: "Alice", discordTag: "alice" }],
  mode: "create",
  status: "pending",
  createIfMissing: true,
});

const linkColumn = (
  spreadsheet: sheets_v4.Schema$Spreadsheet,
  snapshot: PayoutSheetSnapshot,
) => {
  spreadsheet.sheets![0]!.developerMetadata = [
    {
      metadataKey: PAYOUT_EXPORT_METADATA_KEY,
      metadataValue: snapshot.identifier,
      location: {
        dimensionRange: {
          sheetId: 1,
          dimension: "COLUMNS",
          startIndex: 6,
          endIndex: 7,
        },
      },
    },
  ];
};

describe("payout sheet export planning", () => {
  it.each([
    undefined,
    "=123",
    "=IFERROR(VLOOKUP($A3,'Other'!$C$10:$Z$100,8,FALSE),0)",
  ])(
    "rejects an existing Combined member without a valid mapped lookup: %s",
    (lookup) => {
      const spreadsheet = buildSpreadsheet();
      spreadsheet.sheets![1]!.data![0]!.rowData![2]!.values![1] = lookup
        ? formula(lookup)
        : {};
      expect(() =>
        planPayoutSheetExport(spreadsheet, "FSN 2026", buildSnapshot()),
      ).toThrow("Combined template formulas");
    },
  );

  it.each([{}, { userEnteredValue: { numberValue: 0 } }])(
    "rejects an append with no Share Total formula template: %j",
    (cell) => {
      const spreadsheet = buildSpreadsheet();
      const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
      rows[8]!.values![9] = text("Share Total");
      rows[9]!.values![9] = cell;
      const snapshot = buildSnapshot();
      snapshot.userIds.push("222");
      snapshot.members.push({
        userId: "222",
        displayName: "Bob",
        discordTag: "bob",
      });
      expect(() =>
        planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
      ).toThrow("Share Total formula template is missing");
    },
  );

  it("refuses to erase an extra purple share outside every known roster", () => {
    const spreadsheet = buildSpreadsheet();
    const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
    rows[9]!.values![6] = buildPendingShareCell(6, 1);
    rows[10]!.values![2] = text("@bob");
    rows[10]!.values![6] = buildPendingShareCell(6, 1);
    const snapshot = buildSnapshot();
    snapshot.mode = "roster";
    snapshot.syncedParticipantCount = 1;
    snapshot.syncedMembers = [...snapshot.members];
    linkColumn(spreadsheet, snapshot);
    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
    ).toThrow("manually changed shares");
  });

  it("migrates retained tags in place across guild, mirror, and Combined identities", () => {
    const spreadsheet = buildSpreadsheet();
    const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
    rows[9]!.values![6] = buildPendingShareCell(6, 1);
    rows[8]!.values![10] = text("Discord");
    rows[9]!.values![10] = text("@alice");
    const otherSheet = structuredClone(spreadsheet.sheets![0]!);
    otherSheet.properties!.sheetId = 3;
    otherSheet.properties!.title = "Ghostz 2026";
    spreadsheet.sheets!.push(otherSheet);
    const snapshot = buildSnapshot();
    snapshot.mode = "roster";
    snapshot.syncedParticipantCount = 1;
    snapshot.syncedMembers = [...snapshot.members];
    snapshot.members = [
      { userId: "111", displayName: "Alice", discordTag: "renamed" },
    ];
    linkColumn(spreadsheet, snapshot);

    const requests = planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot);
    const renames = requests.filter(
      (request) =>
        request.updateCells?.rows?.[0]?.values?.[0]?.userEnteredValue
          ?.stringValue === "@renamed",
    );
    expect(renames.map((request) => request.updateCells?.start)).toEqual([
      { sheetId: 1, rowIndex: 9, columnIndex: 2 },
      { sheetId: 1, rowIndex: 9, columnIndex: 10 },
      { sheetId: 2, rowIndex: 2, columnIndex: 0 },
      { sheetId: 3, rowIndex: 9, columnIndex: 2 },
      { sheetId: 3, rowIndex: 9, columnIndex: 10 },
    ]);
    expect(requests.some((request) => request.copyPaste)).toBe(false);
    expect(
      requests.filter((request) => request.updateCells?.start?.sheetId === 3),
    ).toHaveLength(2);
    expect(rows[9]!.values![2]).toEqual(text("@alice"));
    expect(rows[9]!.values![5]).toEqual(buildPendingShareCell(5, 3));
  });

  it("rejects a rename when the destination tag already has financial history", () => {
    const spreadsheet = buildSpreadsheet();
    const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
    rows[9]!.values![6] = buildPendingShareCell(6, 1);
    rows[10]!.values![2] = text("@renamed");
    const snapshot = buildSnapshot();
    snapshot.mode = "roster";
    snapshot.syncedParticipantCount = 1;
    snapshot.syncedMembers = [...snapshot.members];
    snapshot.members = [
      { userId: "111", displayName: "Alice", discordTag: "renamed" },
    ];
    linkColumn(spreadsheet, snapshot);
    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
    ).toThrow("split across rows");
  });

  it("rejects a destination-only identity on another worksheet before migrating Combined", () => {
    const spreadsheet = buildSpreadsheet();
    const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
    rows[9]!.values![6] = buildPendingShareCell(6, 1);
    const other = structuredClone(spreadsheet.sheets![0]!);
    other.properties!.sheetId = 3;
    other.properties!.title = "Ghostz 2026";
    other.data![0]!.rowData![9]!.values![2] = text("@renamed");
    spreadsheet.sheets!.push(other);
    const snapshot = buildSnapshot();
    snapshot.mode = "roster";
    snapshot.syncedParticipantCount = 1;
    snapshot.syncedMembers = [...snapshot.members];
    snapshot.members = [
      { userId: "111", displayName: "Alice", discordTag: "renamed" },
    ];
    linkColumn(spreadsheet, snapshot);
    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
    ).toThrow("another worksheet identity");
  });

  it("reconciles a committed tag migration without adding new lifetime rows", () => {
    const spreadsheet = buildSpreadsheet();
    const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
    rows[9]!.values![2] = text("@renamed");
    rows[9]!.values![6] = buildPendingShareCell(6, 1);
    spreadsheet.sheets![1]!.data![0]!.rowData![2]!.values![0] =
      text("@renamed");
    const other = structuredClone(spreadsheet.sheets![0]!);
    other.properties!.sheetId = 3;
    other.properties!.title = "Ghostz 2026";
    spreadsheet.sheets!.push(other);
    const snapshot = buildSnapshot();
    snapshot.mode = "roster";
    snapshot.syncedParticipantCount = 1;
    snapshot.syncedMembers = [...snapshot.members];
    snapshot.members = [
      { userId: "111", displayName: "Alice", discordTag: "renamed" },
    ];
    linkColumn(spreadsheet, snapshot);
    const requests = planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot);
    expect(
      requests.some((request) => request.copyPaste || request.insertDimension),
    ).toBe(false);
  });

  it("refuses a migration when Combined references an unreadable historical worksheet", () => {
    const spreadsheet = buildSpreadsheet();
    spreadsheet.sheets![0]!.data![0]!.rowData![9]!.values![6] =
      buildPendingShareCell(6, 1);
    spreadsheet.sheets![1]!.data![0]!.rowData![2]!.values![2] = formula(
      "=IFERROR(VLOOKUP($A3,'Missing'!$C$10:$Z$100,8,FALSE),0)",
    );
    const snapshot = buildSnapshot();
    snapshot.mode = "roster";
    snapshot.syncedParticipantCount = 1;
    snapshot.syncedMembers = [...snapshot.members];
    snapshot.members = [
      { userId: "111", displayName: "Alice", discordTag: "renamed" },
    ];
    linkColumn(spreadsheet, snapshot);
    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
    ).toThrow("lookup sources cannot be safely migrated");
  });

  it("requires the Combined Discord header in A2 rather than A1", () => {
    const spreadsheet = buildSpreadsheet();
    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", buildSnapshot()),
    ).not.toThrow();
    const rows = spreadsheet.sheets![1]!.data![0]!.rowData!;
    rows[0]!.values![0] = text("Discord");
    rows[1]!.values![0] = text("");
    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", buildSnapshot()),
    ).toThrow("Expected the Combined Discord tag header in A2.");
  });

  it("finds the dynamic boundary beyond ZZ without consuming blank run columns", () => {
    const cells = Array.from({ length: 705 }, () => ({}));
    cells[703] = { userEnteredValue: { stringValue: "Unclaimed" } };
    expect(findUnclaimedColumn(cells)).toBe(703);
    expect(payoutColumnLabel(703)).toBe("AAB");
  });

  it("rejects missing and ambiguous boundaries", () => {
    expect(() => findUnclaimedColumn([])).toThrow("Unclaimed");
    const cells = Array.from({ length: 8 }, () => ({}));
    cells[6] = cells[7] = {
      userEnteredValue: { stringValue: "Unclaimed" },
    };
    expect(() => findUnclaimedColumn(cells)).toThrow("Unclaimed");
  });

  it("builds a purple formula using unique participant count", () => {
    const cell = buildPendingShareCell(91, 9);
    expect(cell.userEnteredValue?.formulaValue).toBe("=(CN$6-CN$8)/9");
    expect(() => validatePendingShareCell(cell, 91, 9)).not.toThrow();
    expect(() => validatePendingShareCell(cell, 90, 9)).toThrow(
      "manually changed",
    );
    expect(() => validatePendingShareCell(cell, 91, 8)).toThrow(
      "manually changed",
    );
    expect(() => buildPendingShareCell(5, 0)).toThrow("participant");
  });

  it("refuses distributed colors and manual value overrides", () => {
    const pending = buildPendingShareCell(5, 9);
    expect(() =>
      validatePendingShareCell(
        {
          ...pending,
          effectiveFormat: {
            backgroundColor: { red: 0, green: 1, blue: 0 },
          },
        },
        5,
        9,
      ),
    ).toThrow("processed");
    expect(() =>
      validatePendingShareCell(
        {
          ...pending,
          userEnteredValue: { numberValue: 123 },
        },
        5,
        9,
      ),
    ).toThrow("manually changed");
  });

  it("rejects processed formatting when a share cell has been cleared", () => {
    expect(() =>
      validatePendingShareCell(
        { effectiveFormat: { backgroundColor: { green: 1 } } },
        5,
        1,
      ),
    ).toThrow("processed");
  });

  it("uses the next blank run column and adds one empty column directly to its right", () => {
    const spreadsheet = buildSpreadsheet();
    const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
    rows[4]!.values![6] = {};
    const requests = planPayoutSheetExport(
      spreadsheet,
      "FSN 2026",
      buildSnapshot(),
    );
    expect(requests.filter((request) => request.insertDimension)).toEqual([
      {
        insertDimension: {
          range: {
            sheetId: 1,
            dimension: "COLUMNS",
            startIndex: 7,
            endIndex: 8,
          },
          inheritFromBefore: true,
        },
      },
    ]);
    expect(
      requests.find((request) => request.createDeveloperMetadata)
        ?.createDeveloperMetadata?.developerMetadata?.location?.dimensionRange,
    ).toEqual({
      sheetId: 1,
      dimension: "COLUMNS",
      startIndex: 6,
      endIndex: 7,
    });
    expect(
      requests.find(
        (request) =>
          request.updateCells?.start?.rowIndex === 9 &&
          request.updateCells.start.columnIndex === 6,
      )?.updateCells?.rows?.[0]?.values?.[0]?.userEnteredValue?.formulaValue,
    ).toBe("=(G$6-G$8)/1");
    expect(
      requests.some((request) => request.updateCells?.start?.columnIndex === 7),
    ).toBe(false);
    expect(requests).toContainEqual({
      copyPaste: {
        source: {
          sheetId: 1,
          startColumnIndex: 6,
          endColumnIndex: 7,
          startRowIndex: 8,
          endRowIndex: 9,
        },
        destination: {
          sheetId: 1,
          startColumnIndex: 7,
          endColumnIndex: 8,
          startRowIndex: 8,
          endRowIndex: 9,
        },
        pasteType: "PASTE_FORMAT",
      },
    });
    const resetIndex = requests.findIndex(
      (request) => request.repeatCell?.range?.startColumnIndex === 7,
    );
    const copyIndex = requests.findIndex(
      (request) => request.copyPaste?.destination?.startColumnIndex === 7,
    );
    expect(resetIndex).toBeGreaterThan(-1);
    expect(copyIndex).toBeGreaterThan(resetIndex);
    expect(requests[resetIndex]!.repeatCell).toEqual({
      range: {
        sheetId: 1,
        startColumnIndex: 7,
        endColumnIndex: 8,
        startRowIndex: 4,
        endRowIndex: 14,
      },
      cell: {
        userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } },
      },
      fields:
        "userEnteredFormat.backgroundColor,userEnteredFormat.backgroundColorStyle",
    });
  });

  it("adds one empty column for each split part and does not add more on retry", () => {
    const spreadsheet = buildSpreadsheet();
    const sheet = spreadsheet.sheets![0]!;
    const rows = sheet.data![0]!.rowData!;
    rows[4]!.values![6] = {};
    const snapshots = [
      buildSnapshot(),
      { ...buildSnapshot(), identifier: "export-two", title: "EC 29/10" },
    ];
    let spareColumns = 0;
    for (const snapshot of snapshots) {
      const requests = planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot);
      expect(
        requests.filter((request) => request.insertDimension),
      ).toHaveLength(1);
      for (const request of requests) {
        const inserted = request.insertDimension?.range;
        if (inserted) {
          spareColumns += 1;
          for (const row of rows) {
            row.values ??= [];
            while (row.values.length < inserted.startIndex!)
              row.values.push({});
            row.values.splice(inserted.startIndex!, 0, {});
          }
          sheet.properties!.gridProperties!.columnCount! += 1;
        }
        const marker = request.createDeveloperMetadata?.developerMetadata;
        if (marker) {
          sheet.developerMetadata ??= [];
          sheet.developerMetadata.push(marker);
        }
        const update = request.updateCells;
        if (update?.start?.sheetId === 1) {
          const row = rows[update.start.rowIndex!]!;
          row.values ??= [];
          row.values[update.start.columnIndex!] = update.rows![0]!.values![0]!;
        }
      }
    }
    expect(spareColumns).toBe(2);
    expect(rows[4]!.values![6]?.userEnteredValue?.stringValue).toBe(
      snapshots[0]!.title,
    );
    expect(rows[4]!.values![7]?.userEnteredValue?.stringValue).toBe("EC 29/10");
    expect(rows[4]!.values![8]?.userEnteredValue).toBeUndefined();
    expect(
      planPayoutSheetExport(spreadsheet, "FSN 2026", snapshots[0]!),
    ).toEqual([]);
    expect(
      planPayoutSheetExport(spreadsheet, "FSN 2026", snapshots[1]!),
    ).toEqual([]);
  });

  it("places the new run beside existing runs even when Unclaimed is several columns away", () => {
    const spreadsheet = buildSpreadsheet();
    const sheet = spreadsheet.sheets![0]!;
    sheet.properties!.gridProperties!.columnCount = 24;
    const rows = sheet.data![0]!.rowData!;
    for (let column = 5; column <= 14; column += 1) {
      rows[4]!.values![column] = text(`Run ${column}`);
    }
    rows[4]!.values![18] = text("Unclaimed");
    const requests = planPayoutSheetExport(
      spreadsheet,
      "FSN 2026",
      buildSnapshot(),
    );
    expect(
      requests.find((request) => request.updateCells?.start?.rowIndex === 4)
        ?.updateCells?.start?.columnIndex,
    ).toBe(15);
    expect(requests.filter((request) => request.insertDimension)).toHaveLength(
      1,
    );
    expect(
      requests.find((request) => request.insertDimension)?.insertDimension
        ?.range?.startIndex,
    ).toBe(16);
  });

  it.each(["formula", "note", "metadata"])(
    "does not reuse an apparently empty run column containing %s",
    (kind) => {
      const spreadsheet = buildSpreadsheet();
      const sheet = spreadsheet.sheets![0]!;
      const rows = sheet.data![0]!.rowData!;
      rows[4]!.values![6] = {};
      if (kind === "formula") rows[10]!.values![6] = formula("=0");
      if (kind === "note") rows[4]!.values![6] = { note: "Reserved run" };
      if (kind === "metadata")
        linkColumn(spreadsheet, {
          ...buildSnapshot(),
          identifier: "another-export",
        });
      expect(
        planPayoutSheetExport(spreadsheet, "FSN 2026", buildSnapshot()).some(
          (request) => request.insertDimension,
        ),
      ).toBe(true);
    },
  );

  it("inserts before Unclaimed when no empty run column exists, with numeric zero inputs and a stable marker", () => {
    const snapshot = buildSnapshot();
    snapshot.vendor = "=DANGEROUS()";
    const requests = planPayoutSheetExport(
      buildSpreadsheet(),
      "FSN 2026",
      snapshot,
    );
    expect(requests).toContainEqual({
      insertDimension: {
        range: {
          sheetId: 1,
          dimension: "COLUMNS",
          startIndex: 7,
          endIndex: 8,
        },
        inheritFromBefore: true,
      },
    });
    expect(
      requests
        .filter((request) => request.insertDimension)
        .map((request) => request.insertDimension?.range?.startIndex),
    ).toEqual([7, 8]);
    expect(
      requests.find((request) => request.createDeveloperMetadata)
        ?.createDeveloperMetadata?.developerMetadata?.metadataValue,
    ).toBe("export-one");
    const cells = requests.flatMap((request) =>
      request.updateCells ? [request.updateCells] : [],
    );
    expect(cells).toContainEqual(
      expect.objectContaining({
        start: { sheetId: 1, rowIndex: 6, columnIndex: 7 },
        rows: [{ values: [text("=DANGEROUS()")] }],
      }),
    );
    expect(
      cells.find((entry) => entry.start?.rowIndex === 5)?.rows?.[0]?.values?.[0]
        ?.userEnteredValue?.numberValue,
    ).toBe(0);
    expect(
      cells.find(
        (entry) => entry.start?.rowIndex === 9 && entry.start.columnIndex === 7,
      )?.rows?.[0]?.values?.[0]?.userEnteredValue?.formulaValue,
    ).toBe("=(H$6-H$8)/1");
    expect(
      cells.find(
        (entry) =>
          entry.start?.rowIndex === 9 && entry.start.columnIndex === 11,
      )?.rows?.[0]?.values?.[0]?.userEnteredValue?.formulaValue,
    ).toBe("=SUM(F10:I10)");
  });

  it.each([
    '=SUM(INDIRECT("F10:G10"))',
    '=SUM(INDIRECT("$F$10:$G$10"))',
    '=SUM(INDIRECT("prefix F10:G10 suffix"))',
  ])("rejects text-based summary ranges: %s", (summary) => {
    const spreadsheet = buildSpreadsheet();
    spreadsheet.sheets![0]!.data![0]!.rowData![9]!.values![9] =
      formula(summary);
    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", buildSnapshot()),
    ).toThrow("text-based range");
  });

  it("expands lowercase summary formulas when inserting a run", () => {
    const spreadsheet = buildSpreadsheet();
    spreadsheet.sheets![0]!.data![0]!.rowData![9]!.values![9] =
      formula("=sum(f10:g10)");
    const requests = planPayoutSheetExport(
      spreadsheet,
      "FSN 2026",
      buildSnapshot(),
    );
    expect(
      requests.find(
        (request) =>
          request.updateCells?.start?.rowIndex === 9 &&
          request.updateCells.start.columnIndex === 11,
      )?.updateCells?.rows?.[0]?.values?.[0]?.userEnteredValue?.formulaValue,
    ).toBe("=sum(f10:I10)");
  });

  it("handles long quoted summary text without treating it as a range", () => {
    const spreadsheet = buildSpreadsheet();
    spreadsheet.sheets![0]!.data![0]!.rowData![9]!.values![9] = formula(
      `=LEN("${"A".repeat(20_000)}")`,
    );
    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", buildSnapshot()),
    ).not.toThrow();
  });

  it("adds missing identities without copying past run shares or numeric balances", () => {
    const snapshot = buildSnapshot();
    snapshot.userIds.push("222");
    snapshot.members!.push({
      userId: "222",
      displayName: "Bob",
      discordTag: "bob",
    });
    const requests = planPayoutSheetExport(
      buildSpreadsheet(),
      "FSN 2026",
      snapshot,
    );
    const copies = requests.flatMap((request) =>
      request.copyPaste ? [request.copyPaste] : [],
    );
    expect(copies).toContainEqual(
      expect.objectContaining({
        pasteType: "PASTE_FORMULA",
        source: expect.objectContaining({
          sheetId: 2,
          startRowIndex: 2,
          startColumnIndex: 1,
        }),
        destination: expect.objectContaining({ startRowIndex: 3 }),
      }),
    );
    expect(copies).not.toContainEqual(
      expect.objectContaining({ pasteType: "PASTE_NORMAL" }),
    );
    expect(
      copies
        .filter(
          (copy) =>
            copy.pasteType === "PASTE_FORMULA" && copy.source?.sheetId === 1,
        )
        .every((copy) => copy.source!.startColumnIndex! > 7),
    ).toBe(true);
    expect(JSON.stringify(requests)).toContain("@bob");
    expect(JSON.stringify(requests)).toContain("=(H$6-H$8)/2");
    expect(JSON.stringify(requests)).toContain("=SUM(F11:I11)");
    expect(
      requests.some(
        (request) => request.repeatCell?.range?.startColumnIndex === 5,
      ),
    ).toBe(true);
  });

  it.each([
    ["Ghostz 2026", 120],
    ["FSN 2026", 100],
    ["DevTestSheet", 19],
  ] as const)(
    "allows safely rebased Share Total formulas at dynamic positions in %s",
    (worksheet, column) => {
      const spreadsheet = buildSpreadsheet();
      const sheet = spreadsheet.sheets![0]!;
      sheet.properties!.title = worksheet;
      sheet.properties!.gridProperties!.columnCount = column + 1;
      spreadsheet.sheets![1]!.data![0]!.rowData![2]!.values![1] = formula(
        `=IFERROR(VLOOKUP($A3,'${worksheet}'!$C$10:$Z$100,8,FALSE),0)`,
      );
      const rows = sheet.data![0]!.rowData!;
      rows[8]!.values![column] = text("Share Total");
      rows[9]!.values![column] = formula("=SUM(F10:G10)");
      rows[10]!.values![column] = formula("=SUM(F11:G11)");
      const snapshot = buildSnapshot();
      snapshot.userIds.push("222");
      snapshot.members!.push({
        userId: "222",
        displayName: "Altbob",
        discordTag: "altbob",
      });
      const requests = planPayoutSheetExport(spreadsheet, worksheet, snapshot);
      expect(requests).toContainEqual(
        expect.objectContaining({
          updateCells: expect.objectContaining({
            start: { sheetId: 1, rowIndex: 10, columnIndex: 2 },
            rows: [{ values: [text("@altbob")] }],
          }),
        }),
      );
    },
  );

  it.each(["=SUM(F10:G11)", "=SUM(F11:G11)+5", "=SUM(F12:G12)"])(
    "rejects organizer-adjusted Share Total formula %s",
    (adjustment) => {
      const spreadsheet = buildSpreadsheet();
      const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
      rows[8]!.values![9] = text("Share Total");
      rows[9]!.values![9] = formula("=SUM(F10:G10)");
      rows[10]!.values![9] = formula(adjustment);
      const snapshot = buildSnapshot();
      snapshot.userIds.push("222");
      snapshot.members!.push({
        userId: "222",
        displayName: "Bob",
        discordTag: "bob",
      });
      expect(() =>
        planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
      ).toThrow("next participant row contains existing data");
    },
  );

  it.each([12, 24])(
    "ignores mirrored Name and Discord columns at dynamic position %s",
    (nameColumn) => {
      const spreadsheet = buildSpreadsheet();
      const sheet = spreadsheet.sheets![0]!;
      sheet.properties!.gridProperties!.columnCount = nameColumn + 2;
      const rows = sheet.data![0]!.rowData!;
      rows[8]!.values![nameColumn] = text("Name");
      rows[8]!.values![nameColumn + 1] = text("Discord");
      rows[10]!.values![nameColumn] = formula("=A11");
      rows[10]!.values![nameColumn + 1] = text("@mirrored");
      const snapshot = buildSnapshot();
      snapshot.userIds.push("222");
      snapshot.members!.push({
        userId: "222",
        displayName: "Altbob",
        discordTag: "altbob",
      });
      const requests = planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot);
      expect(requests).toContainEqual(
        expect.objectContaining({
          updateCells: expect.objectContaining({
            start: { sheetId: 1, rowIndex: 10, columnIndex: nameColumn },
            rows: [{ values: [text("Altbob")] }],
          }),
        }),
      );
      expect(requests).toContainEqual(
        expect.objectContaining({
          updateCells: expect.objectContaining({
            start: {
              sheetId: 1,
              rowIndex: 10,
              columnIndex: nameColumn + 1,
            },
            rows: [{ values: [text("@altbob")] }],
          }),
        }),
      );
      rows[10]!.values![0] = text("Existing member");
      expect(() =>
        planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
      ).toThrow("next participant row contains existing data");
    },
  );

  it.each(["other formula", "share total value", "name", "historical share"])(
    "still blocks occupied append rows containing %s",
    (kind) => {
      const spreadsheet = buildSpreadsheet();
      const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
      rows[8]!.values![9] = text("Share Total");
      rows[10]!.values![9] = formula("=SUM(F11:G11)");
      if (kind === "other formula") rows[10]!.values![10] = formula("=1+2");
      if (kind === "share total value")
        rows[10]!.values![9] = { userEnteredValue: { numberValue: 0 } };
      if (kind === "name") rows[10]!.values![0] = text("Existing member");
      if (kind === "historical share")
        rows[10]!.values![5] = buildPendingShareCell(5, 3);
      const snapshot = buildSnapshot();
      snapshot.userIds.push("222");
      snapshot.members!.push({
        userId: "222",
        displayName: "Altbob",
        discordTag: "altbob",
      });
      expect(() =>
        planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
      ).toThrow("next participant row contains existing data");
    },
  );

  it.each([
    ["unsafe templates", "=123+456", "template formulas"],
    [
      "textual A3 references instead of row-relative lookups",
      '=IF("A3"="A3",VLOOKUP("alice",\'FSN 2026\'!$C$10:$Z$100,8,FALSE),0)',
      "template formulas",
    ],
    [
      "lookup ranges that miss the appended roster row",
      "=IFERROR(VLOOKUP($A3,'FSN 2026'!$C$10:$Z$10,8,FALSE),0)",
      "cover the participant rows",
    ],
    [
      "relative row bounds that shift when copied",
      "=IFERROR(VLOOKUP($A3,'FSN 2026'!C10:Z100,8,FALSE),0)",
      "template formulas",
    ],
  ])("rejects Combined %s", (_description, lookup, expectedError) => {
    const spreadsheet = buildSpreadsheet();
    spreadsheet.sheets![1]!.data![0]!.rowData![2]!.values![1] = formula(lookup);
    const snapshot = buildSnapshot();
    snapshot.userIds = ["222"];
    snapshot.members = [
      { userId: "222", displayName: "Bob", discordTag: "bob" },
    ];
    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
    ).toThrow(expectedError);
  });

  it("copies live guild SUM and color summaries for appended members", () => {
    const spreadsheet = buildSpreadsheet();
    const sheet = spreadsheet.sheets![0]!;
    sheet.properties!.gridProperties!.columnCount = 16;
    const rows = sheet.data![0]!.rowData!;
    rows[8]!.values![9] = text("Share Total");
    rows[9]!.values![9] = formula("=sum(D10:I10) - H10");
    for (const [offset, color] of ["#8e7cc3", "#ffd966", "#00ff00"].entries()) {
      rows[9]!.values![10 + offset] = formula(
        `=sumByColor(ADDRESS(ROW($E10),COLUMN($E10))&\":\"&ADDRESS(ROW($I10),COLUMN($I10)), \"${color}\")${offset === 2 ? " -H10" : ""}`,
      );
    }
    rows[8]!.values![13] = text("Name");
    rows[8]!.values![14] = text("Discord");
    rows[9]!.values![13] = formula("=A10");
    rows[9]!.values![14] = formula("=C10");
    rows[10]!.values![9] = formula("=sum(D11:I11) - H11");
    const snapshot = buildSnapshot();
    snapshot.userIds.push("222");
    snapshot.members.push({
      userId: "222",
      displayName: "Bob",
      discordTag: "bob",
    });
    const requests = planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot);
    for (const column of [9, 10, 11, 12]) {
      expect(requests).toContainEqual({
        copyPaste: {
          source: {
            sheetId: 1,
            startRowIndex: 9,
            endRowIndex: 10,
            startColumnIndex: column,
            endColumnIndex: column + 1,
          },
          destination: {
            sheetId: 1,
            startRowIndex: 10,
            endRowIndex: 11,
            startColumnIndex: column,
            endColumnIndex: column + 1,
          },
          pasteType: "PASTE_FORMULA",
        },
      });
    }
  });

  it.each([
    "=$J$10",
    "=SUM(D$10:I$10)-H10",
    "=SUM(D10:I10)-H$10",
    "=SUM(D10:I10)-G10",
    "=SUM(D10:Z10)-H10",
    '=sumByColor(ADDRESS(ROW($E$10),COLUMN($E$10))&":"&ADDRESS(ROW($I10),COLUMN($I10)), "#8e7cc3")',
    '=sumByColor(ADDRESS(ROW($E10),COLUMN($E11))&":"&ADDRESS(ROW($I10),COLUMN($I10)), "#8e7cc3")',
    '=sumByColor(ADDRESS(ROW($E10),COLUMN($E10))&":"&ADDRESS(ROW($I10),COLUMN($I10)), "#ffffff")',
  ])(
    "rejects unsafe guild template formula %s before copying it",
    (summary) => {
      const spreadsheet = buildSpreadsheet();
      const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
      rows[9]!.values![10] = formula(summary);
      const snapshot = buildSnapshot();
      snapshot.userIds.push("222");
      snapshot.members!.push({
        userId: "222",
        displayName: "Bob",
        discordTag: "bob",
      });
      expect(() =>
        planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
      ).toThrow("row-relative SUM formulas");
    },
  );

  it("updates Combined VLOOKUP indices and ranges when run and spacer columns are inserted", () => {
    const requests = planPayoutSheetExport(
      buildSpreadsheet(),
      "FSN 2026",
      buildSnapshot(),
    );
    expect(requests).toContainEqual(
      expect.objectContaining({
        updateCells: expect.objectContaining({
          start: { sheetId: 2, rowIndex: 2, columnIndex: 1 },
          rows: [
            {
              values: [
                formula(
                  "=IFERROR(VLOOKUP($A3,'FSN 2026'!$C$10:$AB$100,10,FALSE),0)",
                ),
              ],
            },
          ],
        }),
      }),
    );
  });

  it.each([
    "=IFERROR(VLOOKUP($A3,DevTestSheet!$C$10:$Z$100,8,FALSE),0)",
    "=IFERROR(VLOOKUP($A3,DevTestSheet!$C$10:$Z$100,8,0),0)",
    "= IFERROR( VLOOKUP( $A3, DevTestSheet!$C$10:$Z$100, 8, FALSE ) , 0 ) ",
    "=IFERROR(VLOOKUP($A3,DevTestSheet!   $C$10 : $Z$100,8,FALSE),0)",
  ])("adjusts valid Combined lookup syntax: %s", (lookup) => {
    const spreadsheet = buildSpreadsheet();
    spreadsheet.sheets![0]!.properties!.title = "DevTestSheet";
    spreadsheet.sheets![1]!.data![0]!.rowData![2]!.values![1] = formula(lookup);
    const requests = planPayoutSheetExport(
      spreadsheet,
      "DevTestSheet",
      buildSnapshot(),
    );
    expect(JSON.stringify(requests)).toContain(
      "DevTestSheet!$C$10:$AB$100,10,FALSE)",
    );
  });

  it.each([
    "=INDEX('FSN 2026 Archive'!A:Z,1,1)",
    '=IF(TRUE,"FSN 2026!A1",0)',
    `=IF(TRUE,"${"A".repeat(20_000)}",0)`,
  ])(
    "ignores Combined formulas without an exact worksheet reference: %#",
    (lookup) => {
      const spreadsheet = buildSpreadsheet();
      spreadsheet.sheets![1]!.data![0]!.rowData![2]!.values![2] =
        formula(lookup);
      expect(() =>
        planPayoutSheetExport(spreadsheet, "FSN 2026", buildSnapshot()),
      ).not.toThrow();
    },
  );

  it("preserves escaped apostrophes in worksheet references", () => {
    const spreadsheet = buildSpreadsheet();
    spreadsheet.sheets![0]!.properties!.title = "Guild's 2026";
    spreadsheet.sheets![1]!.data![0]!.rowData![2]!.values![1] = formula(
      "=IFERROR(VLOOKUP($A3,'Guild''s 2026'!$C$10:$Z$100,8,FALSE),0)",
    );
    const requests = planPayoutSheetExport(
      spreadsheet,
      "Guild's 2026",
      buildSnapshot(),
    );
    expect(JSON.stringify(requests)).toContain(
      "'Guild''s 2026'!$C$10:$AB$100,10,FALSE",
    );
  });

  it("accepts live Combined XLOOKUPs against mirrored Discord columns without rewriting them", () => {
    const spreadsheet = buildSpreadsheet();
    const sheet = spreadsheet.sheets![0]!;
    sheet.properties!.title = "Ghostz 2026";
    sheet.properties!.gridProperties!.columnCount = 126;
    sheet.data![0]!.rowData![8]!.values![125] = text("Discord");
    const combinedRow = spreadsheet.sheets![1]!.data![0]!.rowData![2]!;
    combinedRow.values = [
      text("@alice"),
      ...["DR", "DS", "DT", "DQ"].map((column) =>
        formula(
          `=XLOOKUP(A3,'Ghostz 2026'!DV:DV, 'Ghostz 2026'!${column}:${column}, 0)`,
        ),
      ),
    ];
    const snapshot = buildSnapshot();
    snapshot.userIds.push("222");
    snapshot.members!.push({
      userId: "222",
      displayName: "Bob",
      discordTag: "bob",
    });
    const requests = planPayoutSheetExport(
      spreadsheet,
      "Ghostz 2026",
      snapshot,
    );
    expect(requests.some((request) => request.insertDimension)).toBe(true);
    expect(
      requests.filter(
        (request) =>
          request.copyPaste?.source?.sheetId === 2 &&
          request.copyPaste.pasteType === "PASTE_FORMULA",
      ),
    ).toHaveLength(4);
    expect(
      requests.some(
        (request) =>
          request.updateCells?.start?.sheetId === 2 &&
          request.updateCells.start.columnIndex !== 0,
      ),
    ).toBe(false);
  });

  it.each([
    "=XLOOKUP(A3,'FSN 2026'!A:A,'FSN 2026'!J:J,0)",
    "=XLOOKUP(A3,'FSN 2026'!C:C,'Other'!J:J,0)",
    "=XLOOKUP($A$3,'FSN 2026'!C:C,'FSN 2026'!J:J,0)",
    "=XLOOKUP(A3,'FSN 2026'!$C$10:$C$10,'FSN 2026'!$J$10:$J$10,0)",
  ])("rejects unsafe Combined XLOOKUPs: %s", (lookup) => {
    const spreadsheet = buildSpreadsheet();
    spreadsheet.sheets![1]!.data![0]!.rowData![2]!.values![1] = formula(lookup);
    const snapshot = buildSnapshot();
    snapshot.userIds.push("222");
    snapshot.members!.push({
      userId: "222",
      displayName: "Bob",
      discordTag: "bob",
    });
    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
    ).toThrow();
  });

  it("rejects unsupported Combined lookups before inserting columns", () => {
    const spreadsheet = buildSpreadsheet();
    spreadsheet.sheets![1]!.data![0]!.rowData![2]!.values![1] = formula(
      "=INDEX('FSN 2026'!$C$10:$Z$100,MATCH($A3,'FSN 2026'!$C$10:$C$100,0),8)",
    );
    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", buildSnapshot()),
    ).toThrow("Combined template formulas");
  });

  it("rejects absolute tag references and incorrect roster headers", () => {
    const spreadsheet = buildSpreadsheet();
    const snapshot = buildSnapshot();
    snapshot.userIds = ["222"];
    snapshot.members = [
      { userId: "222", displayName: "Bob", discordTag: "bob" },
    ];
    spreadsheet.sheets![1]!.data![0]!.rowData![2]!.values![1] = formula(
      "=VLOOKUP($A$3,'FSN 2026'!C:Z,8,FALSE)",
    );
    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
    ).toThrow("template formulas");
    spreadsheet.sheets![0]!.data![0]!.rowData![8]!.values = [];
    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
    ).toThrow("roster headers");
  });

  it("does not insert again after a successful but unconfirmed write", () => {
    const spreadsheet = buildSpreadsheet();
    const snapshot = buildSnapshot();
    linkColumn(spreadsheet, snapshot);
    expect(planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot)).toEqual(
      [],
    );
  });

  it("updates only the linked vendor cell and never guesses a legacy column", () => {
    const spreadsheet = buildSpreadsheet();
    const snapshot = buildSnapshot();
    snapshot.mode = "vendor";
    snapshot.createIfMissing = false;
    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
    ).toThrow("older export");
    linkColumn(spreadsheet, snapshot);
    const requests = planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.updateCells?.start).toEqual({
      sheetId: 1,
      rowIndex: 6,
      columnIndex: 6,
    });
  });

  it("preserves monetary inputs on pending roster edits and rejects processed runs", () => {
    const spreadsheet = buildSpreadsheet();
    const snapshot = buildSnapshot();
    snapshot.mode = "roster";
    linkColumn(spreadsheet, snapshot);
    spreadsheet.sheets![0]!.data![0]!.rowData![9]!.values![6] =
      buildPendingShareCell(6, 1);
    const requests = planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot);
    expect(requests.some((request) => request.insertDimension)).toBe(false);
    expect(
      requests.some((request) =>
        [5, 7].includes(request.updateCells?.start?.rowIndex ?? -1),
      ),
    ).toBe(false);
    spreadsheet.sheets![0]!.data![0]!.rowData![9]!.values![6]!.userEnteredValue =
      { formulaValue: "=(G$6-G$8)/2" };
    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
    ).toThrow("manually changed");
    spreadsheet.sheets![0]!.data![0]!.rowData![9]!.values![6] =
      buildPendingShareCell(6, 1);
    spreadsheet.sheets![0]!.data![0]!.rowData![9]!.values![6]!.effectiveFormat =
      { backgroundColor: { green: 1 } };
    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
    ).toThrow("processed");
  });

  it("validates edits against the last synced participant count", () => {
    const spreadsheet = buildSpreadsheet();
    const snapshot = buildSnapshot();
    snapshot.mode = "roster";
    linkColumn(spreadsheet, snapshot);
    spreadsheet.sheets![0]!.data![0]!.rowData![9]!.values![6] =
      buildPendingShareCell(6, 1);
    snapshot.userIds.push("222");
    snapshot.members!.push({
      userId: "222",
      displayName: "Bob",
      discordTag: "bob",
    });
    snapshot.syncedParticipantCount = 1;
    snapshot.syncedMembers = [snapshot.members[0]!];

    const requests = planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot);

    expect(JSON.stringify(requests)).toContain("=(G$6-G$8)/2");
  });

  it("accepts a matching target roster after an uncertain previous write", () => {
    const spreadsheet = buildSpreadsheet();
    const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
    rows[9]!.values![6] = buildPendingShareCell(6, 2);
    rows[10]!.values![0] = text("Bob");
    rows[10]!.values![2] = text("@bob");
    rows[10]!.values![6] = buildPendingShareCell(6, 2);
    const snapshot = buildSnapshot();
    snapshot.mode = "roster";
    linkColumn(spreadsheet, snapshot);
    snapshot.userIds.push("222");
    snapshot.members!.push({
      userId: "222",
      displayName: "Bob",
      discordTag: "bob",
    });
    snapshot.syncedParticipantCount = 1;
    snapshot.syncedMembers = [snapshot.members[0]!];
    snapshot.previousPendingRoster = {
      userIds: ["111"],
      members: [snapshot.members[0]!],
    };

    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
    ).not.toThrow();
  });

  it("rejects a cleared cell for a previously synced participant", () => {
    const spreadsheet = buildSpreadsheet();
    const snapshot = buildSnapshot();
    snapshot.mode = "roster";
    linkColumn(spreadsheet, snapshot);
    snapshot.syncedParticipantCount = 1;
    snapshot.syncedMembers = [...snapshot.members!];
    spreadsheet.sheets![0]!.data![0]!.rowData![9]!.values![6] = {
      userEnteredFormat: {
        backgroundColor: { red: 1, green: 1, blue: 1 },
      },
    };

    expect(() =>
      planPayoutSheetExport(spreadsheet, "FSN 2026", snapshot),
    ).toThrow("manually changed");
  });
});
