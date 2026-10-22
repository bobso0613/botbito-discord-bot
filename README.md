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

## Commands 💬

`/help` ℹ️ requires a `command` autocomplete parameter. Start typing a command name to find a match; selecting it displays a private guide with that command's description and parameters. Suggestions come from the same command list used to power the guide, so new entries appear automatically. The "Help" button on guild schedule output still shows the full guide grouped by category.

`/payout` 💰 displays the command user's Pending, Share Ready, and Distributed balances in zeny (`z`), followed by **🛒Currently Vending** below Distributed. It is available in every channel of configured payout guilds. The optional `sendprivately` parameter sends the response ephemerally; it is public by default. The **My Payout Status** button shows the same information privately.

Currently Vending links unique threads recorded in this server's `private/signup-exports/<guildId>.json` only when stored `contents` includes the invoker's exact Discord mention (`<@ID>`). Candidate threads use Discord's channel cache when available: their titles must contain `⏳` and must not contain `NO SHARE` (case-insensitive). Entries without saved contents or a thread ID, deleted or inaccessible threads, non-thread channels, and threads from another server are skipped. Older exports without contents can be backfilled with `npm run migrate:signup-exports`; export retries also recover original roster messages, including follow-ups. An empty vending list displays `None`; long lists continue in additional fields and separate messages within Discord's field and message character limits, preserving the response's privacy setting. Malformed export-history JSON leaves the vending section empty without preventing balance display; exports still fail closed until the history is repaired. Qualifying threads are shown even when all sheet balances are zero. The not-on-the-list response appears only when all balances are zero and no vending threads qualify.

`/payoutsummary` 📄 displays every non-zero payout and its total for the calling server. It is available in every channel of configured payout guilds. The optional `amount` parameter selects `Share Ready` (default), `Pending`, or `Distributed`. The optional `sendprivately` parameter sends the response ephemerally; it is public by default. Each row shows the Discord guild display name and its right-aligned zeny balance. It uses the Server Members Intent to resolve display names from the sheet's Discord tags. The optional `sort` parameter supports `Name` and `Amount`; the optional `direction` parameter supports `Ascending` and `Descending`. By default, payouts are sorted by the selected amount descending, with Name ascending as the tie-breaker. Share Ready summaries include the release description and distribution contact; Pending summaries use `Currently vending:` and Distributed summaries omit the description and distribution contact. In `/payout`, the claim reminder appears after Currently Vending when a Share Ready balance is available. Both commands omit the claim reminder entirely when the invoker's Discord ID matches `payoutToPingId`; `/payoutsummary` also omits the Distribution field in that case.

`/guildsched` 🗓️ lists active runs from the configured guild schedule categories. It is available to all members of the guild. The bot includes only signup channels the invoking member can view and read, uses the newest active schedule per channel, and orders results earliest to latest. It checks the configured schedule bot's most recent 100 messages in each channel newest-first: replies without a `Your Time:` label, such as command confirmations and `Interaction cancelled`, are ignored; a newer schedule embed with `Your Time: TBD` clears that channel's older schedule. Every guild schedule output, including automatic announcements, includes four primary buttons: `My Sched` sends the clicking member's default `/mysched` result by DM, `My Payout Status` opens a private payout response, `My Cooldowns` opens private cooldown status, and `Help` opens the private command guide. Button success and failure logs record `button`, `buttonLabel`, status, guild, user, and the standard command context; button clicks log `parameters=[]`.

When `/mysched thisweekonly:true` or `/mycooldowns` requests a schedule week window, a single page of 100 messages can miss an in-window run that channel activity has pushed further back. In that case the bot fetches additional pages (oldest-first, up to 5 pages / 500 messages per channel) until either a matching schedule is found or the oldest fetched message is older than the window's start.

When a configured schedule bot posts or updates a schedule response in one of the configured `categoryIds` channels, the bot automatically refreshes every `scheduleTextChannelIds` channel. It deletes the existing announcement messages and posts a public announcement equivalent to `/guildsched public:true forannouncementonly:true`. The listener compares the newest schedule-bot response with the previous response, including `Your Time: TBD` and plain postpone responses, so new schedule-changing commands do not require code changes. A configured `scheduleTextChannelIds` channel is never treated as a source channel, even if it is placed in a configured category. Updates without a cached prior timestamp, such as partial `messageUpdate` payloads after a restart, are ignored for timestamp-based refreshes to prevent false announcements. Refresh logs include the `triggerReason`, source `triggerChannel`, current `triggerRunTitle`, and `previousChannelName` for channel renames. Timestamp refreshes also log `timestampFrom` and `timestampTo`; title refreshes log `titleFrom` and `titleTo`.

