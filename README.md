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
MODE=DEV
ENABLE_GUILD_SCHEDULE_ANNOUNCEMENTS=false
```

`GOOGLE_APPLICATION_CREDENTIALS` must point to a Google service-account JSON file. Store that file under `private/`; the directory is excluded from Git. Grant the service account's `client_email` Viewer access to the spreadsheet.

Set `PEPEMONEYRAIN_EMOJI_ID` to the custom animated Discord emoji ID used beside the Claimable payout balance. Use the emoji ID available in the Discord server where the bot is running.

When running `npm run dev` with `MODE=DEV`, automatic guild schedule announcements are disabled unless `ENABLE_GUILD_SCHEDULE_ANNOUNCEMENTS=true` is set in `.env`. This toggle does not affect non-DEV environments, where the listener is always registered.

Create `private/discord_settings.json` to configure the payout guilds, guild schedule sources, and the payout contact:

```json
{
  "payoutGuildIds": ["guild-id"],
  "payoutToPingId": "discord-user-id",
  "payoutToPingTag": "discord-user-tag",
  "guildScheduleBotId": "schedule-bot-user-id",
  "guildIcons": {
    "PROD": {
      "guild-id": "<:guildIcon_name:emoji-id>"
    },
    "DEV": {
      "guild-id": "<:guildIcon_name:emoji-id>"
    }
  },
  "guildScheduleSourceByGuild": {
    "guild-id": {
      "categoryIds": ["schedule-category-id", "other-category-id"],
      "scheduleTextChannelIds": ["public-schedule-channel-id"],
      "excludedChannelIds": ["private-signup-channel-id"],
      "roleRestrictedChannels": {
        "restricted-channel-id": "required-role-id"
      }
    }
  }
}
```

Enable the **Server Members Intent** and **Message Content Intent** in the Discord Developer Portal for the bot application. `/payoutsummary` uses the Server Members Intent to resolve Discord display names from the sheet's Discord tags. The Message Content Intent allows automatic schedule announcements to read schedule embeds from guild message events. The client also enables the `Message` and `Channel` partials so edits to schedule messages still emit `messageUpdate` after they age out of the client's cache (e.g. following a bot restart); without these, discord.js silently drops update events for uncached messages.

## Commands 💬

`/help` ℹ️ displays a private guide to available commands with descriptions, parameters, and usage for each command. Each command is labeled with its associated emoji for quick recognition.

`/payout` 💰 displays the command user's Pending, Share Ready, and Distributed balances in zeny (`z`). It is available in every channel of configured payout guilds. When the user has no non-zero payout balance, it instead displays a message that they are not on the list. The optional `sendprivately` parameter sends the response ephemerally; it is public by default.

`/payoutsummary` 📄 displays every non-zero payout and its total for the calling server. It is available in every channel of configured payout guilds. The optional `amount` parameter selects `Share Ready` (default), `Pending`, or `Distributed`. The optional `sendprivately` parameter sends the response ephemerally; it is public by default. Each row shows the Discord guild display name and its right-aligned zeny balance. It uses the Server Members Intent to resolve display names from the sheet's Discord tags. The optional `sort` parameter supports `Name` and `Amount`; the optional `direction` parameter supports `Ascending` and `Descending`. By default, payouts are sorted by the selected amount descending, with Name ascending as the tie-breaker. Share Ready summaries include the release description and distribution contact; Pending summaries use `Currently vending:` and Distributed summaries omit the description and distribution contact. When the configured payout contact invokes either payout command, the claim message adds `Oh wait, that's me! lol`.

`/guildsched` 🗓️ lists active runs from the configured guild schedule categories. It is available to all members of the guild. The bot includes only signup channels the invoking member can view and read, uses the newest active schedule per channel, and orders results earliest to latest. It checks the configured schedule bot's most recent 100 messages in each channel newest-first: replies without a `Your Time:` label, such as command confirmations and `Interaction cancelled`, are ignored; a newer schedule embed with `Your Time: TBD` clears that channel's older schedule. Every guild schedule output, including automatic announcements, includes four primary buttons: `My Sched` sends the clicking member's default `/mysched` result by DM, `My Payout Status` opens a private payout response, `My Cooldowns` opens private cooldown status, and `Help` opens the private command guide. Button success and failure logs record `button`, `buttonLabel`, status, guild, user, and the standard command context; button clicks log `parameters=[]`.

