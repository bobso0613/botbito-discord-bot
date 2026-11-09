# Signup Sheets

[README](../README.md) | [Setup and Deployment](setup.md) | [Commands](commands.md) | [Payouts and Sheets](payouts.md) | [Guild Schedules](schedules.md) | [Signup Sheets](signup-sheets.md) | [Development](development.md)

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
  - Combined exports check every saved split key for the normalized title and full date, even after `/setinstancetype type:None` or replacement selections. Earlier instance identities remain available for identifier recovery. Missing split parts remain retryable; another title or date is unaffected.
  - Exports preserve the original `Party x` headings for parties with confirmed filled slots. `Participants: **N**` counts unique exported Discord members, not slots; reserves and TBC entries do not count. When instance types are selected, their Unicode emojis are appended to the thread title in brackets; custom Discord emoji markup is omitted from titles but retained in the `Instance Types: emoji **Name**, emoji **Name**` footer. Guild-specific instance definitions take precedence over built-in defaults. The run's localized full Discord timestamp (`Your Time`) and relative timestamp follow, with the Export ID remaining the final line of the starter message. Long titles are shortened while preserving the date and instance emojis. Export success, failure, and duplicate notices are public channel responses. A `split:true` request with fewer than two instance types includes a note explaining why it was not split. Combined exports exclude all specified absent slots; use combined mode when the lineups are the same.
  - Organizer authorization uses the saved Discord user ID and rejects records where that ID conflicts with the user ID in the displayed Discord avatar URL. It is checked again immediately before post creation. Each export snapshots its organizer ID, name, and avatar in that export's history for `/set share status` authorization; changing the signup organizer affects later exports, not existing payout posts. Editing a legacy sheet without an organizer ID no longer assigns the editor as organizer. For missing or inconsistent legacy organizer details, use `/swaporganizer user:@correct-organizer` before exporting.
  - The first export message ends with `Export ID: botbito-export:v1:<hash>` in small text. The deterministic SHA-256 identifier includes the guild, normalized full run title, and scheduled calendar date, so title truncation, roster changes, and same-day time changes do not alter it. When local history has no record, the bot checks its own active and archived forum starter messages for this exact footer and restores the history if it finds a match. Thread names are filtered by the run's - DD/MM suffix before fetching starter messages; preserve that date suffix when renaming a post so identifier recovery can find it. Archived listings are still paginated without an unsafe archive-date cutoff. Deleted starter messages (`10008 Unknown Message`) are skipped; other lookup failures block creation. Older posts without the identifier still rely on saved export history.
  - If a history entry is missing, renaming a thread so it no longer ends with ' DD/MM' or contains ' - DD/MM [' can hide it from forum recovery; appending `NO SHARE` or `DONE` after a bare date is one example. Saved thread IDs do not depend on the title filter. ID-only entries whose threads return `10003 Unknown Channel` can retry after a successful identifier recheck; access and other read failures still block creation.
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
