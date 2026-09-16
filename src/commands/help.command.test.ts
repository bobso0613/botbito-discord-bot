import { describe, expect, it, jest } from "@jest/globals";
import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
} from "discord.js";
import {
  handleHelpAutocomplete,
  helpCommand,
  sendHelp,
} from "./help.command.js";

const createInteraction = () => ({
  client: { user: { avatarURL: jest.fn().mockReturnValue(null) } },
  reply: jest.fn(),
});

describe("help command", () => {
  it("shows the selected command and its parameters privately", async () => {
    const interaction = createInteraction();

    await sendHelp(interaction as never, "/guildsetting set schedule-channels");

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    const [{ embeds }] = interaction.reply.mock.calls[0] as [
      { embeds: Array<{ data: { fields: Array<{ value: string }> } }> },
    ];
    expect(embeds[0]?.data.fields[0]?.value).toContain("announcement channels");
    expect(embeds[0]?.data.fields[1]?.value).toContain(
      "**channels** (required)",
    );
  });

  it("groups the full guide and includes guild settings administration", async () => {
    const interaction = createInteraction();
    await sendHelp(interaction as never);

    const [{ embeds }] = interaction.reply.mock.calls[0] as [
      {
        embeds: Array<{
          data: { fields: Array<{ name: string; value: string }> };
        }>;
      },
    ];
    const administration = embeds[0]?.data.fields.find(
      (field) => field.name === "Administration",
    );
    expect(administration?.value).toContain(
      "/guildsetting set tracked-category",
    );
  });

  it("configures /help for guilds and bot DMs with autocomplete", async () => {
    expect(helpCommand.data.toJSON()).toMatchObject({
      integration_types: [ApplicationIntegrationType.GuildInstall],
      contexts: [InteractionContextType.Guild, InteractionContextType.BotDM],
      options: [
        expect.objectContaining({ name: "command", autocomplete: true }),
      ],
    });
    const respond = jest.fn();
    await handleHelpAutocomplete({
      options: { getFocused: () => "guildsetting" },
      respond,
    } as never);
    expect(respond).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          value: "/guildsetting set tracked-category",
        }),
      ]),
    );
  });
});