When a configured schedule bot posts or updates a schedule response in one of the configured `categoryIds` channels, the bot automatically refreshes every `scheduleTextChannelIds` channel. It deletes the existing announcement messages and posts a public announcement equivalent to `/guildsched public:true forannouncementonly:true`. The listener compares the newest schedule-bot response with the previous response, including `Your Time: TBD` and plain postpone responses, so new schedule-changing commands do not require code changes. A configured `scheduleTextChannelIds` channel is never treated as a source channel, even if it is placed in a configured category. Updates without a cached prior timestamp, such as partial `messageUpdate` payloads after a restart, are ignored for timestamp-based refreshes to prevent false announcements. Refresh logs include the `triggerReason`, source `triggerChannel`, current `triggerRunTitle`, and `previousChannelName` for channel renames.

The bot also refreshes announcements when a schedule response's run title (embed title) changes, or when a schedule source channel itself is renamed. Since these two triggers don't change the scheduled time, they only refresh the announcement when the run's previous title, or the channel's previous name, is currently present in the latest posted announcement; this avoids refreshing for runs that haven't been publicly announced yet. Title changes are detected on both edits and brand-new schedule-bot messages, since some schedule bots reply to a rename command with a new message instead of editing the previous one. Discord doesn't always cache a message's pre-edit content (e.g. after the bot restarts or the message ages out of cache), so when the previous title can't be read from the edit event, or there is no previous message at all, the bot instead compares the new title against the title currently announced for that schedule channel.

Automatic announcements identify the latest updated run with the following format:

```text
schedule automatically updated from the latest update in:
<run-title>
```

Manually invoked `/guildsched` announcements continue to identify the command user.

Each schedule links to the run and its actual signup channel. The output groups runs where the member is signed up or reserve before runs where they are not signed up. `📝` marks a standard signup and `🪑` marks a reserve slot. Character notes from signup entries (e.g., "alt character", "reserve slot") are displayed next to the status indicator when present. The embed notes the category from which signup channels are shown and mentions the invoking member.

Use `/guildsched public:true` to post the schedule embed for everyone in the current channel. Without the option, the response is private. When posting publicly, role-restricted channels are displayed with a "(Private run)" label in the run title instead of a direct link, omitting the channel name. Add `forannouncementonly:true` with `public:true` to create a neutral announcement: it omits the Signed Up / Reserve and Not Signed Up headings, status indicators, and character notes while retaining each run's title and time. `forannouncementonly` has no effect unless `public:true` is also set.

`/mysched` ⌚ sends the invoking user a DM with their upcoming signed-up and reserve schedules across all configured schedule guilds the bot and user can access. It can be used in any server channel where the bot can see the command, or directly in a DM with the bot after global command registration is deployed.

The command only includes schedules where the member is signed up or listed as reserve. Each entry shows the configured guild icon, guild name, linked schedule title, time, source channel, and signup/reserve indicator. Future schedule titles use `🗓️`; completed schedule titles use `✅`. The optional `grouping` parameter supports `By Date`, `By Guild`, and `By Instance Type`; `By Date` is the default, `By Guild` uses larger guild headings, and `By Instance Type` groups schedules by the detected instance keywords in their titles.

Use `/mysched thisweekonly:true` to show all signed-up/reserve runs from the current schedule week, including completed runs, and hide runs outside that week. When a channel has a newer scheduled reply outside the week, its earlier in-week run remains included; only `Your Time: TBD` clears an older run. Schedule weeks start every Monday at `06:00 GMT` (`T06:00:00Z`) and run through Sunday. When this option is enabled, the DM embed title changes to the covered date range, for example `Your Schedule - 31 Aug to 06 Sept`.

