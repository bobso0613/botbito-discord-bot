import { jest } from "@jest/globals";

const readFile = jest.fn(async (_path: string): Promise<string> => "");
const getValues = jest.fn(
  async (
    _options: unknown,
  ): Promise<{ data: { values: (string | number)[][] } }> => ({
    data: { values: [] },
  }),
);
const GoogleAuth = jest.fn();
const getSpreadsheet = jest.fn(
  async (_options: unknown, _requestOptions: unknown) => ({
    data: { sheets: [] },
  }),
);
const batchUpdate = jest.fn(
  async (_options: unknown, _requestOptions: unknown) => ({ data: {} }),
);
const createSheets = jest.fn(() => ({
  spreadsheets: {
    values: { get: getValues },
    get: getSpreadsheet,
    batchUpdate,
  },
}));

jest.unstable_mockModule("node:fs/promises", () => ({ readFile }));
jest.unstable_mockModule("googleapis", () => ({
  google: {
    auth: { GoogleAuth },
    sheets: createSheets,
  },
}));

const {
  readSheetValues,
  readCombinedPayoutSheetRows,
  readPayoutSpreadsheet,
  writePayoutSpreadsheet,
} = await import("./google-sheets.service.js");

describe("google sheets service", () => {
  const originalCredentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const originalSpreadsheetId = process.env.GOOGLE_SHEETS_ID;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "private/service-account.json";
    process.env.GOOGLE_SHEETS_ID = "spreadsheet-id";
    readFile.mockImplementation(async () =>
      JSON.stringify({
        client_email: "bot@example.com",
        private_key: "private-key",
      }),
    );
    getValues.mockImplementation(async () => ({
      data: { values: [["A", 2], ["B"]] },
    }));
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

  it("reads grid formulas/colors with a timeout and sends write batches without automatic retries", async () => {
    await readPayoutSpreadsheet("FSN 2026");
    expect(getSpreadsheet).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: "spreadsheet-id",
        includeGridData: true,
        ranges: ["'FSN 2026'", "'Combined'"],
      }),
      { timeout: 15_000, retry: false },
    );
    const requests = [{ updateCells: { fields: "userEnteredValue" } }];
    await writePayoutSpreadsheet(requests);
    expect(batchUpdate).toHaveBeenCalledWith(
      { spreadsheetId: "spreadsheet-id", requestBody: { requests } },
      { timeout: 15_000, retry: false },
    );
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
    readFile.mockImplementation(async () =>
      JSON.stringify({ client_email: "bot@example.com" }),
    );
    await expect(readSheetValues("Sheet1!A:A")).rejects.toThrow(
      "Google service account credentials are missing required fields",
    );
  });
});
