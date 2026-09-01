# Botbito Discord Bot 🤖

TypeScript Discord bot built with `discord.js` and `googleapis`.

## Project Layout 🧱

```text
src/
├── index.ts
├── deploy-commands.ts
├── commands/
│   ├── index.ts
│   ├── payout.command.ts
│   └── help.command.ts
├── services/
│   └── payout.service.ts
├── templates/
│   └── payout.template.ts
└── types/
    └── command.ts
```

## Environment ⚙️

Environment variables are loaded with `dotenv` from `.env`:

- `DISCORD_TOKEN` - Discord bot token
- `DISCORD_CLIENT_ID` - Discord application client ID
- `GOOGLE_APPLICATION_CREDENTIALS` - path to Google service account credentials JSON
- `GOOGLE_SHEETS_ID` - target Google Sheets spreadsheet ID

## Commands 💬

- `/payout` - replies with an embed of the requesting user's payout details. Details are fetched via `getPayoutDetails` in [src/services/payout.service.ts](src/services/payout.service.ts) (currently a placeholder), and the embed is built from the template in [src/templates/payout.template.ts](src/templates/payout.template.ts).
- `/help` - replies with a guide of available commands. Update the `COMMAND_GUIDE` list in [src/commands/help.command.ts](src/commands/help.command.ts) whenever commands are added, removed, or changed.

## Scripts 📜

- `npm run dev` - run `src/index.ts` with `tsx watch`
- `npm run build` - compile TypeScript to `dist/`
- `npm start` - run the compiled bot from `dist/index.js`
- `npm run deploy-commands` - register global slash commands with Discord
- `npm test` - run Jest tests
- `npm run test:coverage` - run Jest tests with coverage report
