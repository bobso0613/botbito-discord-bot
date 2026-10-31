import type { sheets_v4 } from "googleapis";
import type {
  PayoutSheetMember,
  PayoutSheetSnapshot,
  PayoutSheetFormula,
  PayoutSheetGrid as Grid,
  PayoutSheetRequest as Request,
} from "../types/payout-sheet-export.js";
import {
  EMPTY_SHARE_COLOR,
  PAYOUT_BACKGROUND_FIELDS,
  PAYOUT_EXPORT_METADATA_KEY,
  PAYOUT_VALUE_AND_BACKGROUND_FIELDS,
  PENDING_SHARE_COLOR,
} from "../constants/payout-sheet-export.js";

export {
  PAYOUT_EXPORT_METADATA_KEY,
  PENDING_SHARE_COLOR,
} from "../constants/payout-sheet-export.js";

/** Converts a zero-based column index to an A1 column label. */
export const payoutColumnLabel = (index: number): string => {
  let number = index + 1;
  let label = "";
  while (number > 0) {
    number -= 1;
    label = String.fromCodePoint(65 + (number % 26)) + label;
    number = Math.floor(number / 26);
  }
  return label;
};

/** Reads evaluated or literal text without treating numeric financial cells as identities. */
export const payoutCellText = (cell?: sheets_v4.Schema$CellData): string =>
  String(
    cell?.effectiveValue?.stringValue ??
      cell?.userEnteredValue?.stringValue ??
      "",
  );

/**
 * Locates the unique Unclaimed boundary in the row-5 headers.
 * @param cells Header cells in absolute column order.
 * @returns Zero-based boundary after the run area beginning at F.
 * @throws When the header is missing, duplicated, or outside the expected layout.
 */
export const findUnclaimedColumn = (
  cells: sheets_v4.Schema$CellData[],
): number => {
  const matches = cells.flatMap((cell, index) =>
    payoutCellText(cell).trim().toLowerCase() === "unclaimed" ? [index] : [],
  );
  if (matches.length !== 1 || matches[0]! <= 5) {
    throw new Error(
      "Expected exactly one Unclaimed header after column F in row 5.",
    );
  }
  return matches[0]!;
};

/**
 * Builds the default purple share formula using fixed total/reimbursement rows.
 * @param column Zero-based run column.
 * @param participants Positive number of unique Discord participants, not roster slots.
 * @returns A cell whose default formula should be reviewed for run-specific adjustments.
 */
export const buildPendingShareCell = (
  column: number,
  participants: number,
): sheets_v4.Schema$CellData => {
  if (!Number.isInteger(participants) || participants <= 0) {
    throw new Error("The roster must have at least one unique participant.");
  }
  const label = payoutColumnLabel(column);
  return {
    userEnteredValue: {
      formulaValue: `=(${label}$6-${label}$8)/${participants}`,
    },
    userEnteredFormat: { backgroundColor: PENDING_SHARE_COLOR },
  };
};

const hasPendingColor = (cell: sheets_v4.Schema$CellData): boolean => {
  const color =
    cell.effectiveFormat?.backgroundColorStyle?.rgbColor ??
    cell.effectiveFormat?.backgroundColor ??
    cell.userEnteredFormat?.backgroundColor;
  return Boolean(
    color &&
    ["red", "green", "blue"].every(
      (component) =>
        Math.abs(
          ((color[component as keyof typeof color] as number) ?? 0) -
            PENDING_SHARE_COLOR[component as keyof typeof PENDING_SHARE_COLOR],
        ) < 0.01,
    ),
  );
};

/**
 * Refuses processed colors, numeric overrides, and unknown financial cell states.
 * @param cell Existing run cell, including effective formatting after conditional rules.
 * @throws When an occupied cell is not a purple default share formula.
 */
export const validatePendingShareCell = (
  cell: sheets_v4.Schema$CellData,
  column: number,
  participants: number,
): void => {
  const value = cell.userEnteredValue;
  if (!value || Object.keys(value).length === 0) return;
  if (
    !hasPendingColor(cell) ||
    value.formulaValue !==
      buildPendingShareCell(column, participants).userEnteredValue?.formulaValue
  ) {
    throw new Error(
      "This run has processed or manually changed shares; update Google Sheets manually.",
    );
  }
};

const normalizeTag = (tag: string): string =>
  tag.trim().replace(/^@/, "").toLowerCase();

