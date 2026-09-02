export const GOOGLE_SHEETS_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets";
export const COMBINED_PAYOUT_SHEET_RANGE = "Combined!A:ZZ";
export const PAYOUT_HEADERS = [
  "Pending",
  "Share Ready",
  "Distributed",
] as const;

export const PAYOUT_CHANNEL_BY_GUILD: Readonly<Record<string, string>> = {
  "499171225046876170": "1470361558893723710",
  "92073842977030144": "1465658706711547946",
  "1115484031455346718": "1115484031455346721",
};
export const PAYOUT_GUILD_IDS = Object.keys(PAYOUT_CHANNEL_BY_GUILD);

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

export const PAYOUT_TO_PING_ID: number = 92073343238279168;
export const PAYOUT_TO_PING_TAG: string = "bobito";
