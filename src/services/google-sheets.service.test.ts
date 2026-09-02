import { jest } from "@jest/globals";

const readFile = jest.fn();
const getValues = jest.fn();
const GoogleAuth = jest.fn();
const createSheets = jest.fn(() => ({
  spreadsheets: { values: { get: getValues } },
}));

jest.unstable_mockModule("node:fs/promises", () => ({ readFile }));
jest.unstable_mockModule("googleapis", () => ({
  google: {
    auth: { GoogleAuth },
    sheets: createSheets,
  },
}));

const { readSheetValues, readCombinedPayoutSheetRows } =
  await import("./google-sheets.service.js");

describe("google sheets service", () => {
  const originalCredentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const originalSpreadsheetId = process.env.GOOGLE_SHEETS_ID;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "private/service-account.json";
    process.env.GOOGLE_SHEETS_ID = "spreadsheet-id";
    readFile.mockResolvedValue(
      JSON.stringify({
        client_email: "bot@example.com",
        private_key: "private-key",
      }),
    );
    getValues.mockResolvedValue({ data: { values: [["A", 2], ["B"]] } });
  });

  afterAll(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = originalCredentialsPath;
    process.env.GOOGLE_SHEETS_ID = originalSpreadsheetId;
  });

  it("loads service account credentials and converts returned cells to strings", async () => {
    await expect(readSheetValues("Sheet1!A:B")).resolves.toEqual([
      ["A", "2"],
      ["B"],
    ]);

    expect(GoogleAuth).toHaveBeenCalledWith({
      credentials: {
        client_email: "bot@example.com",
        private_key: "private-key",
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    expect(getValues).toHaveBeenCalledWith({
      spreadsheetId: "spreadsheet-id",
      range: "Sheet1!A:B",
    });
  });

  it("reads the configured Combined payout range", async () => {
    await readCombinedPayoutSheetRows();

    expect(getValues).toHaveBeenCalledWith({
      spreadsheetId: "spreadsheet-id",
      range: "Combined!A:ZZ",
    });
  });

  it("rejects missing configuration and incomplete service account credentials", async () => {
    await expect(readSheetValues("Sheet1!A:A", "")).rejects.toThrow(
      "GOOGLE_SHEETS_ID must be set",
    );

    process.env.GOOGLE_APPLICATION_CREDENTIALS = "";
    await expect(readSheetValues("Sheet1!A:A")).rejects.toThrow(
      "GOOGLE_APPLICATION_CREDENTIALS must be set",
    );

    process.env.GOOGLE_APPLICATION_CREDENTIALS = "private/service-account.json";
    readFile.mockResolvedValue(
      JSON.stringify({ client_email: "bot@example.com" }),
    );
    await expect(readSheetValues("Sheet1!A:A")).rejects.toThrow(
      "Google service account credentials are missing required fields",
    );
  });
});
