import { describe, expect, it } from "@jest/globals";
import { ApplicationIntegrationType, InteractionContextType } from "discord.js";
import { mySchedCommand } from "./mysched.command.js";

describe("my schedule command", () => {
  it("is available in guilds and bot DMs with schedule grouping controls", () => {
    expect(mySchedCommand.data.toJSON()).toMatchObject({
      integration_types: [ApplicationIntegrationType.GuildInstall],
      contexts: [InteractionContextType.Guild, InteractionContextType.BotDM],
      options: [
        expect.objectContaining({ name: "thisweekonly", type: 5 }),
        expect.objectContaining({ name: "grouping", type: 3 }),
      ],
    });
  });
});