const sheetGrid = (sheet: sheets_v4.Schema$Sheet): Grid => {
  const rows: Grid = [];
  for (const data of sheet.data ?? []) {
    for (const [offset, row] of (data.rowData ?? []).entries()) {
      const index = (data.startRow ?? 0) + offset;
      rows[index] ??= [];
      for (const [column, cell] of (row.values ?? []).entries()) {
        rows[index]![(data.startColumn ?? 0) + column] = cell ?? {};
      }
    }
  }
  return rows;
};

const cellUpdate = (
  sheetId: number,
  rowIndex: number,
  columnIndex: number,
  cell: sheets_v4.Schema$CellData,
  fields = "userEnteredValue",
): Request => ({
  updateCells: {
    start: { sheetId, rowIndex, columnIndex },
    rows: [{ values: [cell] }],
    fields,
  },
});

const textCell = (text: string): sheets_v4.Schema$CellData => ({
  userEnteredValue: { stringValue: text },
});

const identityRows = (
  grid: Grid,
  column: number,
  start: number,
): Map<string, number> => {
  const rows = new Map<string, number>();
  grid.forEach((cells, index) => {
    const tag = normalizeTag(payoutCellText(cells[column]));
    if (index < start || !tag) return;
    if (rows.has(tag))
      throw new Error(`Duplicate Discord tag @${tag} in the spreadsheet.`);
    rows.set(tag, index);
  });
  return rows;
};

const ensureCapacity = (
  sheet: sheets_v4.Schema$Sheet,
  lastRow: number,
): Request[] => {
  const count = sheet.properties?.gridProperties?.rowCount ?? 0;
  return lastRow < count
    ? []
    : [
        {
          appendDimension: {
            sheetId: sheet.properties!.sheetId!,
            dimension: "ROWS",
            length: lastRow + 1 - count,
          },
        },
      ];
};

const copyRow = (
  sheetId: number,
  sourceRow: number,
  destinationRow: number,
  startColumnIndex: number,
  endColumnIndex: number,
  pasteType: string,
): Request => ({
  copyPaste: {
    source: {
      sheetId,
      startRowIndex: sourceRow,
      endRowIndex: sourceRow + 1,
      startColumnIndex,
      endColumnIndex,
    },
    destination: {
      sheetId,
      startRowIndex: destinationRow,
      endRowIndex: destinationRow + 1,
      startColumnIndex,
      endColumnIndex,
    },
    pasteType,
  },
});

const validateFormulaTemplate = (
  formulas: PayoutSheetFormula[],
  tagColumn: number,
  template: number,
  worksheet?: string,
  requiredGuildRow?: number,
): void => {
  if (tagColumn !== 0) return;
  if (!worksheet || !formulas.length) {
    throw new Error(
      "Combined template formulas must look up this row's Discord tag; update Google Sheets manually.",
    );
  }
  let foundWorksheetLookup = false;
  for (const { formula } of formulas) {
    const lookup = parseCombinedLookup(formula, template + 1);
    const targetsWorksheet =
      lookup?.worksheet.toLowerCase() === worksheet.toLowerCase();
    if (
      !lookup ||
      (targetsWorksheet && lookup.startRow != null && lookup.startRow > 10) ||
      (targetsWorksheet &&
        requiredGuildRow != null &&
        lookup.endRow != null &&
        lookup.endRow < requiredGuildRow)
    ) {
      throw new Error(
        "Combined template formulas must look up this row's Discord tag and cover the participant rows; update Google Sheets manually.",
      );
    }
    if (targetsWorksheet) foundWorksheetLookup = true;
  }
  if (!foundWorksheetLookup) {
    throw new Error(
      "Combined template formulas must include a lookup for this worksheet; update Google Sheets manually.",
    );
  }
};

type CombinedRangeBoundary = {
  column: number;
  absoluteColumn: string;
  absoluteRow: string;
  row?: number;
};

type CombinedLookupRange = {
  startColumn: number;
  endColumn: number;
  worksheet: string;
  startRow?: number;
  endRow?: number;
  start: CombinedRangeBoundary;
  end: CombinedRangeBoundary;
  sheetReference: string;
};

type CombinedVlookup = CombinedLookupRange & {
  kind: "vlookup";
  index: number;
  tagReference: string;
  wrapped: boolean;
};

