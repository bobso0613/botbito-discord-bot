# Botbito Discord Bot 🤖

TypeScript Discord bot built with `discord.js` and `googleapis`. It provides payout information from a Google Sheet and a private command guide.

## Setup ⚙️

Install dependencies:

```bash
npm install
```

Configure `.env`:

```dotenv
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
GOOGLE_APPLICATION_CREDENTIALS=./private/service-account.json
GOOGLE_SHEETS_ID=
PEPEMONEYRAIN_EMOJI_ID=
```

`GOOGLE_APPLICATION_CREDENTIALS` must point to a Google service-account JSON file. Store that file under `private/`; the directory is excluded from Git. Grant the service account's `client_email` Viewer access to the spreadsheet.

Set `PEPEMONEYRAIN_EMOJI_ID` to the custom animated Discord emoji ID used beside the Claimable payout balance. Use the emoji ID available in the Discord server where the bot is running.

Create `private/discord_settings.json` to configure payout command channels, guild schedule sources, and the payout contact:

```json
{
  "payoutChannelByGuild": {
    "guild-id": "channel-id"
  },
  "payoutToPingId": "discord-user-id",
  "payoutToPingTag": "discord-user-tag",
  "guildScheduleBotId": "schedule-bot-user-id",
  "guildScheduleSourceByGuild": {
    "guild-id": {
      "categoryId": "schedule-category-id",
      "allowedCommandChannelIds": ["optional-extra-command-channel-id"],
      "excludedChannelIds": ["private-signup-channel-id"],
      "roleRestrictedChannels": {
        "restricted-channel-id": "required-role-id"
      }
    }
  }
}
```

Enable the **Server Members Intent** in the Discord Developer Portal for the bot application. `/payoutsummary` uses it to resolve Discord display names from the sheet's Discord tags.

## Commands 💬

`/help` ℹ️ displays a private guide to available commands with descriptions, parameters, and usage for each command. Each command is labeled with its associated emoji for quick recognition.

`/payout` 💰 displays the command user's Pending, Share Ready, and Distributed balances in zeny (`z`). When the user has no non-zero payout balance, it instead displays a message that they are not on the list.

`/payoutsummary` 📄 displays every non-zero Share Ready payout and its total for the calling server. Each row shows the Discord guild display name and its right-aligned zeny balance. It uses the Server Members Intent to resolve display names from the sheet's Discord tags. The optional `sort` parameter supports `Name` and `Share Ready amount`; the optional `direction` parameter supports `Ascending` and `Descending`. By default, payouts are sorted by Share Ready amount descending, with Name ascending as the tie-breaker.

`/guildsched` 🗓️ lists active runs from the configured guild schedule category. It is available in that category's text channels and any configured `allowedCommandChannelIds`; anyone who can use those channels can run the command. The bot includes only signup channels the invoking member can view and read, uses the newest active schedule per channel, and orders results earliest to latest.

Each schedule links to the run and its actual signup channel. The output groups runs where the member is signed up or reserve before runs where they are not signed up. `📝` marks a standard signup and `🪑` marks a reserve slot. Character notes from signup entries (e.g., "alt character", "reserve slot") are displayed next to the status indicator when present. The embed notes the category from which signup channels are shown and mentions the invoking member.

Use `/guildsched public:true` to post the schedule embed for everyone in the current channel. Without the option, the response is private.

**Public output behavior:**

- When invoked in a role-restricted channel: Only displays that channel's schedules if the user has the required role. Otherwise, displays only non-restricted channels.
- When invoked in a non-restricted channel: Displays only non-restricted channels (all role-restricted channels are excluded).
- Private output can include all accessible channels regardless of role restrictions.

Both payout commands are available only in the guild-to-channel mappings configured in `private/discord_settings.json`.

Using a payout command elsewhere in an allowed server returns an ephemeral message with a link to its configured channel. The summary and individual payout embeds use the configured payout contact when a Share Ready payout is available.

The bot registers payout and guild schedule commands separately in each permitted guild on startup and whenever it joins a guild. This avoids the delay associated with global command propagation. `/help` is registered globally; guild-specific commands are not registered outside their allowlists.

After changing payout command options, run `npm run deploy-commands` to update the registered guild commands in Discord.

## Payout Sheet 📊

Payout data is read from the `Combined` sheet over the `A:ZZ` range.

- Row 1 contains guild IDs, each marking the start of that guild's payout columns.
- Row 2 contains the payout headers: `Pending`, `Share Ready`, and `Distributed`.
- Column A contains Discord tags, such as `@username`.

For `/payout`, the bot finds the matching Discord tag in column A, selects the status columns belonging to the server where the command was run, and displays those three values. Empty or invalid cells are treated as `0 z`.

