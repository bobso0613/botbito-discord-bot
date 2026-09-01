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

## Commands 💬

`/help` 📖 displays a private guide to available commands.

`/payout` 💰 displays the command user's Pending, Share Ready, and Distributed balances in zeny (`z`). It is available only in these guilds:

- `499171225046876170`
- `92073842977030144`
- `1115484031455346718`

The bot registers slash commands separately in each guild on startup and whenever it joins a guild. This avoids the delay associated with global command propagation. In guilds outside the allowlist, `/payout` is not registered; `/help` remains available.

## Payout Sheet 📊

Payout data is read from the `Combined` sheet over the `A:ZZ` range.

- Row 1 contains guild IDs, each marking the start of that guild's payout columns.
- Row 2 contains the payout headers: `Pending`, `Share Ready`, and `Distributed`.
- Column A contains Discord tags, such as `@username`.

For `/payout`, the bot finds the matching Discord tag in column A, selects the status columns belonging to the server where the command was run, and displays those three values. Empty, invalid, or unmatched cells are shown as `0 z`.

## Project Layout 🧱

```text
src/
├── index.ts
├── deploy-commands.ts
├── commands/
│   ├── help.command.ts
│   ├── index.ts
│   └── payout.command.ts
├── services/
│   ├── google-sheets.service.ts
│   └── payout.service.ts
├── templates/
│   └── payout.template.ts
├── types/
│   └── command.ts
└── utils/
    └── interaction-context.ts
```

## Scripts 📜

- `npm run dev` runs the bot with `tsx watch`.
- `npm run build` compiles TypeScript to `dist/`.
- `npm start` runs the compiled bot.
- `npm run deploy-commands` registers unrestricted commands globally and guild-restricted commands in their configured guilds.
- `npm test` runs Jest tests.
- `npm run test:coverage` runs Jest with coverage output.
