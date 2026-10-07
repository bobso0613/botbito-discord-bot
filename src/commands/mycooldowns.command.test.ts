import { describe, expect, it, jest } from "@jest/globals";
import { ApplicationIntegrationType, InteractionContextType } from "discord.js";
import { COOLDOWN_INSTANCE_TYPES } from "../constants/cooldowns.js";
import type { GuildSchedule } from "../types/guild-schedule.js";

const getActiveGuildSchedules = jest.fn<() => Promise<GuildSchedule[]>>();
const source = { categoryIds: ["category"], scheduleTextChannelIds: [] };
const tower = COOLDOWN_INSTANCE_TYPES[0];
const cellar = COOLDOWN_INSTANCE_TYPES[1];
jest.unstable_mockModule("../services/guild-schedule.service.js", () => ({
  getActiveGuildSchedules,
}));
jest.unstable_mockModule("../config/discord-settings.js", () => ({
  GUILD_SCHEDULE_GUILD_IDS: ["first", "second"],
  DISCORD_SETTINGS: {
    guildScheduleSourceByGuild: { first: source, second: source },
    cooldownInstanceTypesByGuild: {
      first: [tower, cellar],
      second: [{ ...tower, name: "Tower Challenge", keywords: ["ET"] }, cellar],
    },
    multiplierInstanceTypesByGuild: { first: [], second: [] },
  },
}));
jest.unstable_mockModule("../utils/interaction-context.js", () => ({
  getInteractionContext: () => ({
    userId: "user",
    discordTag: "alice",
    displayName: "Alice",
    guildId: "first",
    userAvatarUrl: "https://example.com/avatar.png",
  }),
}));
const { myCooldowsCommand, sendMyCooldowns } =
  await import("./mycooldowns.command.js");

describe("my cooldowns command", () => {
  it("merges cross-guild aliases and counts a combined metadata run for both instances", async () => {
    const schedule = {
      title: "Friday run",
      timestamp: "<t:1234567890:F>",
      channelName: "signups",
      channelUrl: "https://discord.com/channels/guild/channel",
      isSignedUp: true,
      isReserve: false,
    };
    getActiveGuildSchedules
      .mockResolvedValueOnce([
        { ...schedule, instanceTypes: ["Endless Tower", "Endless Cellar"] },
      ])
      .mockResolvedValueOnce([{ ...schedule, title: "ET Friday" }]);
    const interaction = {
      guildId: "first",
      user: { id: "user" },
      deferReply: jest.fn(),
      editReply: jest.fn(),
      client: {
        guilds: {
          cache: new Map(
            ["first", "second"].map((id) => [
              id,
              {
                id,
                name: id,
                members: { fetch: jest.fn().mockResolvedValue({} as never) },
              },
            ]),
          ),
        },
      },
    };
    await sendMyCooldowns(interaction as never);
    const payload = interaction.editReply.mock.calls[0]![0] as {
      embeds: Array<{ data: { description: string } }>;
    };
    const description = payload.embeds[0]!.data.description;
    expect(description).toContain("Endless Tower - **2**");
    expect(description).toContain("Endless Cellar - **1**");
    expect(description).not.toContain("Tower Challenge");
  });

  it("is available in guilds and bot DMs with an optional public output control", () => {
    expect(myCooldowsCommand.data.toJSON()).toMatchObject({
      integration_types: [ApplicationIntegrationType.GuildInstall],
      contexts: [InteractionContextType.Guild, InteractionContextType.BotDM],
      options: [expect.objectContaining({ name: "showinpublic", type: 5 })],
    });
  });
});