The bot also refreshes announcements when a schedule response's run title (embed title) changes, or when a schedule source channel itself is renamed. Since these two triggers don't change the scheduled time, they only refresh the announcement when the run's previous title, or the channel's previous name, is currently present in the latest posted announcement; this avoids refreshing for runs that haven't been publicly announced yet. Title changes are detected on both edits and brand-new schedule-bot messages, since some schedule bots reply to a rename command with a new message instead of editing the previous one. Discord doesn't always cache a message's pre-edit content (e.g. after the bot restarts or the message ages out of cache), so when the previous title can't be read from the edit event, or there is no previous message at all, the bot instead compares the new title against the title currently announced for that schedule channel.

Automatic announcements identify the latest updated run with the following format:

```text
schedule automatically updated from the latest update in:
<run-title>
```

Manually invoked `/guildsched` announcements continue to identify the command user.

Each schedule links to the run and its actual signup channel. The output groups runs where the member is signed up or reserve before runs where they are not signed up. `📝` marks a standard signup and `🪑` marks a reserve slot; `❓` is added beside either marker when the member is TBC. Character names/notes from signup entries (e.g., "alt character", "reserve slot") are displayed next to the status indicator when present. The embed notes the category from which signup channels are shown and mentions the invoking member.

Use `/guildsched public:true` to post the schedule embed for everyone in the current channel. Without the option, the response is private. When posting publicly, role-restricted channels are displayed with a "(Private run)" label in the run title instead of a direct link, omitting the channel name. Add `forannouncementonly:true` with `public:true` to create a neutral announcement: it omits the Signed Up / Reserve and Not Signed Up headings, status indicators, and character notes while retaining each run's title and time. `forannouncementonly` has no effect unless `public:true` is also set.

`/mysched` ⌚ sends the invoking user a DM with their upcoming signed-up and reserve schedules across all configured schedule guilds the bot and user can access. It can be used in any server channel where the bot can see the command, or directly in a DM with the bot after global command registration is deployed.

The command only includes schedules where the member is signed up or listed as reserve. Each entry shows the configured guild icon, guild name, linked schedule title, time, source channel, and signup/reserve indicator. `❓` appears beside `📝` or `🪑` when the member is TBC, and the character name/note is shown beside the status when present. Future schedule titles use `🗓️`; completed schedule titles use `✅`. The optional `grouping` parameter supports `By Date`, `By Guild`, and `By Instance Type`; `By Date` is the default, `By Guild` uses larger guild headings, and `By Instance Type` uses selected instance metadata when available, with title-based matching as a fallback.

For `By Instance Type`, schedules with instance-type metadata use the source guild's `cooldownInstanceTypes` names and keywords, taking precedence over the title. Headings include each resolved type's emoji (for example, `🦐 Test Instance`). Multiple selected types share a combined heading such as `🪜 Endless Tower / 📉 Endless Cellar`. This bot's sheets use title matching when instance types are unset or `None` is selected, for both current persisted and older sheets. Other schedule bots that explicitly publish empty or unrecognized metadata are grouped under `Others`, with its configured emoji or the default `💀`.

Use `/mysched thisweekonly:true` to show all signed-up/reserve runs from the current schedule week, including completed runs, and hide runs outside that week. When a channel has a newer scheduled reply outside the week, its earlier in-week run remains included; only `Your Time: TBD` clears an older run. Schedule weeks start every Monday at `06:00 GMT` (`T06:00:00Z`) and run through Sunday. When this option is enabled, the DM embed title changes to the covered date range, for example `Your Schedule - 31 Aug to 06 Sept`.

`/mycooldowns` 🔥 shows the invoking user's weekly cooldown status from signup sheets across all configured schedule guilds the bot and user can access. It combines counts across those guilds and counts every signed-up/reserve run inside the current schedule week, including completed runs, as an attempt for its matching instance type. A newer scheduled reply outside the week does not hide an earlier in-week run; `Your Time: TBD` clears it. Guild responses are private by default; use `/mycooldowns showinpublic:true` to display the result to everyone in the current channel. The command can also be used in a DM with the bot.

