import { jest } from "@jest/globals";
import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import {
  getInteractionContext,
  replyWithFailureMessage,
} from "./interaction-context.js";
import { logger } from "./logger.js";

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

describe("replyWithFailureMessage", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    { deferred: false, replied: false, method: "reply" },
    { deferred: true, replied: false, method: "editReply" },
    { deferred: false, replied: true, method: "editReply" },
  ] as const)(
    "uses $method for deferred=$deferred, replied=$replied",
    async (state) => {
      const reply = jest.fn(async () => undefined);
      const editReply = jest.fn(async () => undefined);
      const interaction = { ...state, reply, editReply };

      await replyWithFailureMessage(interaction as never, "Command failed");

      if (state.method === "reply") {
        expect(reply).toHaveBeenCalledWith({
          content: "Command failed",
          flags: MessageFlags.Ephemeral,
        });
        expect(editReply).not.toHaveBeenCalled();
      } else {
        expect(editReply).toHaveBeenCalledWith("Command failed");
        expect(reply).not.toHaveBeenCalled();
      }
    },
  );

  test.each([false, true])(
    "contains API failures when deferred=%s",
    async (deferred) => {
      const error = new Error("Discord API request timed out");
      const send = jest.fn(async () => {
        throw error;
      });
      const logError = jest
        .spyOn(logger, "error")
        .mockImplementation(() => undefined);

      await expect(
        replyWithFailureMessage(
          { deferred, replied: false, reply: send, editReply: send } as never,
          "Command failed",
        ),
      ).resolves.toBeUndefined();

      expect(send).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledWith(
        "Failed to send interaction error response:",
        error,
      );
    },
  );
});

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