type CombinedXlookup = {
  kind: "xlookup";
  worksheet: string;
  startRow?: number;
  endRow?: number;
  lookupRange: CombinedLookupRange;
};

type CombinedLookup = CombinedVlookup | CombinedXlookup;

const columnIndex = (label: string): number =>
  [...label.toUpperCase()].reduce(
    (value, character) => value * 26 + character.codePointAt(0)! - 64,
    0,
  ) - 1;

const parseCombinedRangeBoundary = (
  reference: string,
): CombinedRangeBoundary | undefined => {
  const match = /^(\$?)([A-Z]+)(\$?)(\d+)?$/i.exec(reference.trim());
  if (!match || (match[4] != null && match[3] !== "$")) return undefined;
  return {
    column: columnIndex(match[2]!),
    absoluteColumn: match[1]!,
    absoluteRow: match[3]!,
    ...(match[4] ? { row: Number(match[4]) } : {}),
  };
};

const parseCombinedLookupRange = (
  reference: string,
): CombinedLookupRange | undefined => {
  const match = /^('(?:[^']|'')+'|[A-Z_][\w.]*)!\s*([^:]+):([^:]+)$/i.exec(
    reference.trim(),
  );
  if (!match) return undefined;
  const start = parseCombinedRangeBoundary(match[2]!);
  const end = parseCombinedRangeBoundary(match[3]!);
  if (!start || !end || end.column < start.column) return undefined;
  return {
    startColumn: start.column,
    endColumn: end.column,
    worksheet: unquoteWorksheet(match[1]!),
    startRow: start.row,
    endRow: end.row,
    start,
    end,
    sheetReference: match[1]!,
  };
};

const parseCombinedXlookup = (
  expression: string,
  formulaRow: number,
): CombinedXlookup | undefined => {
  const match = /^XLOOKUP\(\s*\$?A(\d+)\s*,([^,]+),([^,]+),\s*0\s*\)$/i.exec(
    expression,
  );
  if (!match || Number(match[1]) !== formulaRow) return undefined;
  const lookup = parseCombinedLookupRange(match[2]!);
  const result = parseCombinedLookupRange(match[3]!);
  if (
    !lookup ||
    lookup.worksheet.toLowerCase() !== result?.worksheet.toLowerCase() ||
    lookup.startColumn !== lookup.endColumn ||
    result.startColumn !== result.endColumn ||
    lookup.startRow !== result.startRow ||
    lookup.endRow !== result.endRow
  ) {
    return undefined;
  }
  return {
    kind: "xlookup",
    worksheet: lookup.worksheet,
    startRow: lookup.startRow,
    endRow: lookup.endRow,
    lookupRange: lookup,
  };
};

const parseCombinedLookup = (
  formula: string,
  formulaRow: number,
  worksheet?: string,
): CombinedLookup | undefined => {
  if (!formula.startsWith("=")) return undefined;
  const expression = formula.slice(1).trim();
  const wrapper = /^IFERROR\(\s*([\s\S]*),\s*0\s*\)$/i.exec(expression);
  const unwrapped = (wrapper?.[1] ?? expression).trim();
  const xlookup = parseCombinedXlookup(unwrapped, formulaRow);
  if (xlookup) {
    return worksheet == null ||
      xlookup.worksheet.toLowerCase() === worksheet.toLowerCase()
      ? xlookup
      : undefined;
  }
  const match =
    /^VLOOKUP\(\s*(\$?A)(\d+)\s*,([\s\S]*),\s*(\d+)\s*,\s*(?:FALSE|0)\s*\)$/i.exec(
      unwrapped,
    );
  if (!match || Number(match[2]) !== formulaRow) return undefined;
  const range = parseCombinedLookupRange(match[3]!);
  const index = Number(match[4]);
  if (
    range?.startColumn !== 2 ||
    (worksheet != null &&
      range.worksheet.toLowerCase() !== worksheet.toLowerCase()) ||
    !Number.isInteger(index) ||
    index < 1 ||
    index > range.endColumn - range.startColumn + 1
  ) {
    return undefined;
  }
  return {
    ...range,
    kind: "vlookup",
    index,
    tagReference: `${match[1]}${match[2]}`,
    wrapped: wrapper != null,
  };
};

const unquoteWorksheet = (reference: string): string =>
  reference.startsWith("'")
    ? reference.slice(1, -1).replaceAll("''", "'")
    : reference;

