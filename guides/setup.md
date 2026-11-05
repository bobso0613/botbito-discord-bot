# Setup and Deployment

[README](../README.md) | [Setup and Deployment](setup.md) | [Commands](commands.md) | [Payouts and Sheets](payouts.md) | [Guild Schedules](schedules.md) | [Signup Sheets](signup-sheets.md) | [Development](development.md)

## Runtime Error Recovery

Only the identified raw `ws` opening-handshake timeout is allowed to continue
after an uncaught exception. A single two-minute watchdog then verifies that
the gateway manager is not destroyed, has at least one shard, and every shard
has `Status.Ready`. The manager's own status can remain Ready during a shard
reconnect, so it is not used as proof of recovery. If a shard is reconnecting at
the two-minute deadline, the watchdog gives it two more checks five seconds
apart. Repeated timeouts do not extend the deadline or recheck period. If the
gateway remains unhealthy, the bot exits with code 1; production must run under
a supervisor configured to restart it.

All other uncaught exceptions remain fatal. There is intentionally no
`unhandledRejection` listener: with Node.js 22's default rejection policy,
unhandled rejections reach the exception handler with origin
`unhandledRejection` and exit with code 1. Do not deploy with a rejection policy
that only warns or ignores errors. Fatal diagnostics use synchronous stderr
writes before exit; this logger path must stay synchronous even if other log
transports change.

Initial presence is configured in the client options and sent as part of
gateway identification, rather than through an unawaited ready-time presence
broadcast. This does not claim recovery from arbitrary gateway-send failures.

## Setup ⚙️

Use Node.js 22 or newer, as declared in the package's `engines` field.

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

`GOOGLE_APPLICATION_CREDENTIALS` must point to a Google service-account JSON file. Store that file under `private/`; the directory is excluded from Git. `GOOGLE_SHEETS_ID` selects the spreadsheet. Grant the service account's `client_email` Editor access for export synchronization; Viewer access only supports payout reads.

Set `PEPEMONEYRAIN_EMOJI_ID` to the custom animated Discord emoji ID used beside the Claimable payout balance. Use the emoji ID available in the Discord server where the bot is running.

When running `npm run dev` with `MODE=DEV`, automatic guild schedule announcements are disabled unless `ENABLE_GUILD_SCHEDULE_ANNOUNCEMENTS=true` is set in `.env`. This toggle does not affect non-DEV environments, where the listener is always registered.

Create `private/discord_settings.json` to configure the payout guilds and payout contact:

```json
{
  "payoutGuildIds": ["guild-id"],
  "payoutToPingId": "discord-user-id",
  "payoutToPingTag": "discord-user-tag"
}
```

Create `private/guild_schedule_settings.json` for the schedule bots. Add the
external schedule bot and this bot's user ID during the transition:

```json
{
  "guildScheduleBotIds": ["external-schedule-bot-user-id", "this-bot-user-id"]
}
```

Create one `private/guild-settings/<guild-id>.json` file for each guild with schedules:

```json
{
  "payoutSheetChannelId": null,
  "guildScheduleSource": {
    "categoryIds": ["schedule-category-id", "other-category-id"],
    "scheduleTextChannelIds": ["public-schedule-channel-id"],
    "excludedChannelIds": ["private-signup-channel-id"],
    "roleRestrictedChannels": {
      "restricted-channel-id": "required-role-id"
    }
  },
  "guildIcons": {
    "PROD": "<:guildIcon_name:emoji-id>",
    "DEV": "<:guildIcon_name:emoji-id>"
  }
}
```

When the bot joins a guild, or on startup for any guild it has already joined,
it creates this file with empty schedule arrays and empty `DEV`/`PROD` icons if
it does not already exist. Members with the Administrator permission can
configure schedule sources with `/guildsetting set`: `tracked-category`,
`excluded-channels`, `schedule-channels`, and `role-restricted-channels`. The
matching `/guildsetting clear` subcommands clear each setting without requiring
a value. Channel values accept Discord channel links or `#channel-name`; role
restrictions use comma-separated `#channel=@role` mappings. `/guildsetting
show` displays the current settings for the invoking guild.

