import { describe, expect, it, jest } from "@jest/globals";
import { MessageFlags } from "discord.js";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import { guildSchedCommand } from "./guildsched.command.js";

describe("guild schedule command", () => {
  it("rejects an unconfigured guild", async () => {
    const interaction = {
      guildId: "unconfigured-guild",
      guild: { id: "unconfigured-guild" },
      reply: jest.fn(),
    };
    await guildSchedCommand.execute(interaction as never);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "This command is not available for this guild.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("rejects a guild with no tracked schedule category", async () => {
    const guildId = Object.keys(DISCORD_SETTINGS.guildScheduleSourceByGuild)[0];
    const source = DISCORD_SETTINGS.guildScheduleSourceByGuild[guildId];
    const categoryIds = source.categoryIds;
    source.categoryIds = [];

    try {
      const interaction = {
        guildId,
        guild: { id: guildId },
        reply: jest.fn(),
      };
      await guildSchedCommand.execute(interaction as never);
      expect(interaction.reply).toHaveBeenCalledWith({
        content:
          "No schedule category is being tracked. Ask a server administrator to set one with /guildsetting set tracked-category.",
        flags: MessageFlags.Ephemeral,
      });
    } finally {
      source.categoryIds = categoryIds;
    }
  });

  it("exposes public and announcement-only options", () => {
    expect(guildSchedCommand.data.toJSON().options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "public", type: 5 }),
        expect.objectContaining({ name: "forannouncementonly", type: 5 }),
      ]),
    );
  });
});