const formulaReferencesWorksheet = (
  formula: string,
  worksheet: string,
): boolean => {
  const references = /('(?:[^']|'')+'|[A-Z_][\w.]*)!/gi;
  let reference: RegExpExecArray | null;
  while ((reference = references.exec(formula)) !== null) {
    if (
      unquoteWorksheet(reference[1]!).toLowerCase() === worksheet.toLowerCase()
    )
      return true;
  }
  return false;
};

const rewriteCombinedLookup = (
  lookup: CombinedVlookup,
  insertions: number[],
): string => {
  let startColumn = lookup.startColumn;
  let endColumn = lookup.endColumn;
  let targetColumn = startColumn + lookup.index - 1;
  for (const insertion of insertions) {
    if (startColumn >= insertion) startColumn += 1;
    if (endColumn >= insertion) endColumn += 1;
    if (targetColumn >= insertion) targetColumn += 1;
  }
  const index = targetColumn - startColumn + 1;
  const start = `${lookup.start.absoluteColumn}${payoutColumnLabel(startColumn)}${lookup.start.absoluteRow}${lookup.startRow ?? ""}`;
  const end = `${lookup.end.absoluteColumn}${payoutColumnLabel(endColumn)}${lookup.end.absoluteRow}${lookup.endRow ?? ""}`;
  const formula = `VLOOKUP(${lookup.tagReference},${lookup.sheetReference}!${start}:${end},${index},FALSE)`;
  return lookup.wrapped ? `=IFERROR(${formula},0)` : `=${formula}`;
};

const combinedLookupAdjustments = (
  sheet: sheets_v4.Schema$Sheet,
  grid: Grid,
  worksheet: string,
  requiredGuildRow: number,
  insertions: number[],
  guildGrid: Grid,
): Request[] => {
  const requests: Request[] = [];
  grid.forEach((cells, row) => {
    cells.forEach((cell, column) => {
      const formula = cell.userEnteredValue?.formulaValue;
      if (!formula || !formulaReferencesWorksheet(formula, worksheet)) return;
      const lookup = parseCombinedLookup(formula, row + 1, worksheet);
      if (
        !lookup ||
        (lookup.startRow != null && lookup.startRow > 10) ||
        (lookup.endRow != null && lookup.endRow < requiredGuildRow)
      ) {
        throw new Error(
          "A Combined lookup formula is unsupported or does not cover the participant rows; update Google Sheets manually.",
        );
      }
      if (lookup.kind === "xlookup") {
        const header = payoutCellText(
          guildGrid[8]?.[lookup.lookupRange.startColumn],
        )
          .trim()
          .toLowerCase();
        if (header !== "discord") {
          throw new Error(
            `Combined ${payoutColumnLabel(column)}${row + 1} must look up a Discord column in the payout worksheet.`,
          );
        }
        return;
      }
      if (insertions.length) {
        requests.push(
          cellUpdate(sheet.properties!.sheetId!, row, column, {
            userEnteredValue: {
              formulaValue: rewriteCombinedLookup(lookup, insertions),
            },
          }),
        );
      }
    });
  });
  return requests;
};

const createAppendRowGuard = (
  headers: sheets_v4.Schema$CellData[],
  tagColumn: number,
  boundary: number,
  template: sheets_v4.Schema$CellData[],
  row: number,
) => {
  const shareTotalColumn =
    tagColumn === 2
      ? headers.findIndex(
          (cell, column) =>
            column > boundary &&
            payoutCellText(cell).trim().toLowerCase() === "share total",
        )
      : -1;
  const mirroredIdentityColumns = new Set(
    tagColumn === 2
      ? headers.flatMap((cell, column) =>
          column > boundary &&
          ["name", "discord"].includes(
            payoutCellText(cell).trim().toLowerCase(),
          )
            ? [column]
            : [],
        )
      : [],
  );
  return (cell: sheets_v4.Schema$CellData, column: number): boolean => {
    if (!cell.userEnteredValue || mirroredIdentityColumns.has(column)) {
      return false;
    }
    if (column === shareTotalColumn && cell.userEnteredValue.formulaValue) {
      const expected = rebaseSimpleSum(template[column] ?? {}, row)
        .userEnteredValue?.formulaValue;
      if (expected && cell.userEnteredValue.formulaValue === expected) {
        return false;
      }
    }
    return true;
  };
};

