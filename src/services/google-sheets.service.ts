import { google, type sheets_v4 } from "googleapis";
import { readFile } from "node:fs/promises";
import {
  COMBINED_PAYOUT_SHEET_RANGE,
  GOOGLE_SHEETS_SCOPE,
} from "../constants/index.js";
import type {
  GoogleServiceAccountCredentials,
  SheetRow,
} from "../types/google-sheets.js";

export type { SheetRow } from "../types/google-sheets.js";

const loadGoogleServiceAccountCredentials = async (
  filePath: string,
): Promise<GoogleServiceAccountCredentials> => {
  const fileContents = await readFile(filePath, "utf8");
  const credentials = JSON.parse(
    fileContents,
  ) as Partial<GoogleServiceAccountCredentials>;

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error(
      "Google service account credentials are missing required fields",
    );
  }

  return {
    client_email: credentials.client_email,
    private_key: credentials.private_key,
  };
};

/** Creates an authenticated client shared by payout reads and managed export writes. */
const getSheetsClient = async (
  spreadsheetId = process.env.GOOGLE_SHEETS_ID,
) => {
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEETS_ID must be set");
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS must be set");
  }

  const credentials = await loadGoogleServiceAccountCredentials(
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
  );
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [GOOGLE_SHEETS_SCOPE],
  });
  const sheets = google.sheets({ version: "v4", auth });
  return { sheets, spreadsheetId };
};

/**
 * Reads values from an A1-notation range in the configured Google spreadsheet.
 * @param range The sheet range to read, such as `Combined!A:ZZ`.
 * @param spreadsheetId The spreadsheet ID; defaults to `GOOGLE_SHEETS_ID`.
 * @returns Rows of string cell values.
 */
export const readSheetValues = async (
  range: string,
  spreadsheetId = process.env.GOOGLE_SHEETS_ID,
): Promise<SheetRow[]> => {
  const { sheets } = await getSheetsClient(spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return (response.data.values ?? []).map((row) => row.map(String));
};

/** Reads the payout source range from the `Combined` worksheet. */
export const readCombinedPayoutSheetRows = async (): Promise<SheetRow[]> =>
  readSheetValues(COMBINED_PAYOUT_SHEET_RANGE);

/**
 * Reads the configured guild tab and Combined using the existing service account.
 * Includes formulas, effective colors, notes, and developer metadata for preflight validation.
 * @param worksheet Guild worksheet selected by payoutWorksheets in Discord settings.
 * @returns Grid data and properties required to build one atomic batch.
 * @throws On configuration/authentication failure or an API request exceeding 60 seconds.
 */
export const readPayoutSpreadsheet = async (
  worksheet: string,
): Promise<sheets_v4.Schema$Spreadsheet> => {
  const { sheets, spreadsheetId } = await getSheetsClient();
  const response = await sheets.spreadsheets.get(
    {
      spreadsheetId,
      ranges: [`'${worksheet.replaceAll("'", "''")}'`, "'Combined'"],
      includeGridData: true,
      fields:
        "sheets(properties,developerMetadata,data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,userEnteredFormat(backgroundColor,backgroundColorStyle),effectiveFormat(backgroundColor,backgroundColorStyle),note))))",
    },
    { timeout: 60_000, retry: false },
  );
  return response.data;
};

/**
 * Applies a validated batch once with a 15-second request timeout and no automatic retries.
 * Uncertain outcomes are reconciled by Export ID on a later explicit sync attempt.
 * @param requests Ordered structural, formatting, formula, and identity requests.
 * @throws When Google rejects the entire atomic batch or its confirmation is unavailable.
 */
export const writePayoutSpreadsheet = async (
  requests: sheets_v4.Schema$Request[],
): Promise<void> => {
  const { sheets, spreadsheetId } = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate(
    {
      spreadsheetId,
      requestBody: { requests },
    },
    { timeout: 15_000, retry: false },
  );
};