`/mycooldowns` 🔥 shows the invoking user's weekly cooldown status from signup sheets across all configured schedule guilds. It counts every signed-up/reserve run inside the current schedule week, including completed runs, as an attempt toward cooldown limits for that instance type. A newer scheduled reply outside the week does not hide an earlier in-week run; `Your Time: TBD` clears it. Guild responses are private by default; use `/mycooldowns showinpublic:true` to display the result to everyone in the current channel. The command can also be used in a DM with the bot.

The cooldown display groups runs by instance type with their current attempt count and maximum attempts. Instance types are identified by keywords in signup sheet titles (e.g., `ET` for Endless Tower, `EC` for Endless Cellar, `EB` for Eternal Bastion). When a signup sheet title contains multiple instance keywords (e.g., `ET EC speedrun`), it counts toward both instance types.

Some instances support multipliers from the signup sheet title:

- **Eternal Bastion (EB)**: Multiplier extracted from title (e.g., `EB 2x` counts as 2 attempts)
- **Horror Toy Factory (HTF)**: Multiplier extracted from title (e.g., `HTF 3x` counts as 3 attempts)
- **Sealed Shrine**: Multiplier extracted from title (e.g., `Sealed Shrine 4x`) or defaults to 4 attempts if title contains `(minimum 2-3 runs)`