const addMembers = (
  sheet: sheets_v4.Schema$Sheet,
  grid: Grid,
  tagColumn: number,
  start: number,
  members: PayoutSheetMember[],
  {
    boundary = 0,
    worksheet,
    requiredGuildRow,
  }: { boundary?: number; worksheet?: string; requiredGuildRow?: number } = {},
): { requests: Request[]; rows: Map<string, number> } => {
  const rows = identityRows(grid, tagColumn, start);
  const missing = members.filter(
    (member) => !rows.has(normalizeTag(member.discordTag)),
  );
  if (!missing.length) return { requests: [], rows };
  const template = Math.max(start - 1, ...rows.values());
  if (template < start)
    throw new Error("No participant formula template row is available.");
  const sheetId = sheet.properties!.sheetId!;
  const width = sheet.properties?.gridProperties?.columnCount ?? 0;
  const formulas = (grid[template] ?? []).flatMap((cell, index) =>
    cell.userEnteredValue?.formulaValue
      ? [{ column: index, formula: cell.userEnteredValue.formulaValue }]
      : [],
  );
  validateFormulaTemplate(
    formulas,
    tagColumn,
    template,
    worksheet,
    requiredGuildRow,
  );
  const requests = ensureCapacity(sheet, template + missing.length);
  missing.forEach((member, offset) => {
    const row = template + offset + 1;
    const containsExistingData = createAppendRowGuard(
      grid[start - 1] ?? [],
      tagColumn,
      boundary,
      grid[template] ?? [],
      row,
    );
    if (grid[row]?.some((cell, column) => containsExistingData(cell, column))) {
      throw new Error(
        "The next participant row contains existing data; update Google Sheets manually.",
      );
    }
    requests.push(copyRow(sheetId, template, row, 0, width, "PASTE_FORMAT"));
    if (tagColumn === 2) {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: row,
            endRowIndex: row + 1,
            startColumnIndex: 5,
            endColumnIndex: boundary,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: EMPTY_SHARE_COLOR,
            },
          },
          fields: PAYOUT_BACKGROUND_FIELDS,
        },
      });
    }
    const copiedFormulas =
      tagColumn === 0
        ? formulas
        : formulas.filter(({ column }) => column > boundary);
    for (const { column } of copiedFormulas) {
      requests.push(
        copyRow(sheetId, template, row, column, column + 1, "PASTE_FORMULA"),
      );
    }
    if (tagColumn === 2) {
      requests.push(
        cellUpdate(sheetId, row, 0, textCell(member.displayName)),
        cellUpdate(sheetId, row, 1, textCell("Y")),
      );
    }
    requests.push(
      cellUpdate(
        sheetId,
        row,
        tagColumn,
        textCell(`@${normalizeTag(member.discordTag)}`),
      ),
    );
    rows.set(normalizeTag(member.discordTag), row);
  });
  return { requests, rows };
};

const managedColumn = (
  sheet: sheets_v4.Schema$Sheet,
  identifier: string,
): number | undefined => {
  const markers = (sheet.developerMetadata ?? []).filter(
    (entry) =>
      entry.metadataKey === PAYOUT_EXPORT_METADATA_KEY &&
      entry.metadataValue === identifier,
  );
  if (markers.length > 1)
    throw new Error(
      "Duplicate Export ID metadata; update Google Sheets manually.",
    );
  if (!markers.length) return undefined;
  const range = markers[0]!.location?.dimensionRange;
  if (
    range?.dimension !== "COLUMNS" ||
    range.sheetId !== sheet.properties?.sheetId ||
    range.startIndex == null ||
    range.endIndex !== range.startIndex + 1
  ) {
    throw new Error("Invalid Export ID column metadata.");
  }
  return range.startIndex;
};