The cooldown display groups runs using each guild's `cooldownInstanceTypes`, merging types transitively when their names or keywords match exactly across guilds. Similar names alone do not merge. Selected instance types take precedence over the run title. This bot lists them only in the organizer footer; scans use stored selections for the matching current sheet. Unset types and `None` use title matching, just as older sheets without metadata do. Older sheets and other bots use embed fields or matching organizer-footer suffixes. When metadata is absent, the run title is used. Combined runs such as `EC+ET back 2 back Friday` count toward both Endless Cellar and Endless Tower when using title-based matching or when both types are selected.

Current persisted signup sheets identify members by Discord ID. For older or external embeds, roster mentions and the member's server display name take precedence; global display name and username are considered only when neither matches anywhere in that embed. Name-only fallback can still be ambiguous when multiple members share a name. `/add` and slot joins via `/swap` use the server display name, falling back to the Discord display name if the member lookup fails.

Combined matching accepts either order, full names, common separators, and joined abbreviations: `ET+EC`, `EC+ET`, `ET EC`, `ETEC`, `ECET`, `EC and ET`, `ET & EC`, and `Endless Cellar+Endless Tower` all resolve to both types. Matching is case-insensitive. Each run counts once per matched type before any enabled title multiplier, even if the same type appears repeatedly. Joined abbreviations must form a complete sequence of configured aliases; partial matches inside unrelated words are rejected. Other bots' embeds that explicitly publish empty or unrecognized metadata do not fall back to the title and are counted under `Others` when configured.

Select multiple instance types during signup setup, or use `/setinstancetype type:Endless Tower, Endless Cellar`. Autocomplete preserves comma-separated selections. `None` clears the selection. Existing saved single-type strings remain supported alongside arrays for multiple types. Equivalent cross-guild types use the first configured label and the highest configured attempt limit in the combined cooldown display.

Some instances support multipliers from the signup sheet title:

- **Eternal Bastion (EB)**: Multiplier extracted from title (e.g., `EB 2x` counts as 2 attempts)
- **Horror Toy Factory (HTF)**: Multiplier extracted from title (e.g., `HTF 3x` counts as 3 attempts)
- **Sealed Shrine**: Multiplier extracted from title (e.g., `Sealed Shrine 4x`) or defaults to 4 attempts if title contains `(minimum 2-3 runs)`

