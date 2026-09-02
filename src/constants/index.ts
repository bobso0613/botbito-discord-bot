export const GOOGLE_SHEETS_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets";
export const COMBINED_PAYOUT_SHEET_RANGE = "Combined!A:ZZ";
export const PAYOUT_HEADERS = [
  "Pending",
  "Share Ready",
  "Distributed",
] as const;

export const COMMAND_GUIDE: ReadonlyArray<{
  name: string;
  description: string;
}> = [
  { name: "/payout", description: "Get your payout details" },
  {
    name: "/payoutsummary",
    description: "View the server's Share Ready payout summary",
  },
  { name: "/help", description: "Display this guide" },
];