const aggregateAdjustments = (
  sheet: sheets_v4.Schema$Sheet,
  grid: Grid,
  boundary: number,
  addedColumns = 1,
): Request[] => {
  const requests: Request[] = [];
  const previous = payoutColumnLabel(boundary - 1);
  const inserted = payoutColumnLabel(boundary + addedColumns - 1);
  const endingBefore = new RegExp(
    String.raw`(:[$]?)${previous}([$]?\d+)(?!\d)`,
    "g",
  );
  const includesBoundary = new RegExp(
    String.raw`:[$]?${payoutColumnLabel(boundary)}[$]?\d+`,
  );
  grid.forEach((cells, row) => {
    cells.forEach((cell, column) => {
      const formula = cell.userEnteredValue?.formulaValue;
      if (!formula || column <= boundary || row < 9) return;
      if (/"[^"\n]*[A-Z]+\$?\d+:[A-Z]+\$?\d+[^"\n]*"/i.test(formula)) {
        throw new Error(
          "A summary formula uses a text-based range that cannot safely shift; update Google Sheets manually.",
        );
      }
      const looksLikeRunRange = /[$]?F[$]?\d+:/.test(formula);
      if (!looksLikeRunRange) return;
      const updated = formula.replace(endingBefore, `$1${inserted}$2`);
      if (updated === formula && !includesBoundary.test(formula)) {
        throw new Error(
          "An existing summary formula has an unsupported run range; update Google Sheets manually.",
        );
      }
      if (updated !== formula) {
        if (!/^=SUM\(\$?F\$?\d+:\$?[A-Z]+\$?\d+\)$/i.test(formula)) {
          throw new Error(
            "A summary formula needs manual range expansion before inserting a run.",
          );
        }
        requests.push(
          cellUpdate(sheet.properties!.sheetId!, row, column + addedColumns, {
            userEnteredValue: { formulaValue: updated },
          }),
        );
      }
    });
  });
  return requests;
};

const rebaseSimpleSum = (
  cell: sheets_v4.Schema$CellData,
  row: number,
): sheets_v4.Schema$CellData => {
  const formula = cell?.userEnteredValue?.formulaValue ?? "";
  const sum = /^=SUM\((\$?F)(\$?)(\d+):(\$?[A-Z]+)(\$?)(\d+)\)$/i.exec(formula);
  if (!sum) return {};
  const firstRow = sum[2] ? sum[3] : String(row + 1);
  const lastRow = sum[5] ? sum[6] : String(row + 1);
  return {
    userEnteredValue: {
      formulaValue: `=SUM(${sum[1]}${sum[2]}${firstRow}:${sum[4]}${sum[5]}${lastRow})`,
    },
  };
};

const addedSummaryRows = (
  grid: Grid,
  rows: Map<string, number>,
  boundary: number,
): Grid => {
  const original = identityRows(grid, 2, 9);
  const existingRows = new Set(original.values());
  const template = Math.max(9, ...original.values());
  const result = grid.map((cells) => [...cells]);
  for (const row of rows.values()) {
    if (existingRows.has(row)) continue;
    result[row] = (grid[template] ?? []).map((cell, column) =>
      column > boundary ? rebaseSimpleSum(cell, row) : {},
    );
  }
  return result;
};

const nextRunColumn = (
  sheet: sheets_v4.Schema$Sheet,
  grid: Grid,
  boundary: number,
): number => {
  for (let column = 5; column < boundary; column += 1) {
    const reserved = (sheet.developerMetadata ?? []).some((entry) => {
      const range = entry.location?.dimensionRange;
      return (
        range?.dimension === "COLUMNS" &&
        (range.startIndex ?? 0) <= column &&
        (range.endIndex ?? boundary) > column
      );
    });
    const occupied = grid.slice(4).some((row) => {
      const cell = row[column];
      return (
        cell?.note ||
        [cell?.userEnteredValue, cell?.effectiveValue].some(
          (value) => value && Object.keys(value).length > 0,
        )
      );
    });
    if (!reserved && !occupied) return column;
  }
  return boundary;
};

const exportLayout = (
  spreadsheet: sheets_v4.Schema$Spreadsheet,
  worksheet: string,
  snapshot: PayoutSheetSnapshot,
) => {
  const sheet = spreadsheet.sheets?.find(
    (entry) => entry.properties?.title === worksheet,
  );
  const combined = spreadsheet.sheets?.find(
    (entry) => entry.properties?.title === "Combined",
  );
  if (
    sheet?.properties?.sheetId == null ||
    combined?.properties?.sheetId == null
  ) {
    throw new Error("The payout worksheet or Combined worksheet is missing.");
  }
  const sheetId = sheet.properties.sheetId;
  const grid = sheetGrid(sheet);
  if (
    !/discord/i.test(payoutCellText(grid[8]?.[2])) ||
    !/name/i.test(payoutCellText(grid[8]?.[0]))
  ) {
    throw new Error(
      "Expected Name and Discord roster headers in row 9 (columns A and C).",
    );
  }
  if (!/discord/i.test(payoutCellText(sheetGrid(combined)[1]?.[0]))) {
    throw new Error("Expected the Combined Discord tag header in A2.");
  }
  const boundary = findUnclaimedColumn(grid[4] ?? []);
  const existing = managedColumn(sheet, snapshot.identifier);
  if (
    existing == null &&
    snapshot.mode !== "create" &&
    !snapshot.createIfMissing
  ) {
    throw new Error(
      "This older export has no linked Google Sheets column; update Google Sheets manually.",
    );
  }
  const column = existing ?? nextRunColumn(sheet, grid, boundary);
  if (column < 5 || (column >= boundary && existing != null)) {
    throw new Error(
      "The linked run column is outside the expected shares area.",
    );
  }
  return { sheet, combined, sheetId, grid, boundary, existing, column };
};