Other instances (Endless Tower, Endless Cellar, Wolfchev's Laboratory) count as 1 attempt each, regardless of title text. Unrecognized signup sheets are grouped under "Others."

The embed title shows the covered schedule week date range (e.g., `Your Attempts - 04 Sep to 10 Sep`). A disclaimer notes which guild schedules were counted, reminding users that signups from outside those guilds cannot be included. Each instance type includes an emoji identifier for quick visual recognition. Any instance with `maxAttempts: 0` displays only its count (for example, `🦐 Test Instance - **1**`), without `out of 0`; positive limits retain the usual `count out of limit` format.

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

Schedule embeds are posted by a configured `guildScheduleBotIds` bot in signup channels. Each entry's format determines how the bot displays signup and reserve information.

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

The character note is optional and displayed in parentheses. TBC entries append `❓` after the character note. Examples:

- `- **PlayerName** (alt)` → displays as "📝 - alt"
- `Reserve - **PlayerName** (wallet)` → displays as "🪑 - wallet"
- `- **PlayerName** *(alt)* ❓` → displays as "📝 ❓ - alt"
- `Reserve - **PlayerName** *(wallet)* ❓` → displays as "🪑❓ - wallet"
- `- **PlayerName**` → displays as "📝 " (no note)

The bot extracts the note text and displays it alongside the status indicator (📝 for signups, 🪑 for reserves) in the `/guildsched` command output.

Bold (`**DisplayName**`) is optional in both signup and reserve entries — plain-text names (e.g. `07: Prof - DisplayName`, as used by position-board style signup sheets) are matched the same way. A name is recognized after a `-` or `,` separator, bounded by whitespace, a comma, a parenthesis, or the end of the line, so it isn't accidentally matched inside a longer name.

## Role-Restricted Guild Schedule Channels 🔐

Certain schedule channels can be restricted to users with specific Discord roles. This is useful for private or elite signup channels.

When a member views a role-restricted channel privately, they only see it if they have the required role. When posting publicly with `/guildsched public:true`, role-restricted channels are displayed with a "(Private run)" label in the run title instead of a direct link, allowing authorized members to see private runs while others can see they exist without accessing their details.

Configure role-restricted channels in the guild's `private/guild-settings/<guild-id>.json`:

```json
{
  "guildScheduleSource": {
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

## Signup Sheets 📋

Channel-scoped signup sheets (created with `/newrun`) provide an interactive party formation and roster management system stored per-guild under `private/signup-sheets/<guildId>.json`.

### Features & Capabilities

- **Party Setup & Customization**: Create up to 8 parties with customizable party sizes, custom run names, notes, thumbnail icons, embed colors, server timezones, and instance types.
- **Roster Management**:
  - `/add` (alias `/a`): Sign up for specific slot numbers (e.g. `1`, `1, 2`), one `random` open slot, or `reserve`. Supports signing up other users by mention or username (e.g. `2 @user` or `2 B4D`). The optional `char` parameter sets the character name/note shown beside the signup, and optional `tbc:true` marks it as TBC. Occupied slots require confirmation before replacement, and each displaced user is notified after the replacement. Concurrent changes are rechecked before an open-slot add is saved. Random adds report the rolled slot in the public action notice.
  - `/remove` (alias `/r`): Remove your own signups/reserves, or remove specific slot/reserve positions.
  - `/swap`: Join a slot as yourself, swap two party slots, swap a party slot with a `random` open slot or reserve, or move a signup to reserves. Use `reserve` as the first value to move your own single party-slot signup to reserves. If a user holds multiple signups, specifying the second position is required to prevent ambiguity. For example, `/swap first=7 second=random` moves the signup from slot 7 to a randomly selected open slot and reports the rolled slot in the public action notice.
  - `/charnote` (alias `/char`): Add character notes (e.g. `HP 3x`, `Alt`, `DPS`) to your own slot/reserve or a specified position number.
  - `/removecharnote` (alias `/rc`): Clear character notes for your own positions or specified slot/reserve numbers.
  - `/tbc`: Toggle To Be Confirmed (TBC) status for yourself or specified slot/reserve numbers. Marked with a `❓` emoji on the roster.
  - `/removetbc` (alias `/rtbc`): Remove TBC markings from your own positions or specified slot/reserve numbers.
  - `/ping`: Send a message of up to 500 characters to signup participants. `which` selects `Main Roster` (the default), `Reserves`, `TBC`, or `All`; `where` selects `Channel` (the default) or `Direct Message`. Channel delivery splits large recipient lists into follow-up messages that remain within Discord's 2,000-character limit. DM delivery acknowledges the command before sending an individual message to each unique participant, including the run title, signup channel, and scheduled time or `TBD`, then edits the confirmation to name anyone the bot could not DM. The message includes the invoker, message text, and selected target group.
  - `/export`: Only the run organizer can export the filled main slots to the configured payout forum, in a guild listed in `payoutGuildIds`. Creates a post titled `⏳Run Title - DD/MM` (for example, `21/10` for October 21), using the server timezone, then the schedule timezone, then GMT. Long titles are shortened while retaining the date. The first message lists confirmed filled slots with consecutive numbering starting at 01, roles, actual Discord member mentions, and character notes; empty slots, reserves, and TBC signups are omitted. Numbering continues across parties without changing the signup sheet's original slot numbers. Rosters exceeding Discord's 2,000-character limit continue in subsequent messages. Set a run date with `/sdt` before exporting. Only one export is allowed per run title and calendar date within a guild; title comparison ignores case and repeated whitespace, and changing the time within that date does not permit another export. Repeated requests link to the existing post. A different run title or date can be exported. Duplicate detection still uses the full date including the year, even though the title only shows day and month.
  - Export history is stored separately in `private/signup-exports/<guildId>.json` and survives bot restarts, sheet replacements, and forum-channel changes. Simultaneous attempts are serialized and a reservation is persisted before creating the post. Failed post creation releases the reservation so it can be retried; partial roster delivery still counts as an export. Retrying an interrupted reservation checks the forum first: an existing post is recovered with its original roster, otherwise creation can be retried after a successful lookup. Lookup errors keep creation blocked. Combined and split history are checked for overlapping coverage; a missing split part can still be retried. If a later part fails, the reply retains links to earlier successful posts. Posts created before export tracking was added can be imported with the migration command.
  - Exports preserve the original `Party x` headings for parties with confirmed filled slots. `Participants: **N**` counts unique exported Discord members, not slots; reserves and TBC entries do not count. When instance types are selected, their Unicode emojis are appended to the thread title in brackets; custom Discord emoji markup is omitted from titles but retained in the `Instance Types: emoji **Name**, emoji **Name**` footer. Guild-specific instance definitions take precedence over built-in defaults. The run's localized full Discord timestamp (`Your Time`) and relative timestamp follow, with the Export ID remaining the final line of the starter message. Long titles are shortened while preserving the date and instance emojis. Export success, failure, and duplicate notices are public channel responses. A `split:true` request with fewer than two instance types includes a note explaining why it was not split. Combined exports exclude all specified absent slots; use combined mode when the lineups are the same.
  - Organizer authorization uses the saved Discord user ID and rejects records where that ID conflicts with the user ID in the displayed Discord avatar URL. It is checked again immediately before post creation. Editing a legacy sheet without an organizer ID no longer assigns the editor as organizer. For missing or inconsistent legacy organizer details, use `/swaporganizer user:@correct-organizer` before exporting.
  - The first export message ends with `Export ID: botbito-export:v1:<hash>` in small text. The deterministic SHA-256 identifier includes the guild, normalized full run title, and scheduled calendar date, so title truncation, roster changes, and same-day time changes do not alter it. When local history has no record, the bot checks its own active and archived forum starter messages for this exact footer and restores the history if it finds a match. Thread names are filtered by the run's - DD/MM suffix before fetching starter messages; preserve that date suffix when renaming a post so identifier recovery can find it. Archived listings are still paginated without an unsafe archive-date cutoff. Deleted starter messages (`10008 Unknown Message`) are skipped; other lookup failures block creation. Older posts without the identifier still rely on saved export history.
  - After `/add`, `/remove`, `/swap`, `/tbc`, `/charnote`, and `/removecharnote` update and re-post the sheet embed, the bot posts a public log message in the channel: a plain display-name line for the invoker's own action (e.g. `**DisplayName** added as **01: Role**.`), or an @mention line when someone else was affected. Random add/swap notices include the rolled slot number.
  - `/name` posts a public notice after the updated embed: `invokerName has set the run name to **name**`.
  - `/note` posts a public notice after the updated embed, showing the new note on the next line; replying `remove` shows that the note was removed and displays `None`.
  - `/swaporganizer` posts a public notice mentioning the new organizer after the updated embed.
- **Schedule Management**:
  - `/sdt`: Set or clear (`TBD`) run date and time, then post a public notice with the Discord-formatted timestamp or `TBD`.
  - `/when`: Display the localized run time and server time.
  - `/gonow`: Set the run time to now (with optional duration offset), then post a public notice with the Discord-formatted timestamp.
  - `/postpone`: Shift the scheduled time without modifying the roster, then post a public notice with the Discord-formatted timestamp.
  - `/next`: Shift the schedule for a fresh run and clear the roster, then post a public notice with the Discord-formatted timestamp.
  - `/last`, `/show`, `/s`: Re-post the channel's current signup sheet embed.
- **Interactive Action Buttons**: Every published sheet embed includes two rows of interactive action buttons:
  - **Row 1**: `Add` (Success), `Remove` (Danger), `TBC` (Primary), `Swap` (Primary)
  - **Row 2**: `Char` (Success), `Remove Char` (Danger), `Schedule` (Secondary), `Command List` (Secondary)
  - Export through `/export`, which accepts the required vendor option. Use `/show` to refresh an older sheet and remove its obsolete Export button after updating the bot.

### Roster Editing

`/newrun` and `/change all` allow at most 8 parties and validate that the number of party sizes matches the number of parties. For example, two parties require a value such as `12,6`, not a single value such as `12`. Roster edits also reject more than 8 party headers.

After party setup, the roster prompt is public so the channel can see which setup is in progress, but only the user who started it can submit roster messages or use its controls. `/change roster` also shows a public editable template. The template includes headers such as `Party 1:` and `Party 2:`:

```text
Party 1:
01: role -
02: role -

Party 2:
03: role -
04: role -
```

Add, remove, or reorder `Party #:` sections and move roster lines beneath them to update the party count and party-size breakdown. Empty roster lines should retain their single trailing dash (`01: role -`).

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
- `npm run migrate:signup-exports -- --dry-run` previews legacy pending-thread imports; omit `--dry-run` to save them. After building, use `npm run migrate:signup-exports:dist -- --dry-run` for the compiled script.
- `npm test` runs the Jest unit tests.
- `npm run test:coverage` runs Jest with coverage output for payout services and utilities.
- `npm run docs` generates TypeDoc HTML reference pages in `docs/`.
- (On hosting before running script) `/opt/cpanel/ea-nodejs22/bin/node deploy-commands.js`
- (On hosting) `nohup /opt/cpanel/ea-nodejs22/bin/node index.js & disown`

Ensure `.env`, `private/discord_settings.json`, `private/guild_schedule_settings.json`, the relevant `private/guild-settings/<guild-id>.json` files, and the Google service-account JSON are present before starting the bot.

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
