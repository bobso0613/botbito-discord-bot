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

const hasEmptyShareColor = (cell: sheets_v4.Schema$CellData): boolean => {
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
            EMPTY_SHARE_COLOR[component as keyof typeof EMPTY_SHARE_COLOR],
        ) < 0.01,
    ),
  );
};

/**
 * Refuses processed colors, numeric overrides, and unknown financial cell states.
 * @param cell Existing run cell, including effective formatting after conditional rules.
 * @throws When a cell is processed, manually changed, or not a purple default formula.
 */
export const validatePendingShareCell = (
  cell: sheets_v4.Schema$CellData,
  column: number,
  participants: number,
): void => {
  const value = cell.userEnteredValue;
  if (!value || Object.keys(value).length === 0) {
    const color =
      cell.effectiveFormat?.backgroundColorStyle?.rgbColor ??
      cell.effectiveFormat?.backgroundColor ??
      cell.userEnteredFormat?.backgroundColor;
    if (color && !hasPendingColor(cell) && !hasEmptyShareColor(cell)) {
      throw new Error(
        "This run has processed or manually changed shares; update Google Sheets manually.",
      );
    }
    return;
  }
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

const mirroredIdentityColumns = (
  headers: sheets_v4.Schema$CellData[],
  tagColumn: number,
  boundary: number,
): Map<number, "name" | "discord"> => {
  const columns = new Map<number, "name" | "discord">();
  if (tagColumn !== 2) return columns;
  headers.forEach((cell, column) => {
    const header = payoutCellText(cell).trim().toLowerCase();
    if (column > boundary && (header === "name" || header === "discord")) {
      columns.set(column, header);
    }
  });
  return columns;
};

const isGuildSummaryFormula = (
  formula: string,
  row: number,
  boundary?: number,
): boolean => {
  const normalized = formula.replace(/\s+/g, "");
  const sum =
    /^=SUM\((\$?[DEF]\d+):(\$?[A-Z]+\d+)\)(?:-(\$?[A-Z]+\d+))?$/i.exec(
      normalized,
    );
  const colored =
    /^=sumByColor\(ADDRESS\(ROW\(([A-Z$]+\d+)\),COLUMN\(([A-Z$]+\d+)\)\)&":"&ADDRESS\(ROW\(([A-Z$]+\d+)\),COLUMN\(([A-Z$]+\d+)\)\),"#(?:8e7cc3|ffd966|00ff00)"\)(?:-([A-Z$]+\d+))?$/i.exec(
      normalized,
    );
  if (!sum && !colored) return false;
  if (colored && (colored[1] !== colored[2] || colored[3] !== colored[4]))
    return false;
  const start = sum?.[1] ?? colored![1]!;
  const end = sum?.[2] ?? colored![3]!;
  const deduction = sum ? sum[3] : colored![5];
  if (!/^\$?[DEF]\d+$/i.test(start)) return false;
  const references = [start, end, ...(deduction ? [deduction] : [])];
  if (
    !references.every(
      (reference) => Number(/^\$?[A-Z]+(\d+)$/i.exec(reference)?.[1]) === row,
    )
  )
    return false;
  const endColumn = end.replace(/[$\d]/g, "").toUpperCase();
  if (boundary != null) {
    const endIndex =
      [...endColumn].reduce(
        (index, character) => index * 26 + character.codePointAt(0)! - 64,
        0,
      ) - 1;
    if (endIndex < 5 || endIndex > boundary + 1) return false;
    if (
      deduction &&
      deduction.replace(/[$\d]/g, "").toUpperCase() !==
        payoutColumnLabel(boundary)
    )
      return false;
  }
  return true;
};

const validateGuildFormulaTemplate = (
  formulas: PayoutSheetFormula[],
  template: number,
  boundary: number,
  mirroredColumns: Map<number, "name" | "discord">,
): void => {
  for (const { column, formula } of formulas) {
    if (column <= boundary || mirroredColumns.has(column)) continue;
    if (!isGuildSummaryFormula(formula, template + 1, boundary)) {
      throw new Error(
        `Guild template ${payoutColumnLabel(column)}${template + 1} must use row-relative SUM formulas, supported sumByColor formulas, or mirrored identities; update Google Sheets manually.`,
      );
    }
  }
};

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
  const match = /^('(?:[^']|'')+'|[A-Z_][\w.]*)!([^:]+):([^:]+)$/i.exec(
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

