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
  emoji: string;
  parameters?: ReadonlyArray<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}> = [
  {
    name: "/payout",
    description: "Get your payout details",
    emoji: "💰",
  },
  {
    name: "/payoutsummary",
    description: "View the server's Share Ready payout summary",
    emoji: "📄",
    parameters: [
      {
        name: "sort",
        description:
          "Sort payouts by name or Share Ready amount (Name, Share Ready amount)",
        required: false,
      },
      {
        name: "direction",
        description: "Sort direction (Ascending, Descending)",
        required: false,
      },
    ],
  },
  {
    name: "/guildsched",
    description: "View active schedules for this guild",
    emoji: "🗓️",
    parameters: [
      {
        name: "public",
        description: "Show your schedules to everyone in this channel",
        required: false,
      },
    ],
  },
  {
    name: "/help",
    description: "Display this guide",
    emoji: "ℹ️",
  },
];