For guilds listed in `payoutGuildIds`, an administrator can configure the payout
forum with `/guildsetting set payout-channel-id channel:#payouts` using Discord's
channel picker or a channel mention.
The channel must be a forum in the same server. Its ID is saved as
`payoutSheetChannelId` in that guild's settings file and reloaded immediately.
The bot needs permission to view the forum, read message history, create posts (Send Messages), and
send messages in its threads. Forums that require tags must have that requirement
disabled before exporting.

Cooldown instance types are also stored per guild in `cooldownInstanceTypes` and
`multiplierInstanceTypes`. Administrators can add or update one type with
`/guildsetting set cooldown-instance-types` using the separate `name`,
`keywords`, `maxattempts`, and `emoji` options, plus optional `initials` (for
example `initials:ET`). A name that already exists is updated in place instead
of erroring. Omitting or leaving `initials` blank preserves the existing value;
new types without initials leave the field unset. `/guildsetting show` includes
configured initials beside each instance name. Use `/guildsetting remove
cooldown-instance-type` to remove a single type by name. Multiplier types are
still fully replaced with `/guildsetting set multiplier-instance-types` using
comma-separated instance names. The matching clear commands remove all
configured values for a setting. New guilds and the existing guild settings are
initialized from `src/constants/cooldowns.ts`.

To retrofit missing initials in existing `private/guild-settings/*.json` files:

```sh
npm run retrofit:cooldown-initials -- --dry-run
npm run retrofit:cooldown-initials
```

For production deployments, `npm run build` also emits the migration as
`dist/scripts/retrofit-cooldown-initials.js`. Run it with Node.js, without `tsx`
or the source files:

```sh
npm run build
npm run retrofit:cooldown-initials:dist -- --dry-run
npm run retrofit:cooldown-initials:dist
```

The equivalent direct command is
`node dist/scripts/retrofit-cooldown-initials.js --dry-run`; omit `--dry-run` to
apply changes. Both versions resolve `private/guild-settings` relative to the
project root, not inside `dist`. Deploy that private directory alongside `dist`.

The script selects the first nonblank keyword of four characters or fewer,
trimming surrounding whitespace and preserving its case. Existing `initials`
fields are never overwritten; types with no qualifying keyword stay unchanged.
The dry run only reports proposed changes. Applying the migration creates a
`.json.initials.bak` backup for each changed file and replaces JSON atomically;
rerunning it makes no further changes. Stop the bot before applying the script
to avoid concurrent settings writes, then restart it to load the migrated values.

### Migrating from the monolithic `discord_settings.json` 🔀

Older deployments stored `payoutGuildIds`, `guildScheduleSourceByGuild`,
`cooldownInstanceTypes`, and `multiplierInstanceTypes` together in a single
`private/discord_settings.json`. To migrate to the per-guild layout above:

1. Keep `payoutGuildIds`, `payoutToPingId`, and `payoutToPingTag` in
   `private/discord_settings.json`; those remain global settings.
2. Move `guildScheduleBotIds` into its own `private/guild_schedule_settings.json`
   as shown above.
3. For each guild ID previously under `guildScheduleSourceByGuild`, create
   `private/guild-settings/<guild-id>.json` containing that guild's
   `guildScheduleSource`, plus its `cooldownInstanceTypes`,
   `multiplierInstanceTypes`, and `guildIcons` (previously keyed by guild ID
   under a shared `guildIcons` map).
4. `private/guild-settings/` may start empty on a brand-new deploy; the bot
   creates a settings file for each guild it has already joined on the next
   `ClientReady`, and for any guild it joins afterward, which you can then fill
   in with `/guildsetting set`.

Enable the **Server Members Intent** and **Message Content Intent** in the Discord Developer Portal for the bot application. `/payoutsummary` uses the Server Members Intent to resolve Discord display names from the sheet's Discord tags. The Message Content Intent allows automatic schedule announcements to read schedule embeds from guild message events. The client also enables the `Message` and `Channel` partials so edits to schedule messages still emit `messageUpdate` after they age out of the client's cache (e.g. following a bot restart); without these, discord.js silently drops update events for uncached messages.
