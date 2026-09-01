# Botbito Discord Bot 🤖

TypeScript Discord bot scaffolding built with `discord.js` and `googleapis`. No bot logic has been implemented yet — `src/index.ts` is currently empty.

## Project Layout 🧱

```text
src/
└── index.ts
```

## Environment ⚙️

Environment variables are loaded with `dotenv` from `.env`:

- `NODE_ENV` - runtime environment, defaults to `development`
- `DISCORD_TOKEN` - Discord bot token
- `DISCORD_CLIENT_ID` - Discord application client ID
- `GOOGLE_APPLICATION_CREDENTIALS` - path to Google service account credentials JSON
- `GOOGLE_SHEETS_ID` - target Google Sheets spreadsheet ID

## Scripts 📜

- `npm run dev` - run `src/index.ts` with `tsx watch`
- `npm run build` - compile TypeScript to `dist/`
- `npm start` - run the compiled bot from `dist/index.js`
- `npm test` - run Jest tests
- `npm run test:coverage` - run Jest tests with coverage report