const unwrapCombinedLookup = (
  expression: string,
): { expression: string; wrapped: boolean } | undefined => {
  const prefix = "IFERROR(";
  if (!expression.toUpperCase().startsWith(prefix))
    return { expression, wrapped: false };
  if (!expression.endsWith(")")) return undefined;
  const separator = expression.lastIndexOf(",");
  if (
    separator < prefix.length ||
    expression.slice(separator + 1, -1).trim() !== "0"
  )
    return undefined;
  return {
    expression: expression.slice(prefix.length, separator).trim(),
    wrapped: true,
  };
};

const parseCombinedLookup = (
  formula: string,
  formulaRow: number,
  worksheet?: string,
): CombinedLookup | undefined => {
  if (!formula.startsWith("=")) return undefined;
  const wrapper = unwrapCombinedLookup(formula.slice(1).trim());
  if (!wrapper) return undefined;
  const unwrapped = wrapper.expression;
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
    wrapped: wrapper.wrapped,
  };
};

const unquoteWorksheet = (reference: string): string =>
  reference.startsWith("'")
    ? reference.slice(1, -1).replaceAll("''", "'")
    : reference;

const closingFormulaQuote = (formula: string, start: number): number => {
  const quote = formula[start]!;
  let end = formula.indexOf(quote, start + 1);
  while (end !== -1 && formula[end + 1] === quote) {
    end = formula.indexOf(quote, end + 2);
  }
  return end;
};

const formulaReferenceToken = (
  formula: string,
  start: number,
): { end: number; worksheet?: string } => {
  const character = formula[start];
  if (character === "'" || character === '"') {
    const end = closingFormulaQuote(formula, start);
    return {
      end,
      worksheet:
        character === "'"
          ? unquoteWorksheet(formula.slice(start, end + 1))
          : undefined,
    };
  }
  const identifier = /[A-Z_][\w.]*/iy;
  identifier.lastIndex = start;
  const match = identifier.exec(formula);
  return {
    end: match ? identifier.lastIndex - 1 : start,
    worksheet: match?.[0],
  };
};

