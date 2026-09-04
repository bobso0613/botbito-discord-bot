import { describe, expect, it } from "@jest/globals";
import type { InteractionContext } from "../types/interaction-context.js";
import { buildGuildScheduleEmbed } from "./guild-schedule.template.js";

const context: InteractionContext = {
  userId: "user-id",
  username: "alice",
  discordTag: "alice",
  displayName: "Alice",
  userAvatarUrl: "https://cdn.discordapp.com/avatars/user-id/avatar.png",
  guildId: "guild-id",
  guildName: "Test Guild",
  guildIconUrl: "https://cdn.discordapp.com/icons/guild-id/icon.png",
};

describe("buildGuildScheduleEmbed", () => {
  it("builds an embed with linked schedule titles and timestamps", () => {
    const embed = buildGuildScheduleEmbed(
      [
        {
          title: "Endless Tower Wednesday",
          timestamp: "<t:4070905800:F>",
          channelName: "endless-tower-signup",
          channelUrl: "https://discord.com/channels/guild/channel",
          isSignedUp: false,
          isReserve: true,
        },
        {
          title: "Wolfchev",
          timestamp: "<t:4070909400:F>",
          channelName: "wolfchev-signup",
          channelUrl: "https://discord.com/channels/guild/wolfchev",
          isSignedUp: false,
          isReserve: false,
        },
      ],
      context,
      "Run Signups",
    );

    expect(embed.data).toMatchObject({
      title: "Upcoming Runs of Test Guild",
      description:
        "**__📝 Signed Up / 🪑 Reserve__:\n**\n🗓️ **[Endless Tower Wednesday](https://discord.com/channels/guild/channel)**\n<t:4070905800:F> (<t:4070905800:R>)\n↪ [#endless-tower-signup](https://discord.com/channels/guild/channel) - 🪑\n\n**------------------------------\n__Not Signed Up__:\n**\n🗓️ **[Wolfchev](https://discord.com/channels/guild/wolfchev)**\n<t:4070909400:F> (<t:4070909400:R>)\n↪ [#wolfchev-signup](https://discord.com/channels/guild/wolfchev)",
    });
  });

  it("builds an empty-state embed when no schedules are active", () => {
    expect(
      buildGuildScheduleEmbed([], context, "Run Signups").data.description,
    ).toBe("No active schedules found.");
  });
});