const validatePendingColumn = (
  grid: Grid,
  column: number,
  participants: number,
): void => {
  for (const row of grid.slice(9)) {
    validatePendingShareCell(row[column] ?? {}, column, participants);
  }
  for (const index of [5, 7]) {
    const header = grid[index]?.[column];
    if (header?.userEnteredValue && !hasPendingColor(header)) {
      throw new Error(
        "This run has processed or manually changed metadata; update Google Sheets manually.",
      );
    }
  }
};

const snapshotMembers = (
  snapshot: PayoutSheetSnapshot,
): PayoutSheetMember[] => {
  const members = snapshot.members ?? [];
  const uniqueIds = new Set(snapshot.userIds);
  if (
    !uniqueIds.size ||
    members.length !== uniqueIds.size ||
    new Set(members.map((member) => normalizeTag(member.discordTag))).size !==
      uniqueIds.size ||
    members.some(
      (member) =>
        !uniqueIds.has(member.userId) || !normalizeTag(member.discordTag),
    )
  ) {
    throw new Error(
      "Could not uniquely resolve every participant's Discord username.",
    );
  }
  return members;
};

const createColumnRequests = (
  sheetId: number,
  column: number,
  rowCount: number,
  snapshot: PayoutSheetSnapshot,
  insertColumn: boolean,
): Request[] => {
  const requests: Request[] = [
    ...(insertColumn
      ? [
          {
            insertDimension: {
              range: {
                sheetId,
                dimension: "COLUMNS",
                startIndex: column,
                endIndex: column + 1,
              },
              inheritFromBefore: true,
            },
          },
        ]
      : []),
    {
      copyPaste: {
        source: {
          sheetId,
          startColumnIndex: column - 1,
          endColumnIndex: column,
          startRowIndex: 4,
          endRowIndex: rowCount,
        },
        destination: {
          sheetId,
          startColumnIndex: column,
          endColumnIndex: column + 1,
          startRowIndex: 4,
          endRowIndex: rowCount,
        },
        pasteType: "PASTE_FORMAT",
      },
    },
    {
      createDeveloperMetadata: {
        developerMetadata: {
          metadataKey: PAYOUT_EXPORT_METADATA_KEY,
          metadataValue: snapshot.identifier,
          visibility: "DOCUMENT",
          location: {
            dimensionRange: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: column,
              endIndex: column + 1,
            },
          },
        },
      },
    },
    cellUpdate(
      sheetId,
      4,
      column,
      {
        ...textCell(snapshot.title),
        note: snapshot.identifier,
      },
      "userEnteredValue,note",
    ),
  ];
  for (const row of [5, 7]) {
    requests.push(
      cellUpdate(
        sheetId,
        row,
        column,
        {
          userEnteredValue: { numberValue: 0 },
          userEnteredFormat: { backgroundColor: PENDING_SHARE_COLOR },
        },
        PAYOUT_VALUE_AND_BACKGROUND_FIELDS,
      ),
    );
  }
  return requests;
};

