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
```

`GOOGLE_APPLICATION_CREDENTIALS` must point to a Google service-account JSON file. Store that file under `private/`; the directory is excluded from Git. Grant the service account's `client_email` Viewer access to the spreadsheet.

Enable the **Server Members Intent** in the Discord Developer Portal for the bot application. `/payoutsummary` uses it to resolve Discord display names from the sheet's Discord tags.

## Commands 💬

`/help` 📖 displays a private guide to available commands.

`/payout` 💰 displays the command user's Pending, Share Ready, and Distributed balances in zeny (`z`). When the user has no non-zero payout balance, it instead displays a message that they are not on the list.

`/payoutsummary` 📊 displays every non-zero Share Ready payout and its total for the calling server. Each row shows the Discord guild display name and its right-aligned zeny balance. It uses the Server Members Intent to resolve display names from the sheet's Discord tags.

Both payout commands are available only in the following server channels:

| Guild ID              | Allowed channel        |
| --------------------- | ---------------------- |
| `499171225046876170`  | <#1470361558893723710> |
| `92073842977030144`   | <#1465658706711547946> |
| `1115484031455346718` | <#1115484031455346721> |

Using a payout command elsewhere in one of those servers returns an ephemeral message with a link to its allowed channel. The summary and individual payout embeds ask members to contact <@92073343238279168> when a Share Ready payout is available.

The bot registers payout commands separately in each permitted guild on startup and whenever it joins a guild. This avoids the delay associated with global command propagation. `/help` is registered globally; payout commands are not registered outside the allowlist.

## Payout Sheet 📊

Payout data is read from the `Combined` sheet over the `A:ZZ` range.

- Row 1 contains guild IDs, each marking the start of that guild's payout columns.
- Row 2 contains the payout headers: `Pending`, `Share Ready`, and `Distributed`.
- Column A contains Discord tags, such as `@username`.

For `/payout`, the bot finds the matching Discord tag in column A, selects the status columns belonging to the server where the command was run, and displays those three values. Empty or invalid cells are treated as `0 z`.

For `/payoutsummary`, the bot selects that guild's `Share Ready` column, includes every non-zero row, and calculates the displayed total.

## Project Layout 🧱

```text
src/
├── index.ts
├── deploy-commands.ts
├── commands/
│   ├── help.command.ts
│   ├── index.ts
│   ├── payout.command.ts
│   └── payout-summary.command.ts
├── constants/
│   └── index.ts
├── services/
│   ├── google-sheets.service.ts
│   └── payout.service.ts
├── templates/
│   └── payout.template.ts
├── types/
│   ├── command.ts
│   ├── google-sheets.ts
│   ├── interaction-context.ts
│   └── payout.ts
└── utils/
    ├── format-zeny.ts
    ├── guild-members.ts
    ├── interaction-context.ts
    ├── payout-embed.ts
    └── payout-sheet.ts
```

## Scripts 📜

- `npm run dev` runs the bot with `tsx watch`.
- `npm run build` compiles TypeScript to `dist/`.
- `npm start` runs the compiled bot.
- `npm run deploy-commands` registers `/help` globally and payout commands in their configured guilds.
- `npm test` runs Jest tests.
- `npm run test:coverage` runs Jest with coverage output.
- On hosting, run `npm run build` once, then start the bot with `npm start`.

make sure .env and private/ folders are present
