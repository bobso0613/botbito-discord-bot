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
    description: "Get your payout details in this server",
    emoji: "💰",
    parameters: [
      {
        name: "sendprivately",
        description: "Send the payout details privately (default: public)",
        required: false,
      },
    ],
  },
  {
    name: "/payoutsummary",
    description: "View this server's payout summary",
    emoji: "📄",
    parameters: [
      {
        name: "amount",
        description:
          "Choose which payout amount to show (Share Ready, Pending, Distributed)",
        required: false,
      },
      {
        name: "sendprivately",
        description: "Send the payout summary privately (default: public)",
        required: false,
      },
      {
        name: "sort",
        description: "Sort payouts by name or amount (Name, Amount)",
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
    description:
      "View active schedules from this guild's configured categories",
    emoji: "🗓️",
    parameters: [
      {
        name: "public",
        description: "Show the schedules to everyone in this channel",
        required: false,
      },
      {
        name: "forannouncementonly",
        description:
          "With public, hide signup, reserve, and character-note details",
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
          "Show all signed-up and reserve runs from this schedule week, Monday 06:00 GMT through Sunday",
        required: false,
      },
      {
        name: "grouping",
        description:
          "Group schedules by date, guild, or instance type (By Date default)",
        required: false,
      },
    ],
  },
  {
    name: "/mycooldowns",
    description: "View your weekly cooldown status across accessible guilds",
    emoji: "🔥",
    parameters: [
      {
        name: "showinpublic",
        description: "Show your cooldown status to everyone in this channel",
        required: false,
      },
    ],
  },
  {
    name: "/newrun",
    description: "Create a signup sheet in this channel",
    emoji: "🆕",
  },
  {
    name: "/change all",
    description:
      "Reopen the party setup modal to change the title, date/time, timezone, or party sizes",
    emoji: "🛠️",
  },
  {
    name: "/change roster",
    description: "Edit only the roster without touching the party setup",
    emoji: "📋",
  },
  {
    name: "/change position",
    description: "Change a slot's role without removing its signup",
    emoji: "🎭",
    parameters: [
      { name: "value", description: "New role", required: true },
      {
        name: "position",
        description: "Slot number (defaults to your own slot)",
        required: false,
      },
    ],
  },
  {
    name: "/add",
    description:
      "Sign up for a slot or reserve, or add another user (alias: /a)",
    emoji: "➕",
    parameters: [
      {
        name: "input",
        description:
          "Slot number(s) comma-separated, `random`, or `reserve`, optionally followed by @user",
        required: true,
      },
    ],
  },
  {
    name: "/remove",
    description: "Remove your signups/reserve, or specific slot(s) (alias: /r)",
    emoji: "➖",
    parameters: [
      {
        name: "position",
        description:
          "Slot number(s) comma-separated, or reserve (blank removes all your signups)",
        required: false,
      },
    ],
  },
  {
    name: "/swap",
    description: "Join a slot, or swap two slots/reserves",
    emoji: "🔀",
    parameters: [
      {
        name: "first",
        description: "Your or first slot number, `random`, or reserve",
        required: true,
      },
      {
        name: "second",
        description: "Second slot number or reserve",
        required: false,
      },
    ],
  },
  {
    name: "/clear",
    description: "Clear the roster, schedule, or both (alias: /c)",
    emoji: "🧹",
    parameters: [
      {
        name: "which",
        description: "What to clear (Roster, Schedule, All)",
        required: true,
      },
    ],
  },
  {
    name: "/charnote",
    description: "Set a character note (alias: /char)",
    emoji: "📝",
    parameters: [
      { name: "note", description: "Character note", required: true },
      {
        name: "position",
        description: "Slot (defaults to your own slot)",
        required: false,
      },
    ],
  },
  {
    name: "/name",
    description: "Set the run title",
    emoji: "✏️",
    parameters: [{ name: "input", description: "Run name", required: true }],
  },
  {
    name: "/note",
    description:
      "Edit important notes; reply with `remove` as your next message to clear them",
    emoji: "🗒️",
  },
  {
    name: "/setpic",
    description: "Set the sheet thumbnail image",
    emoji: "🖼️",
    parameters: [{ name: "url", description: "Image URL", required: true }],
  },
  {
    name: "/color",
    description: "Set the embed color",
    emoji: "🎨",
    parameters: [
      {
        name: "hexcodecolor",
        description: "Hex color, e.g. #00b0f4",
        required: true,
      },
    ],
  },
  {
    name: "/setservertimezone",
    description: "Set the server timezone",
    emoji: "🌐",
    parameters: [
      {
        name: "timezone",
        description: "GMT, GMT+8, GMT-5, etc.",
        required: true,
      },
    ],
  },
  {
    name: "/setinstancetype",
    description: "Set the instance type for this run",
    emoji: "🏷️",
    parameters: [
      { name: "type", description: "Instance type", required: true },
    ],
  },
  {
    name: "/postpone",
    description: "Shift the run's date/time later without touching the roster",
    emoji: "⏳",
    parameters: [
      {
        name: "value",
        description: "For example: next week, last hour, or 1.5 days",
        required: true,
      },
    ],
  },
  {
    name: "/next",
    description: "Shift the date/time and clear the roster for a fresh run",
    emoji: "⏭️",
    parameters: [
      {
        name: "value",
        description: "For example: next week, last hour, or 1.5 days",
        required: true,
      },
    ],
  },
  {
    name: "/gonow",
    description: "Set the run to now, optionally offset by a duration",
    emoji: "🚀",
    parameters: [
      {
        name: "value",
        description: "For example: next week, last hour, or 1.5 days",
        required: false,
      },
    ],
  },
  {
    name: "/sdt",
    description: "Set the date and time, or `TBD` to clear it",
    emoji: "📅",
    parameters: [
      {
        name: "datetime",
        description: "Date/time, e.g. 10/09 20:00 GMT+8, or TBD",
        required: true,
      },
    ],
  },
  {
    name: "/when",
    description: "Show the run time",
    emoji: "⌛",
  },
  {
    name: "/ping",
    description: "Ping signed-up and/or reserve members with a message",
    emoji: "📣",
    parameters: [
      { name: "message", description: "Message", required: true },
      {
        name: "which",
        description: "Who to ping (Main Roster, Reserves, All)",
        required: true,
      },
    ],
  },
  {
    name: "/swaporganizer",
    description: "Change the organizer",
    emoji: "👑",
    parameters: [
      { name: "user", description: "New organizer", required: true },
    ],
  },
  {
    name: "/show",
    description: "Show this channel's signup sheet (aliases: /last, /s)",
    emoji: "👁️",
  },
  {
    name: "/help",
    description: "Display this guide",
    emoji: "ℹ️",
  },
];