For `/payoutsummary`, the bot selects that guild's `Share Ready` column, includes every non-zero row, calculates the displayed total, and applies the requested sorting options.

## Guild Schedule Format 📅

Schedule embeds are posted by the configured `guildScheduleBotId` bot in signup channels. Each entry's format determines how the bot displays signup and reserve information.

Signup entries use this format:

```plain
- **DisplayName** (character note)
```

Reserve entries use this format:

```plain
Reserve - **DisplayName** (character note)
```

The character note is optional and displayed in parentheses. Examples:

- `- **PlayerName** (alt)` → displays as "📝 - alt"
- `Reserve - **PlayerName** (wallet)` → displays as "🪑 - wallet"
- `- **PlayerName**` → displays as "📝 " (no note)

The bot extracts the note text and displays it alongside the status indicator (📝 for signups, 🪑 for reserves) in the `/guildsched` command output.

## Role-Restricted Guild Schedule Channels 🔐

Certain schedule channels can be restricted to users with specific Discord roles. This is useful for private or elite signup channels that should only be visible to authorized members when posting publicly.

Configure role-restricted channels in `private/discord_settings.json`:

```json
"guildScheduleSourceByGuild": {
  "guild-id": {
    "categoryId": "schedule-category-id",
    "roleRestrictedChannels": {
      "restricted-channel-id": "required-role-id",
      "another-restricted-channel-id": "another-required-role-id"
    }
  }
}
```

**Access Control Behavior:**

- **Private schedules** (`/guildsched` without `public:true`): All accessible channels are shown, including role-restricted ones if the user can view them in Discord.
- **Public schedules** (`/guildsched public:true`):
  - If invoked in a role-restricted channel by a user with the required role: That channel's schedules are displayed along with non-restricted channels.
  - If invoked in a role-restricted channel by a user WITHOUT the required role: Only non-restricted channels are displayed.
  - If invoked in a non-restricted channel: Only non-restricted channels are displayed (all role-restricted channels are excluded).

## Project Layout 🧱

```text
src/
├── config/
│   └── discord-settings.ts
├── index.ts
├── deploy-commands.ts
├── commands/
│   ├── help.command.ts
│   ├── guildsched.command.ts
│   ├── index.ts
│   ├── payout.command.ts
│   └── payout-summary.command.ts
├── constants/
│   └── index.ts
├── services/
│   ├── google-sheets.service.ts
│   ├── guild-schedule.service.ts
│   └── payout.service.ts
├── templates/
│   ├── guild-schedule.template.ts
│   └── payout.template.ts
├── types/
│   ├── command.ts
│   ├── guild-schedule.ts
│   ├── google-sheets.ts
│   ├── interaction-context.ts
│   └── payout.ts
└── utils/
    ├── format-zeny.ts
    ├── guild-members.ts
    ├── interaction-context.ts
    ├── payout-embed.ts
    ├── payout-sheet.ts
    └── payout-summary.ts
```

## Scripts 📜

- `npm run dev` runs the bot with `tsx watch`.
- `npm run build` compiles TypeScript to `dist/`.
- `npm start` runs the compiled bot.
- `npm run deploy-commands` registers `/help` globally and guild-specific payout and schedule commands in their configured guilds.
- `npm test` runs the Jest unit tests.
- `npm run test:coverage` runs Jest with coverage output for payout services and utilities.
- `npm run docs` generates TypeDoc HTML reference pages in `docs/`.
- (On hosting) nohup /opt/cpanel/ea-nodejs22/bin/node index.js & disown

Ensure `.env`, `private/discord_settings.json`, and the Google service-account JSON are present in `private/` before starting the bot.

## Git Hooks 🪝

Husky installs a pre-commit check when dependencies are installed. Every commit runs `npm run test:coverage && npm run build && npm run docs` in that order. The commit is blocked if unit tests fail, global coverage falls below 80%, TypeScript does not compile, or documentation generation fails.

## Testing 🧪

Jest unit tests are co-located with the modules they cover. The current suite verifies command permission and reply flows, zeny formatting, payout-sheet parsing and tag matching, guild-member display-name resolution, interaction context extraction, embed footer construction, payout service mapping, character note extraction from schedule entries, schedule embed formatting with character notes, and role-based channel access control for public guild schedules. Google Sheets and Discord API boundaries are mocked, so tests do not read credentials or make external API calls.

`npm run test:coverage` enforces at least 80% global branch, function, line, and statement coverage.

## Documentation 📚

Public bot services, interaction helpers, and payout embed builders use JSDoc-style comments. Generate the browsable TypeScript reference with:

```bash
npm run docs
```

The generated `docs/` directory is excluded from Git; keep the source comments current when public behavior changes.