Other instances (Endless Tower, Endless Cellar, Wolfchev's Laboratory) count as 1 attempt each, regardless of title text. Unrecognized signup sheets are grouped under "Others."

The embed title shows the covered schedule week date range (e.g., `Your Attempts - 04 Sep to 10 Sep`). A disclaimer notes which guild schedules were counted, reminding users that signups from outside those guilds cannot be included. Each instance type includes an emoji identifier for quick visual recognition.

**Public output behavior:**

- When invoked in a role-restricted channel: Only displays that channel's schedules if the user has the required role. Otherwise, displays only non-restricted channels.
- When invoked in a non-restricted channel: Displays only non-restricted channels (all role-restricted channels are excluded).
- Private output can include all accessible channels regardless of role restrictions.

Both payout commands are available in every channel of the guilds listed in `payoutGuildIds` in `private/discord_settings.json`. Both payout commands are public by default and support `sendprivately:true` for an ephemeral response. The summary and individual payout embeds use the configured payout contact when a Share Ready payout is available.

The bot registers payout and guild schedule commands separately in each permitted guild on startup and whenever it joins a guild. This avoids the delay associated with global command propagation for guild-only commands. `/help`, `/mysched`, and `/mycooldowns` are registered only globally, so they are not duplicated by guild-specific registration. `/mysched` and `/mycooldowns` are also explicitly enabled for bot DMs, so Discord may take time to show them after deployment.

After changing command options, run `npm run deploy-commands` to update the registered commands in Discord. Changes to global commands such as `/mysched` may take longer to appear than guild-scoped command changes.

## Payout Sheet 📊

Payout data is read from the `Combined` sheet over the `A:ZZ` range.

- Row 1 contains guild IDs, each marking the start of that guild's payout columns.
- Row 2 contains the payout headers: `Pending`, `Share Ready`, and `Distributed`.
- Column A contains Discord tags, such as `@username`.

For `/payout`, the bot finds the matching Discord tag in column A, selects the status columns belonging to the server where the command was run, and displays those three values. Empty or invalid cells are treated as `0 z`.

For `/payoutsummary`, the bot selects that guild's `Pending`, `Share Ready`, or `Distributed` column according to the `amount` parameter, includes every non-zero row, calculates the displayed total, and applies the requested sorting options.

## Guild Schedule Format 📅

Schedule embeds are posted by the configured `guildScheduleBotId` bot in signup channels. Each entry's format determines how the bot displays signup and reserve information.

An active schedule must include a Discord timestamp in this form:

```plain
Your Time: <t:unix-seconds:F>
```

The Discord client renders that timestamp as a localized date and time. `Your Time: TBD` explicitly clears the channel's previous schedule. Other schedule-bot replies without a `Your Time:` label do not replace an active schedule.

Signup entries use this format:

```plain
- **DisplayName** (character note)
```

Reserve entries use this format:

```plain
Reserve - **DisplayName** (character note)
```

Any text between `Reserve` and the dash is supported, for example `Reserve (late signup) - **DisplayName**`.

The character note is optional and displayed in parentheses. Examples:

- `- **PlayerName** (alt)` → displays as "📝 - alt"
- `Reserve - **PlayerName** (wallet)` → displays as "🪑 - wallet"
- `- **PlayerName**` → displays as "📝 " (no note)

The bot extracts the note text and displays it alongside the status indicator (📝 for signups, 🪑 for reserves) in the `/guildsched` command output.

## Role-Restricted Guild Schedule Channels 🔐

Certain schedule channels can be restricted to users with specific Discord roles. This is useful for private or elite signup channels.

When a member views a role-restricted channel privately, they only see it if they have the required role. When posting publicly with `/guildsched public:true`, role-restricted channels are displayed with a "(Private run)" label in the run title instead of a direct link, allowing authorized members to see private runs while others can see they exist without accessing their details.

Configure role-restricted channels in `private/discord_settings.json`:

```json
"guildScheduleSourceByGuild": {
  "guild-id": {
    "categoryIds": ["schedule-category-id"],
    "scheduleTextChannelIds": ["public-schedule-channel-id"],
    "roleRestrictedChannels": {
      "restricted-channel-id": "required-role-id",
      "another-restricted-channel-id": "another-required-role-id"
    }
  }
}
```

**Access Control Behavior:**

- **Private schedules** (`/guildsched` without `public:true`): All accessible channels are shown. Role-restricted channels only appear if the user has permission to view them in Discord.
- **Public schedules** (`/guildsched public:true`): All accessible channels are shown with these differences for role-restricted channels:
  - Role-restricted schedules you have access to are displayed with a **(Private run)** label in the title (no clickable link to the channel).
  - Role-restricted schedules you cannot access are not shown.

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
│   ├── mysched.command.ts
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
    ├── guild-schedule.ts
    ├── interaction-context.ts
    ├── logger.ts
    ├── payout-embed.ts
    ├── payout-sheet.ts
    └── payout-summary.ts
```

## Scripts 📜

- `npm run dev` runs the bot with `tsx watch`.
- `npm run build` compiles TypeScript to `dist/`.
- `npm start` runs the compiled bot.
- `npm run deploy-commands` registers `/help`, `/mysched`, and `/mycooldowns` globally and guild-specific payout and schedule commands in their configured guilds.
- `npm test` runs the Jest unit tests.
- `npm run test:coverage` runs Jest with coverage output for payout services and utilities.
- `npm run docs` generates TypeDoc HTML reference pages in `docs/`.
- (On hosting before running script) `/opt/cpanel/ea-nodejs22/bin/node deploy-commands.js`
- (On hosting) `nohup /opt/cpanel/ea-nodejs22/bin/node index.js & disown`

Ensure `.env`, `private/discord_settings.json`, and the Google service-account JSON are present in `private/` before starting the bot.

## Git Hooks 🪝

Husky installs a pre-commit check when dependencies are installed. Every commit runs `npm run test:coverage && npm run build && npm run docs` in that order. The commit is blocked if unit tests fail, global coverage falls below 80%, TypeScript does not compile, or documentation generation fails.

## Testing 🧪

Jest unit tests are co-located with the modules they cover. The current suite verifies command permission and reply flows, zeny formatting, payout-sheet parsing and tag matching, guild-member display-name resolution, interaction context extraction, embed footer construction, payout service mapping, character note extraction from schedule entries, schedule embed formatting with character notes, personal schedule DM formatting and grouping, schedule week utility behavior, `/mysched` direct-DM command metadata, and role-based channel access control for public guild schedules. Google Sheets and Discord API boundaries are mocked, so tests do not read credentials or make external API calls.

`npm run test:coverage` enforces at least 80% global branch, function, line, and statement coverage.

## Documentation 📚

Public bot services, interaction helpers, schedule helpers, logging utilities, and embed builders use JSDoc-style comments. The shared logger adds the process ID and server timestamp to informational, warning, and error messages while preserving additional error arguments. Generate the browsable TypeScript reference with:

```bash
npm run docs
```

The generated `docs/` directory is excluded from Git; keep the source comments current when public behavior changes.
