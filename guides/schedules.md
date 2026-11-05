# Guild Schedules

[README](../README.md) | [Setup and Deployment](setup.md) | [Commands](commands.md) | [Payouts and Sheets](payouts.md) | [Guild Schedules](schedules.md) | [Signup Sheets](signup-sheets.md) | [Development](development.md)

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