/** Keeps the new spacer white except for the copied row-9 header band. */
const emptyColumnRequests = (
  sheetId: number,
  column: number,
  rowCount: number,
): Request[] => [
  {
    insertDimension: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: column + 1,
        endIndex: column + 2,
      },
      inheritFromBefore: true,
    },
  },
  {
    repeatCell: {
      range: {
        sheetId,
        startColumnIndex: column + 1,
        endColumnIndex: column + 2,
        startRowIndex: 4,
        endRowIndex: rowCount,
      },
      cell: {
        userEnteredFormat: { backgroundColor: EMPTY_SHARE_COLOR },
      },
      fields: PAYOUT_BACKGROUND_FIELDS,
    },
  },
  {
    copyPaste: {
      source: {
        sheetId,
        startColumnIndex: column,
        endColumnIndex: column + 1,
        startRowIndex: 8,
        endRowIndex: 9,
      },
      destination: {
        sheetId,
        startColumnIndex: column + 1,
        endColumnIndex: column + 2,
        startRowIndex: 8,
        endRowIndex: 9,
      },
      pasteType: "PASTE_FORMAT",
    },
  },
];

/**
 * Plans a single atomic Sheets batch without performing network or filesystem operations.
 * New exports reuse empty run columns and replenish one spacer per post; retries and edits do not.
 * Guild headers are in row 9, Combined's Discord header is in A2, and Unclaimed is detected dynamically.
 * @param spreadsheet Current grid, sheet properties, effective colors, and export metadata.
 * @param worksheet Configured guild worksheet in the same spreadsheet as Combined.
 * @param snapshot Persisted export or edit input with resolved unique participant identities.
 * @returns Ordered requests preserving financial inputs, column identities, and summary ranges.
 * @throws When layout, identity, template, or processed-share validation fails before writing.
 */
export const planPayoutSheetExport = (
  spreadsheet: sheets_v4.Schema$Spreadsheet,
  worksheet: string,
  snapshot: PayoutSheetSnapshot,
): Request[] => {
  const { sheet, combined, sheetId, grid, boundary, existing, column } =
    exportLayout(spreadsheet, worksheet, snapshot);
  if (existing != null && snapshot.mode === "create") return [];
  if (snapshot.mode === "vendor" && existing != null) {
    return [cellUpdate(sheetId, 6, column, textCell(snapshot.vendor))];
  }
  const members = snapshotMembers(snapshot);
  const uniqueIds = new Set(snapshot.userIds);
  if (existing != null) validatePendingColumn(grid, column, uniqueIds.size);
  const guildRows = addMembers(sheet, grid, 2, 9, members, { boundary });
  const combinedGrid = sheetGrid(combined);
  const requiredGuildRow = Math.max(...guildRows.rows.values()) + 1;
  const combinedRows = addMembers(combined, combinedGrid, 0, 2, members, {
    worksheet,
    requiredGuildRow,
  });
  const requests = [...guildRows.requests, ...combinedRows.requests];
  const rowCount = Math.max(
    grid.length,
    ...Array.from(guildRows.rows.values(), (row) => row + 1),
  );
  if (existing == null) {
    requests.push(
      ...createColumnRequests(
        sheetId,
        column,
        rowCount,
        snapshot,
        column === boundary,
      ),
    );
  }
  requests.push(cellUpdate(sheetId, 6, column, textCell(snapshot.vendor)));
  const participantRows = new Set(
    members.map(
      (member) => guildRows.rows.get(normalizeTag(member.discordTag))!,
    ),
  );
  const lastRow = Math.max(9, ...guildRows.rows.values());
  for (let row = 9; row <= lastRow; row += 1) {
    requests.push(
      cellUpdate(
        sheetId,
        row,
        column,
        participantRows.has(row)
          ? buildPendingShareCell(column, uniqueIds.size)
          : {
              userEnteredFormat: {
                backgroundColor: EMPTY_SHARE_COLOR,
              },
            },
        PAYOUT_VALUE_AND_BACKGROUND_FIELDS,
      ),
    );
  }
  if (existing == null) {
    const insertions = [...(column === boundary ? [column] : []), column + 1];
    const combinedFormulaRequests = combinedLookupAdjustments(
      combined,
      combinedGrid,
      worksheet,
      requiredGuildRow,
      insertions,
      grid,
    );
    requests.push(
      ...emptyColumnRequests(sheetId, column, rowCount),
      ...aggregateAdjustments(
        sheet,
        addedSummaryRows(grid, guildRows.rows, boundary),
        boundary,
        column === boundary ? 2 : 1,
      ),
      ...combinedFormulaRequests,
    );
  } else {
    requests.push(
      ...combinedLookupAdjustments(
        combined,
        combinedGrid,
        worksheet,
        requiredGuildRow,
        [],
        grid,
      ),
    );
  }
  return requests;
};
