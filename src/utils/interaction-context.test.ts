import { jest } from "@jest/globals";
import type { ChatInputCommandInteraction } from "discord.js";
import { getInteractionContext } from "./interaction-context.js";

const createInteraction = (
  guild: ChatInputCommandInteraction["guild"],
): ChatInputCommandInteraction =>
  ({
    user: {
      id: "user-id",
      username: "alice",
      tag: "alice",
      displayName: "Alice",
      displayAvatarURL: jest
        .fn()
        .mockReturnValue("https://example.com/avatar.png"),
    },
    guildId: guild?.id ?? null,
    guild,
  }) as unknown as ChatInputCommandInteraction;

describe("getInteractionContext", () => {
  it("extracts user and guild presentation data", () => {
    const guild = {
      id: "guild-id",
      name: "Guild",
      iconURL: jest.fn().mockReturnValue("https://example.com/guild.png"),
    } as unknown as ChatInputCommandInteraction["guild"];

    expect(getInteractionContext(createInteraction(guild))).toEqual({
      userId: "user-id",
      username: "alice",
      discordTag: "alice",
      displayName: "Alice",
      userAvatarUrl: "https://example.com/avatar.png",
      guildId: "guild-id",
      guildName: "Guild",
      guildIconUrl: "https://example.com/guild.png",
    });
  });

  it("returns null guild fields for direct messages", () => {
    const context = getInteractionContext(createInteraction(null));

    expect(context.guildId).toBeNull();
    expect(context.guildName).toBeNull();
    expect(context.guildIconUrl).toBeNull();
  });
});
