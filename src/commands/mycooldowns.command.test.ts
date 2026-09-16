import { describe, expect, it } from "@jest/globals";
import { ApplicationIntegrationType, InteractionContextType } from "discord.js";
import { myCooldowsCommand } from "./mycooldowns.command.js";

describe("my cooldowns command", () => {
  it("is available in guilds and bot DMs with an optional public output control", () => {
    expect(myCooldowsCommand.data.toJSON()).toMatchObject({
      integration_types: [ApplicationIntegrationType.GuildInstall],
      contexts: [InteractionContextType.Guild, InteractionContextType.BotDM],
      options: [expect.objectContaining({ name: "showinpublic", type: 5 })],
    });
  });
});
