import { google } from "googleapis";

const GOOGLE_SHEETS_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets.readonly";

export type SheetRow = string[];

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

  const auth = new google.auth.GoogleAuth({
    scopes: [GOOGLE_SHEETS_SCOPE],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return (response.data.values ?? []).map((row) => row.map(String));
};
