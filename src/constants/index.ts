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
  summary?: string;
  emoji: string;
  parameters?: ReadonlyArray<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}> = [
  {
    name: "/payout",
    summary:
      "View your balances and Currently Vending links; overflow keeps the same privacy setting.",
    description:
      "View balances and 🛒Currently Vending below Distributed. Lists this server's signup-exports threads with your exact <@ID> in saved contents, a current title containing ⏳, and no NO SHARE (case-insensitive). Threads appear even with zero balances; an empty list shows None. Long lists continue in separate messages with the same privacy setting. Missing or malformed export history shows None without hiding balances.",
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
          "Group schedules by date, guild, or instance type (By Date default). By Instance Type uses the source guild's cooldownInstanceTypes when metadata is available; absent metadata falls back to run-title matching. This bot omits metadata for None, so titles still match; other bots' explicit empty or unrecognized metadata uses Others. Headings include configured emojis; multiple types share a combined heading.",
        required: false,
      },
    ],
  },
  {
    name: "/mycooldowns",
    description:
      "Count your signed-up and reserve runs toward weekly cooldowns across accessible guilds. Uses each guild's cooldownInstanceTypes and transitively merges types whose names or keywords match exactly across guilds; similar names alone do not merge. Selected instance metadata overrides titles; absent metadata falls back to run-title matching. Combined runs (ET+EC, ECET, ET and EC) count toward each type once. Title multipliers still apply to enabled types. Equivalent types use the highest configured maxAttempts; maxAttempts: 0 shows only the count.",
    emoji: "🔥",
    parameters: [
      {
        name: "showinpublic",
        description:
          "Show the result to everyone in this channel (private by default)",
        required: false,
      },
    ],
  },
  {
    name: "/guildsetting show",
    description:
      "Show this guild's current schedule and cooldown settings (Administrator only)",
    emoji: "⚙️",
  },
  {
    name: "/guildsetting set payout-channel-id",
    description:
      "Select the payout forum channel (Administrator only; payout-enabled servers)",
    emoji: "⚙️",
    parameters: [
      {
        name: "channel",
        description: "Select or mention a forum channel in this server",
        required: true,
      },
    ],
  },
  {
    name: "/guildsetting set tracked-category",
    description:
      "Set this guild's tracked schedule categories (Administrator only)",
    emoji: "⚙️",
    parameters: [
      {
        name: "categories",
        description: "Category links or #category names, separated by commas",
        required: true,
      },
    ],
  },
  {
    name: "/guildsetting set excluded-channels",
    description: "Set channels excluded from schedules (Administrator only)",
    emoji: "⚙️",
    parameters: [
      {
        name: "channels",
        description: "Channel links or #channel names, separated by commas",
        required: true,
      },
    ],
  },
  {
    name: "/guildsetting set schedule-channels",
    description:
      "Set public schedule announcement channels (Administrator only)",
    emoji: "⚙️",
    parameters: [
      {
        name: "channels",
        description: "Channel links or #channel names, separated by commas",
        required: true,
      },
    ],
  },
  {
    name: "/guildsetting set role-restricted-channels",
    description:
      "Set channel-to-role schedule restrictions (Administrator only)",
    emoji: "⚙️",
    parameters: [
      {
        name: "mappings",
        description: "#channel=@role mappings, separated by commas",
        required: true,
      },
    ],
  },
  {
    name: "/guildsetting clear tracked-category",
    description:
      "Clear this guild's tracked schedule categories (Administrator only)",
    emoji: "⚙️",
  },
  {
    name: "/guildsetting clear excluded-channels",
    description: "Clear channels excluded from schedules (Administrator only)",
    emoji: "⚙️",
  },
  {
    name: "/guildsetting clear schedule-channels",
    description:
      "Clear public schedule announcement channels (Administrator only)",
    emoji: "⚙️",
  },
  {
    name: "/guildsetting clear role-restricted-channels",
    description:
      "Clear channel-to-role schedule restrictions (Administrator only)",
    emoji: "⚙️",
  },
  {
    name: "/guildsetting set cooldown-instance-types",
    description:
      "Add or update a cooldown instance type by name (Administrator only)",
    emoji: "⚙️",
    parameters: [
      {
        name: "name",
        description: "Instance type name",
        required: true,
      },
      {
        name: "keywords",
        description: "Comma-separated title keywords",
        required: true,
      },
      {
        name: "maxattempts",
        description: "Maximum weekly attempts",
        required: true,
      },
      {
        name: "emoji",
        description: "Display emoji",
        required: true,
      },
      {
        name: "initials",
        description:
          "Short instance label; omitted values preserve existing initials",
        required: false,
      },
    ],
  },
  {
    name: "/guildsetting set multiplier-instance-types",
    description: "Set cooldown multiplier instance names (Administrator only)",
    emoji: "⚙️",
    parameters: [
      {
        name: "types",
        description: "Instance names separated by commas",
        required: true,
      },
    ],
  },
  {
    name: "/guildsetting clear cooldown-instance-types",
    description: "Clear cooldown instance types (Administrator only)",
    emoji: "⚙️",
  },
  {
    name: "/guildsetting clear multiplier-instance-types",
    description:
      "Clear cooldown multiplier instance names (Administrator only)",
    emoji: "⚙️",
  },
  {
    name: "/guildsetting remove cooldown-instance-type",
    description:
      "Remove one cooldown instance type by name (Administrator only)",
    emoji: "⚙️",
    parameters: [
      {
        name: "name",
        description: "Instance type name",
        required: true,
      },
    ],
  },
  {
    name: "/newrun",
    description: "Create a signup sheet with up to 8 parties in this channel",
    emoji: "🆕",
  },
  {
    name: "/change all",
    description:
      "Reopen party setup to change the title, date/time, timezone, or party sizes (maximum 8 parties); edit the roster with up to 8 Party headers",
    emoji: "🛠️",
  },
  {
    name: "/change roster",
    description:
      "Edit the public roster template; up to 8 Party # headers control the party breakdown",
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
      "Sign up for a slot or reserve, or add another user (alias: /a). Occupied slots require confirmation; displaced users are notified.",
    emoji: "➕",
    parameters: [
      {
        name: "input",
        description:
          "Slot number(s) comma-separated, `random`, or `reserve`, optionally followed by @user",
        required: true,
      },
      {
        name: "char",
        description: "Character name to show beside the signup",
        required: false,
      },
      {
        name: "tbc",
        description: "Mark the signup as TBC (default: false)",
        required: false,
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
        description:
          "Second slot number, random open slot, or reserve (required if you have multiple signups)",
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
        description:
          "Slot or reserve number (defaults to your own slot/reserve)",
        required: false,
      },
    ],
  },
  {
    name: "/removecharnote",
    description: "Remove character notes (alias: /rc)",
    emoji: "🗑️",
    parameters: [
      {
        name: "input",
        description:
          "Slot or reserve number(s) comma-separated (blank removes all your character notes)",
        required: false,
      },
    ],
  },
  {
    name: "/tbc",
    description:
      "Toggle To Be Confirmed (TBC) status on slot(s), reserve(s), or yourself",
    emoji: "❓",
    parameters: [
      {
        name: "input",
        description:
          "Slot or reserve number(s) comma-separated (blank toggles your own TBC status)",
        required: false,
      },
    ],
  },
  {
    name: "/removetbc",
    description:
      "Remove TBC markings from slot(s), reserve(s), or yourself (alias: /rtbc)",
    emoji: "✅",
    parameters: [
      {
        name: "input",
        description:
          "Slot or reserve number(s) comma-separated (blank removes your own TBC status)",
        required: false,
      },
    ],
  },
  {
    name: "/name",
    description: "Set the run title and post a public action notice",
    emoji: "✏️",
    parameters: [{ name: "input", description: "Run name", required: true }],
  },
  {
    name: "/note",
    description:
      "Edit important notes and post a public action notice; reply with `remove` as your next message to clear them",
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
    description: "Set up to two configured instance types for this run",
    emoji: "🏷️",
    parameters: [
      {
        name: "type",
        description:
          "Comma-separated instance names, e.g. Endless Tower, Endless Cellar; at most two types. Autocomplete preserves previous selections. None clears the selection; empty comma entries are ignored. Setup also supports selecting multiple types, up to two. Legacy saved selections are unchanged until submitted.",
        required: true,
      },
    ],
  },
  {
    name: "/postpone",
    description:
      "Shift the run's date/time later without touching the roster and post a public action notice",
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
    description:
      "Shift the date/time, clear the roster for a fresh run, and post a public action notice",
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
    description:
      "Set the run to now, optionally offset by a duration, and post a public action notice",
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
    description:
      "Set the date and time, or `TBD` to clear it, then post a public action notice",
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
    name: "/changesharevendor",
    summary: "Set the vendor on a payout post, or enter n/a or none.",
    description:
      "In a bot-generated thread in the configured payout forum, set the vendor name, `n/a`, or `none`. Managed exports in a configured worksheet also update only the vendor cell; balances, formulas and spacer columns stay unchanged. Repeat the same value to retry a failed sync. Sheets failures preserve the Discord edit and ask you to update Google Sheets manually. Older exports are not linked by guessing.",
    emoji: "🏷️",
    parameters: [
      {
        name: "vendor",
        description: "Vendor name, n/a, or none",
        required: true,
      },
    ],
  },
  {
    name: "/changeshareparticipants",
    summary:
      "Copy, edit, and paste a payout roster; count and access update automatically.",
    description:
      "In a bot-generated thread in the configured payout forum, copy the roster from the prompt, edit its party and Discord mention lines, then send it as your next message in that thread. The bot counts unique mentions and adds or removes thread members to match. Managed exports update pending purple shares and saved vending membership, preserving totals and reimbursements. Ready/distributed shares require manual sheet updates. Existing lifetime entries are kept; edits add no spacer columns. Review and adjust default cell formulas if needed. Sheets failures preserve the Discord edit and ask you to update Google Sheets manually.",
    emoji: "👥",
  },
  {
    name: "/export",
    summary:
      "Export confirmed slots to the payout forum with vendor and optional split posts (organizer only).",
    description:
      "Export confirmed slots to the payout forum (organizer only). Set /sdt first. No reserves/TBC. Once per title and full date across combined and split exports; IDs check active/archived posts. DD/MM with instance emojis; custom emoji markup stays in the roster. Keeps party headings, consecutive numbering, Participants and timestamps. Interrupted exports recheck the forum. Missing split parts can be retried; replies are public and retain links to completed posts. Worksheets use payoutWorksheets. Reuse an empty run column; insert before Unclaimed when full. Add one blank column per entry (two for a two-part split), copying only row 9 formatting. Purple shares start with zero totals/reimbursements. Default cell formulas must be reviewed and adjusted if needed. Sheets failures keep Discord successful: update Google Sheets manually. Retries reuse saved input without duplicate columns; older exports require manual linking.",
    emoji: "📤",
    parameters: [
      {
        name: "vendor",
        description: "Vendor name(s), or none",
        required: true,
      },
      {
        name: "split",
        description:
          "Create one post per instance type. Fewer than two types produces one post with an explanatory note. Use combined mode when both lineups are the same.",
        required: false,
      },
      {
        name: "second-vendor-name",
        description: "Vendor for the second split post; defaults to vendor",
        required: false,
      },
      {
        name: "first-run-absent-slots",
        description:
          "Comma-separated original signup slot numbers absent from run one. Split: exclude only from the first post. Combined: exclude all specified absences.",
        required: false,
      },
      {
        name: "second-run-absent-slots",
        description:
          "Original signup slot numbers absent from run two. Split: exclude only from the second post. Combined: exclude all specified absences.",
        required: false,
      },
    ],
  },
  {
    name: "/ping",
    description:
      "Send up to 500 characters to signup participants in the channel or by direct message. Channel pings split large recipient lists into messages within Discord's content limit. DM delivery acknowledges first, then confirms success and any failures.",
    emoji: "📣",
    parameters: [
      {
        name: "message",
        description: "Message to send (maximum 500 characters)",
        required: true,
      },
      {
        name: "which",
        description:
          "Who to ping (Main Roster, Reserves, TBC, All; defaults to Main Roster)",
        required: false,
      },
      {
        name: "where",
        description:
          "Where to send it (Channel or Direct Message; defaults to Channel)",
        required: false,
      },
    ],
  },
  {
    name: "/swaporganizer",
    description: "Change the organizer and post a public action notice",
    emoji: "👑",
    parameters: [
      { name: "user", description: "New organizer", required: true },
    ],
  },
  {
    name: "/show",
    summary: "Show this channel's signup sheet (aliases: /last, /s)",
    description:
      "Show this channel's signup sheet with current action buttons (aliases: /last, /s). Refresh older sheets to remove the obsolete Export button; use /export with a vendor instead.",
    emoji: "👁️",
  },
  {
    name: "/help",
    description: "Display help for a command",
    emoji: "ℹ️",
    parameters: [
      {
        name: "command",
        description:
          "Choose a command; autocomplete matches command names as you type",
        required: true,
      },
    ],
  },
];
