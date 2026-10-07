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
  it.each([
    {
      command: "/mycooldowns",
      expected: [
        "cooldownInstanceTypes",
        "metadata overrides titles",
        "ECET",
        "maxAttempts: 0",
      ],
    },
    {
      command: "/mysched",
      expected: [
        "source guild",
        "metadata",
        "run titles",
        "configured emojis",
        "combined heading",
      ],
    },
    {
      command: "/setinstancetype",
      expected: [
        "Comma-separated",
        "Endless Tower, Endless Cellar",
        "None clears",
        "multiple types",
      ],
    },
  ])(
    "documents updated instance behavior for $command",
    async ({ command, expected }) => {
      const interaction = createInteraction();
      await sendHelp(interaction as never, command);
      const payload = interaction.reply.mock.calls[0]![0] as {
        embeds: Array<{ data: { fields: Array<{ value: string }> } }>;
      };
      const text = payload.embeds[0]!.data.fields.map(
        (field) => field.value,
      ).join("\n");
      for (const phrase of expected) expect(text).toContain(phrase);
      for (const field of payload.embeds[0]!.data.fields)
        expect(field.value.length).toBeLessThanOrEqual(1024);
    },
  );

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

  it("documents the required /help selector and cooldown visibility option", async () => {
    const interaction = createInteraction();

    await sendHelp(interaction as never, "/help");
    await sendHelp(interaction as never, "/mycooldowns");

    const helpFields = (
      interaction.reply.mock.calls[0]?.[0] as {
        embeds: Array<{ data: { fields: Array<{ value: string }> } }>;
      }
    ).embeds[0]?.data.fields;
    expect(helpFields?.[1]?.value).toContain("**command** (required)");
    expect(helpFields?.[1]?.value).toContain("autocomplete");

    const cooldownFields = (
      interaction.reply.mock.calls[1]?.[0] as {
        embeds: Array<{ data: { fields: Array<{ value: string }> } }>;
      }
    ).embeds[0]?.data.fields;
    expect(cooldownFields?.[0]?.value).toContain("signed-up and reserve runs");
    expect(cooldownFields?.[1]?.value).toContain("private by default");
  });

  it("documents /ping's optional target and destination defaults", async () => {
    const interaction = createInteraction();

    await sendHelp(interaction as never, "/ping");

    const fields = (
      interaction.reply.mock.calls[0]?.[0] as {
        embeds: Array<{ data: { fields: Array<{ value: string }> } }>;
      }
    ).embeds[0]?.data.fields;
    expect(fields?.[1]?.value).toContain("**which** (optional)");
    expect(fields?.[1]?.value).toContain("defaults to Main Roster");
    expect(fields?.[1]?.value).toContain("**where** (optional)");
    expect(fields?.[1]?.value).toContain("defaults to Channel");
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