const formulaReferencesWorksheet = (
  formula: string,
  worksheet: string,
): boolean => {
  let index = 0;
  while (index < formula.length) {
    const token = formulaReferenceToken(formula, index);
    if (token.end < index) return false;
    if (
      formula[token.end + 1] === "!" &&
      token.worksheet?.toLowerCase() === worksheet.toLowerCase()
    )
      return true;
    index = token.end + 1;
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
  template: sheets_v4.Schema$CellData[],
  row: number,
  shareTotalColumn: number,
  mirroredColumns: Map<number, "name" | "discord">,
) => {
  return (cell: sheets_v4.Schema$CellData, column: number): boolean => {
    if (!cell.userEnteredValue || mirroredColumns.has(column)) {
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

const validateExistingCombinedMembers = (
  grid: Grid,
  rows: Map<string, number>,
  members: PayoutSheetMember[],
  worksheet: string,
  requiredGuildRow?: number,
): void => {
  for (const member of members) {
    const row = rows.get(normalizeTag(member.discordTag));
    if (row == null) continue;
    const formulas = (grid[row] ?? []).flatMap((cell, column) => {
      const formula = cell.userEnteredValue?.formulaValue;
      return formula && formulaReferencesWorksheet(formula, worksheet)
        ? [{ column, formula }]
        : [];
    });
    validateFormulaTemplate(formulas, 0, row, worksheet, requiredGuildRow);
  }
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
  if (tagColumn === 0 && worksheet) {
    validateExistingCombinedMembers(
      grid,
      rows,
      members,
      worksheet,
      requiredGuildRow,
    );
  }
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
  const mirroredColumns = mirroredIdentityColumns(
    grid[start - 1] ?? [],
    tagColumn,
    boundary,
  );
  const shareTotalColumn =
    tagColumn === 2
      ? (grid[start - 1] ?? []).findIndex(
          (cell, column) =>
            column > boundary &&
            payoutCellText(cell).trim().toLowerCase() === "share total",
        )
      : -1;
  if (tagColumn === 2) {
    if (
      shareTotalColumn !== -1 &&
      !formulas.some(({ column }) => column === shareTotalColumn)
    ) {
      throw new Error(
        "The Share Total formula template is missing; update Google Sheets manually.",
      );
    }
    validateGuildFormulaTemplate(formulas, template, boundary, mirroredColumns);
  }
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
      grid[template] ?? [],
      row,
      shareTotalColumn,
      mirroredColumns,
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
        : formulas.filter(
            ({ column }) => column > boundary && !mirroredColumns.has(column),
          );
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
      for (const [column, identity] of mirroredColumns) {
        requests.push(
          cellUpdate(
            sheetId,
            row,
            column,
            textCell(
              identity === "name"
                ? member.displayName
                : `@${normalizeTag(member.discordTag)}`,
            ),
          ),
        );
      }
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

const hasTextBasedRange = (formula: string): boolean => {
  const fragments = formula.split('"');
  for (let index = 1; index < fragments.length; index += 2) {
    const boundaries = fragments[index]!.split(":");
    for (let boundary = 1; boundary < boundaries.length; boundary += 1) {
      const reversed = [...boundaries[boundary - 1]!].reverse().join("");
      if (
        /^\d+\$?[A-Z]+/i.test(reversed) &&
        /^\$?[A-Z]+\$?\d+/i.test(boundaries[boundary]!)
      )
        return true;
    }
  }
  return false;
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
    "gi",
  );
  const includesBoundary = new RegExp(
    String.raw`:[$]?${payoutColumnLabel(boundary)}[$]?\d+`,
    "i",
  );
  grid.forEach((cells, row) => {
    cells.forEach((cell, column) => {
      const formula = cell.userEnteredValue?.formulaValue;
      if (!formula || column <= boundary || row < 9) return;
      if (hasTextBasedRange(formula)) {
        throw new Error(
          "A summary formula uses a text-based range that cannot safely shift; update Google Sheets manually.",
        );
      }
      const looksLikeRunRange = /[$]?F[$]?\d+:/i.test(formula);
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
  const sourceRow = Number(/\d+/.exec(formula)?.[0]);
  if (isGuildSummaryFormula(formula, sourceRow)) {
    return {
      userEnteredValue: {
        formulaValue: formula.replace(
          /"[^"]*"|(\$?[A-Z]+)(\d*)/gi,
          (
            reference,
            column: string | undefined,
            referenceRow: string | undefined,
          ) => (column && referenceRow ? `${column}${row + 1}` : reference),
        ),
      },
    };
  }
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

const columnHasMetadata = (
  sheet: sheets_v4.Schema$Sheet,
  column: number,
): boolean =>
  (sheet.developerMetadata ?? []).some((entry) => {
    const range = entry.location?.dimensionRange;
    return (
      range?.dimension === "COLUMNS" &&
      (range.startIndex ?? 0) <= column &&
      (range.endIndex ?? column + 1) > column
    );
  });

const cellHasContent = (cell?: sheets_v4.Schema$CellData): boolean =>
  Boolean(
    cell?.note ||
    [cell?.userEnteredValue, cell?.effectiveValue].some(
      (value) => value && Object.keys(value).length > 0,
    ),
  );

const columnHasContent = (
  sheet: sheets_v4.Schema$Sheet,
  grid: Grid,
  column: number,
): boolean =>
  columnHasMetadata(sheet, column) ||
  grid.some((row) => cellHasContent(row[column]));

const nextRunColumn = (
  sheet: sheets_v4.Schema$Sheet,
  grid: Grid,
  boundary: number,
): number => {
  let lastRunColumn = 4;
  for (let column = 5; column < boundary; column += 1) {
    if (
      payoutCellText(grid[4]?.[column]).trim() ||
      columnHasMetadata(sheet, column)
    ) {
      lastRunColumn = column;
    }
  }
  return lastRunColumn + 1;
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
  const insertColumn =
    existing == null &&
    (column >= boundary || columnHasContent(sheet, grid, column));
  if (column < 5 || (column >= boundary && existing != null)) {
    throw new Error(
      "The linked run column is outside the expected shares area.",
    );
  }
  return {
    sheet,
    combined,
    sheetId,
    grid,
    boundary,
    existing,
    column,
    insertColumn,
  };
};

const validatePopulatedShareRows = (
  rows: Map<string, number>,
  populatedRows: Set<number>,
  state: { participantCount: number; members?: PayoutSheetMember[] },
): void => {
  const expectedRows = new Set(
    state.members?.map((member) => rows.get(normalizeTag(member.discordTag))),
  );
  if (
    !state.members ||
    expectedRows.size !== state.participantCount ||
    populatedRows.size !== expectedRows.size ||
    [...populatedRows].some((row) => !expectedRows.has(row))
  ) {
    throw new Error(
      "This run has processed or manually changed shares; update Google Sheets manually.",
    );
  }
};

const validatePendingColumn = (
  grid: Grid,
  column: number,
  rosterStates: Array<{
    participantCount: number;
    members?: PayoutSheetMember[];
  }>,
): void => {
  for (const index of [5, 7]) {
    const header = grid[index]?.[column];
    if (header?.userEnteredValue && !hasPendingColor(header)) {
      throw new Error(
        "This run has processed or manually changed metadata; update Google Sheets manually.",
      );
    }
  }
  const rows = identityRows(grid, 2, 9);
  const populatedRows = new Set(
    grid.flatMap((cells, row) =>
      row >= 9 &&
      cells[column]?.userEnteredValue &&
      Object.keys(cells[column]!.userEnteredValue!).length
        ? [row]
        : [],
    ),
  );
  let lastError: unknown;
  for (const state of rosterStates) {
    try {
      validatePopulatedShareRows(rows, populatedRows, state);
      for (const row of grid.slice(9)) {
        validatePendingShareCell(
          row[column] ?? {},
          column,
          state.participantCount,
        );
      }
      for (const member of state.members ?? []) {
        const row = rows.get(normalizeTag(member.discordTag));
        if (
          row == null ||
          !grid[row]?.[column]?.userEnteredValue?.formulaValue
        ) {
          throw new Error(
            "This run has processed or manually changed shares; update Google Sheets manually.",
          );
        }
      }
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw (
    lastError ??
    new Error(
      "This run has processed or manually changed shares; update Google Sheets manually.",
    )
  );
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

const validateSnapshotPendingColumn = (
  grid: Grid,
  column: number,
  snapshot: PayoutSheetSnapshot,
  members: PayoutSheetMember[],
): void => {
  const rosterStates = [
    {
      participantCount: new Set(snapshot.userIds).size,
      members,
    },
    ...(snapshot.syncedParticipantCount == null
      ? []
      : [
          {
            participantCount: snapshot.syncedParticipantCount,
            members: snapshot.syncedMembers,
          },
        ]),
    ...(snapshot.previousPendingRoster
      ? [
          {
            participantCount: new Set(snapshot.previousPendingRoster.userIds)
              .size,
            members: snapshot.previousPendingRoster.members,
          },
        ]
      : []),
    ...(snapshot.pendingRosters ?? []).map((roster) => ({
      participantCount: new Set(roster.userIds).size,
      members: roster.members,
    })),
  ];
  validatePendingColumn(grid, column, rosterStates);
};

const retainedTagChanges = (
  snapshot: PayoutSheetSnapshot,
  members: PayoutSheetMember[],
): Map<string, Set<string>> => {
  const desired = new Map(
    members.map((member) => [member.userId, normalizeTag(member.discordTag)]),
  );
  const aliases = new Map<string, Set<string>>();
  const recorded = [
    ...(snapshot.syncedMembers ?? []),
    ...(snapshot.previousPendingRoster?.members ?? []),
    ...(snapshot.pendingRosters ?? []).flatMap(
      (roster) => roster.members ?? [],
    ),
  ];
  for (const member of recorded) {
    const tag = desired.get(member.userId);
    if (!tag) continue;
    const oldTag = normalizeTag(member.discordTag);
    if (oldTag === tag) continue;
    const changes = aliases.get(tag) ?? new Set<string>();
    changes.add(oldTag);
    aliases.set(tag, changes);
  }
  validateTagAliases(aliases, new Set(desired.values()));
  return aliases;
};

const validateTagAliases = (
  aliases: Map<string, Set<string>>,
  currentTags: Set<string>,
): void => {
  const owners = new Map<string, string>();
  for (const [tag, oldTags] of aliases) {
    for (const oldTag of oldTags) {
      if (
        currentTags.has(oldTag) ||
        (owners.has(oldTag) && owners.get(oldTag) !== tag)
      ) {
        throw new Error(
          "Discord tag migration is ambiguous; update Google Sheets manually.",
        );
      }
      owners.set(oldTag, tag);
    }
  }
};

/** Detects retained Discord IDs whose tags need migration across all payout worksheets. */
export const requiresPayoutIdentityMigration = (
  snapshot: PayoutSheetSnapshot,
): boolean => retainedTagChanges(snapshot, snapshot.members ?? []).size > 0;

/**
 * Confirms that an uncertain batch's pending roster is already visible in its managed column.
 * @returns False when the batch is not visibly committed or the grid cannot prove its full roster.
 */
export const isPayoutSnapshotApplied = (
  spreadsheet: sheets_v4.Schema$Spreadsheet,
  worksheet: string,
  snapshot: PayoutSheetSnapshot,
): boolean => {
  const layout = exportLayout(spreadsheet, worksheet, snapshot);
  if (layout.existing == null) return false;
  if (payoutCellText(layout.grid[6]?.[layout.column]) !== snapshot.vendor) {
    return false;
  }
  const members = snapshotMembers(snapshot);
  try {
    validatePendingColumn(layout.grid, layout.column, [
      { participantCount: new Set(snapshot.userIds).size, members },
    ]);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      [
        "This run has processed or manually changed metadata; update Google Sheets manually.",
        "This run has processed or manually changed shares; update Google Sheets manually.",
      ].includes(error.message)
    ) {
      return false;
    }
    throw error;
  }
};

const validateMigrationLookupSources = (
  spreadsheet: sheets_v4.Schema$Spreadsheet,
  grids: Map<number, Grid>,
  aliases: Map<string, Set<string>>,
): void => {
  const combined = spreadsheet.sheets?.find(
    (sheet) => sheet.properties?.title === "Combined",
  );
  const grid = grids.get(combined!.properties!.sheetId!)!;
  const tags = new Set(
    [...aliases].flatMap(([tag, oldTags]) => [tag, ...oldTags]),
  );
  for (const [row, cells] of grid.entries()) {
    if (row < 2 || !tags.has(normalizeTag(payoutCellText(cells[0])))) continue;
    for (const cell of cells) {
      const formula = cell.userEnteredValue?.formulaValue;
      if (!formula) continue;
      validateMigrationLookup(spreadsheet, grids, formula, row + 1);
    }
  }
};

const validateMigrationLookup = (
  spreadsheet: sheets_v4.Schema$Spreadsheet,
  grids: Map<number, Grid>,
  formula: string,
  row: number,
): void => {
  const lookup = parseCombinedLookup(formula, row);
  const source = spreadsheet.sheets?.find(
    (sheet) =>
      sheet.properties?.title?.toLowerCase() ===
      lookup?.worksheet.toLowerCase(),
  );
  const sourceGrid = source && grids.get(source.properties!.sheetId!);
  if (
    !lookup ||
    !sourceGrid ||
    !/name/i.test(payoutCellText(sourceGrid[8]?.[0])) ||
    !/discord/i.test(payoutCellText(sourceGrid[8]?.[2])) ||
    (lookup.kind === "xlookup" &&
      payoutCellText(sourceGrid[8]?.[lookup.lookupRange.startColumn])
        .trim()
        .toLowerCase() !== "discord")
  ) {
    throw new Error(
      "Combined lookup sources cannot be safely migrated; update Google Sheets manually.",
    );
  }
};

const migrateMirrorTags = (
  sheetId: number,
  grid: Grid,
  row: number,
  tag: string,
  oldTags: Set<string>,
): Request[] => {
  const columns = mirroredIdentityColumns(
    grid[8] ?? [],
    2,
    findUnclaimedColumn(grid[4] ?? []),
  );
  const requests: Request[] = [];
  for (const [column, identity] of columns) {
    if (identity !== "discord") continue;
    const cell = grid[row]?.[column] ?? {};
    const formula = cell.userEnteredValue?.formulaValue;
    if (formula && new RegExp(String.raw`^=\$?C${row + 1}$`, "i").test(formula))
      continue;
    const existing = normalizeTag(payoutCellText(cell));
    if (formula || (existing && existing !== tag && !oldTags.has(existing))) {
      throw new Error(
        "A mirrored Discord identity cannot be safely migrated; update Google Sheets manually.",
      );
    }
    const updated = textCell(`@${tag}`);
    grid[row]![column] = updated;
    requests.push(cellUpdate(sheetId, row, column, updated));
  }
  return requests;
};

const findMigrationRow = (
  rows: Map<string, number>,
  tag: string,
  oldTags: Set<string>,
  required: boolean,
  alreadyMigratedTags: Set<string>,
): number | undefined => {
  const candidates = [
    ...new Set(
      [tag, ...oldTags].flatMap((alias) => {
        const row = rows.get(alias);
        return row == null ? [] : [row];
      }),
    ),
  ];
  if (candidates.length > 1 || (required && candidates.length !== 1)) {
    throw new Error(
      "Retained Discord identity is missing or split across rows; update Google Sheets manually.",
    );
  }
  if (
    !required &&
    rows.has(tag) &&
    ![...oldTags].some((oldTag) => rows.has(oldTag)) &&
    !alreadyMigratedTags.has(tag)
  ) {
    throw new Error(
      "A destination Discord tag already has another worksheet identity; update Google Sheets manually.",
    );
  }
  return candidates[0];
};

const migrateSheetTags = (
  sheet: sheets_v4.Schema$Sheet,
  grid: Grid,
  aliases: Map<string, Set<string>>,
  required: boolean,
  alreadyMigratedTags: Set<string>,
): Request[] => {
  const combined = sheet.properties?.title === "Combined";
  const tagColumn = combined ? 0 : 2;
  const rows = identityRows(grid, tagColumn, combined ? 2 : 9);
  const sheetId = sheet.properties!.sheetId!;
  const requests: Request[] = [];
  for (const [tag, oldTags] of aliases) {
    const row = findMigrationRow(
      rows,
      tag,
      oldTags,
      required,
      alreadyMigratedTags,
    );
    if (row == null) continue;
    if (!grid[row]?.[tagColumn]?.userEnteredValue?.stringValue) {
      throw new Error(
        "A retained Discord tag is not a literal identity; update Google Sheets manually.",
      );
    }
    const updated = textCell(`@${tag}`);
    grid[row]![tagColumn] = updated;
    requests.push(cellUpdate(sheetId, row, tagColumn, updated));
    if (!combined)
      requests.push(...migrateMirrorTags(sheetId, grid, row, tag, oldTags));
  }
  return requests;
};

const confirmedMigrationTags = (
  spreadsheet: sheets_v4.Schema$Spreadsheet,
  grids: Map<number, Grid>,
  worksheet: string,
  aliases: Map<string, Set<string>>,
): Set<string> => {
  const requiredRows = [worksheet, "Combined"].map((title) => {
    const sheet = spreadsheet.sheets!.find(
      (candidate) => candidate.properties?.title === title,
    )!;
    return identityRows(
      grids.get(sheet.properties!.sheetId!)!,
      title === "Combined" ? 0 : 2,
      title === "Combined" ? 2 : 9,
    );
  });
  return new Set(
    [...aliases]
      .filter(([tag, oldTags]) =>
        requiredRows.every(
          (rows) =>
            rows.has(tag) && ![...oldTags].some((oldTag) => rows.has(oldTag)),
        ),
      )
      .map(([tag]) => tag),
  );
};

const migrateRetainedIdentities = (
  spreadsheet: sheets_v4.Schema$Spreadsheet,
  worksheet: string,
  snapshot: PayoutSheetSnapshot,
  members: PayoutSheetMember[],
): { grids: Map<number, Grid>; requests: Request[] } => {
  const aliases = retainedTagChanges(snapshot, members);
  const grids = new Map<number, Grid>();
  const requests: Request[] = [];
  for (const sheet of spreadsheet.sheets ?? []) {
    const grid = sheetGrid(sheet).map((row) => [...row]);
    const sheetId = sheet.properties?.sheetId;
    if (sheetId == null) continue;
    grids.set(sheetId, grid);
  }
  if (aliases.size) validateMigrationLookupSources(spreadsheet, grids, aliases);
  const alreadyMigratedTags = confirmedMigrationTags(
    spreadsheet,
    grids,
    worksheet,
    aliases,
  );
  for (const sheet of spreadsheet.sheets ?? []) {
    const grid = grids.get(sheet.properties?.sheetId ?? -1);
    if (!grid) continue;
    if (!aliases.size) continue;
    const title = sheet.properties?.title;
    const required = title === worksheet || title === "Combined";
    const guildLayout =
      /discord/i.test(payoutCellText(grid[8]?.[2])) &&
      /name/i.test(payoutCellText(grid[8]?.[0]));
    if (!required && !guildLayout) continue;
    requests.push(
      ...migrateSheetTags(sheet, grid, aliases, required, alreadyMigratedTags),
    );
  }
  return { grids, requests };
};

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
  const {
    sheet,
    combined,
    sheetId,
    grid: originalGrid,
    boundary,
    existing,
    column,
    insertColumn,
  } = exportLayout(spreadsheet, worksheet, snapshot);
  if (existing != null && snapshot.mode === "create") return [];
  if (snapshot.mode === "vendor" && existing != null) {
    return [cellUpdate(sheetId, 6, column, textCell(snapshot.vendor))];
  }
  const members = snapshotMembers(snapshot);
  const uniqueIds = new Set(snapshot.userIds);
  if (existing != null) {
    validateSnapshotPendingColumn(originalGrid, column, snapshot, members);
  }
  const migration = migrateRetainedIdentities(
    spreadsheet,
    worksheet,
    snapshot,
    members,
  );
  const grid = migration.grids.get(sheetId)!;
  const guildRows = addMembers(sheet, grid, 2, 9, members, { boundary });
  const combinedGrid = migration.grids.get(combined.properties!.sheetId!)!;
  const requiredGuildRow = Math.max(...guildRows.rows.values()) + 1;
  const combinedRows = addMembers(combined, combinedGrid, 0, 2, members, {
    worksheet,
    requiredGuildRow,
  });
  const requests = [
    ...migration.requests,
    ...guildRows.requests,
    ...combinedRows.requests,
  ];
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
        insertColumn,
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
    const insertions = [...(insertColumn ? [column] : []), column + 1];
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
        insertColumn ? 2 : 1,
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
