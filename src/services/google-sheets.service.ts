import { google } from "googleapis";
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

export const readSheetValues = async (
  range: string,
  spreadsheetId = process.env.GOOGLE_SHEETS_ID,
): Promise<SheetRow[]> => {
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
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return (response.data.values ?? []).map((row) => row.map(String));
};

export const readCombinedPayoutSheetRows = async (): Promise<SheetRow[]> =>
  readSheetValues(COMBINED_PAYOUT_SHEET_RANGE);
