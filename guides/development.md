# Development

[README](../README.md) | [Setup and Deployment](setup.md) | [Commands](commands.md) | [Payouts and Sheets](payouts.md) | [Guild Schedules](schedules.md) | [Signup Sheets](signup-sheets.md) | [Development](development.md)

## Project Layout 🧱

```text
src/
├── config/
│   └── discord-settings.ts
├── index.ts
├── deploy-commands.ts
├── commands/
│   ├── guildsched.command.ts
│   ├── help.command.ts
│   ├── index.ts
│   ├── mycooldowns.command.ts
│   ├── mysched.command.ts
│   ├── payout-summary.command.ts
│   ├── payout.command.ts
│   └── signup.command.ts
├── constants/
│   ├── cooldowns.ts
│   └── index.ts
├── services/
│   ├── google-sheets.service.ts
│   ├── guild-schedule-announcement.service.ts
│   ├── guild-schedule.service.ts
│   ├── payout.service.ts
│   └── signup-sheet.service.ts
├── templates/
│   ├── cooldowns.template.ts
│   ├── guild-schedule.template.ts
│   ├── payout.template.ts
│   └── signup-sheet.template.ts
├── types/
│   ├── command.ts
│   ├── cooldowns.ts
│   ├── discord-settings.ts
│   ├── google-sheets.ts
│   ├── guild-schedule.ts
│   ├── interaction-context.ts
│   ├── payout.ts
│   └── signup-sheet.ts
└── utils/
    ├── cooldowns.ts
    ├── format-zeny.ts
    ├── guild-members.ts
    ├── guild-schedule.ts
    ├── interaction-context.ts
    ├── logger.ts
    ├── payout-embed.ts
    ├── payout-sheet.ts
    ├── payout-summary.ts
    ├── server-timestamp.ts
    └── signup-sheet.ts
```

## Scripts 📜

- `npm run dev` runs the bot with `tsx watch`.
- `npm run build` compiles TypeScript to `dist/`.
- `npm start` runs the compiled bot.
- `npm run deploy-commands` registers `/help`, `/mysched`, and `/mycooldowns` globally and guild-specific payout and schedule commands in their configured guilds.
- `npm run retrofit:cooldown-initials -- --dry-run` previews inferred cooldown initials; omit `--dry-run` to save. After building, use `npm run retrofit:cooldown-initials:dist -- --dry-run`. Settings default to `private/guild-settings` under the working directory; `--directory /absolute/path/to/private/guild-settings` overrides that path.
- `npm run migrate:signup-exports -- --dry-run` previews legacy pending-thread imports; omit `--dry-run` to save them. After building, use `npm run migrate:signup-exports:dist -- --dry-run` for the compiled script. `--root /absolute/path/to/bot` selects the bot root containing `.env` and `private/`; `--directory /absolute/path/to/signup-exports` overrides the destination history directory.
- `npm test` runs the Jest unit tests.
- `npm run test:coverage` runs Jest with coverage output for payout services and utilities.
- `npm run docs` generates TypeDoc HTML reference pages in `docs/`.
- (On hosting before running script) `/opt/cpanel/ea-nodejs22/bin/node deploy-commands.js`
- (On hosting) `nohup /opt/cpanel/ea-nodejs22/bin/node index.js & disown`

Ensure `.env`, `private/discord_settings.json`, `private/guild_schedule_settings.json`, the relevant `private/guild-settings/<guild-id>.json` files, and the Google service-account JSON are present before starting the bot.

### Running Migrations on Hosting

By default, run migrations from the deployed bot root containing `.env` and `private/`, not from its `scripts/` directory. If the contents of `dist/` are uploaded directly into the bot root, the scripts live under `scripts/` rather than `dist/scripts/`. After rebuilding and uploading the updated JavaScript, preview migrations with:

```sh
cd /home/bd926c5/botbito-discord
/opt/cpanel/ea-nodejs22/bin/node scripts/retrofit-cooldown-initials.js --dry-run
/opt/cpanel/ea-nodejs22/bin/node scripts/migrate-signup-exports.js --dry-run
```

Omit `--dry-run` after reviewing the output; stop the bot before applying either migration. To run the cooldown migration from another working directory, pass `--directory /home/bd926c5/botbito-discord/private/guild-settings`. A missing settings directory is an error; the script does not create an empty replacement. For the signup-export migration, pass `--root /home/bd926c5/botbito-discord` when invoking it from another directory. The script switches to that root before loading `.env` and Discord settings, and logs the resolved root and history directory. Its optional `--directory` overrides only the signup-export history destination, not the configuration location; relative overrides resolve under the selected root.

### Legacy Payout Thread Migration

Stop the bot before applying this one-time migration to avoid concurrent writes to export history. Run from the project root with `DISCORD_TOKEN` in `.env` and the normal Discord settings files present. Google credentials are not needed for the migration. The bot needs View Channel and Read Message History in each payout forum, with Message Content Intent enabled in the Discord Developer Portal to read legacy roster text.

```sh
npm run migrate:signup-exports -- --dry-run
npm run migrate:signup-exports
```

The script scans only guilds in `payoutGuildIds` with a configured `payoutSheetChannelId`. It validates that each channel is a forum belonging to that guild, then imports only its active, unarchived threads whose current titles contain `⏳` and do not contain `NO SHARE` (case-insensitive). Archived threads are not scanned or unarchived. All message pages are read, including message text and embed titles, descriptions, fields, and footer text, so older split rosters can establish participation for `/payout` using exact `<@ID>` mentions.

Results are merged into `private/signup-exports/<guild-id>.json`. Existing records and nonempty contents are preserved; matching thread IDs with missing or empty contents are backfilled. Newly discovered threads use stable `["legacy-thread","<thread-id>"]` keys instead of guessing dates from old titles. Repeat runs do not duplicate records. Before replacing an existing file, the script preserves its original bytes in a non-overwriting `.json.migration.bak` backup, then writes the updated JSON through a temporary file and atomic rename. Missing export files are created when there are qualifying imports; dry runs create no files or backups.

All guild scans and JSON validation finish before any writes begin. Access failures, unreadable message history, invalid configuration/history, or pending threads with no readable text abort the scan rather than saving incomplete results. Filesystem write failures can still leave earlier guilds updated; fix the failure and rerun. Restart the bot after applying the migration. `/payout` continues using stored contents for participation and fresh Discord titles for vending status; it does not scan forum history on every invocation.

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
