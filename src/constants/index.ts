export const GOOGLE_SHEETS_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets";
export const COMBINED_PAYOUT_SHEET_RANGE = "Combined!A:ZZ";
export const PAYOUT_HEADERS = [
  "Pending",
  "Share Ready",
  "Distributed",
] as const;
export const SCHEDULE_WEEK_START_HOUR_UTC = 6;
export const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

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
    name: "/mysched",
    description:
      "DM your signed-up and reserve schedules across accessible guilds",
    emoji: "⌚",
    parameters: [
      {
        name: "thisweekonly",
        description:
          "Include completed runs from this schedule week, Monday 06:00 GMT through Sunday",
        required: false,
      },
      {
        name: "grouping",
        description:
          "Group schedules by date or guild (By Date default, By Guild)",
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
