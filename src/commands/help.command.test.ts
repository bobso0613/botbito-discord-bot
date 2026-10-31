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
      command: "/payout",
      expected: [
        "Currently Vending below Distributed",
        "signup-exports",
        "exact <@ID> in saved contents",
        "current title containing ⏳",
        "no NO SHARE (case-insensitive)",
        "even with zero balances",
        "empty list shows None",
        "default: public",
        "separate messages",
        "same privacy setting",
        "malformed export history",
      ],
    },
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
        "absent metadata falls back to run-title matching",
        "configured emojis",
        "combined heading",
        "explicit empty or unrecognized metadata",
      ],
    },
    {
      command: "/mycooldowns",
      expected: [
        "transitively merges types",
        "match exactly across guilds",
        "similar names alone do not merge",
        "highest configured maxAttempts",
      ],
    },
    {
      command: "/setinstancetype",
      expected: [
        "Comma-separated",
        "Endless Tower, Endless Cellar",
        "None clears",
        "multiple types",
        "at most two types",
        "Legacy saved selections are unchanged",
      ],
    },
    {
      command: "/newrun",
      expected: ["up to 8 parties"],
    },
    {
      command: "/export",
      expected: [
        "organizer only",
        "No reserves/TBC",
        "full date",
        "active/archived",
        "DD/MM",
        "instance emojis",
        "party headings",
        "consecutive numbering",
        "Participants",
        "timestamps",
        "public",
        "across combined and split exports",
        "Missing split parts can be retried",
        "retain links to completed posts",
        "custom emoji markup",
        "Interrupted exports recheck the forum",
        "before Unclaimed",
        "zero totals/reimbursements",
        "update Google Sheets manually",
        "without duplicate columns",
        "payoutWorksheets",
        "one blank column per entry",
        "two for a two-part split",
        "only row 9 formatting",
        "Default cell formulas must be reviewed",
        "**vendor** (required)",
        "**split** (optional)",
        "**second-vendor-name** (optional)",
        "defaults to vendor",
        "**first-run-absent-slots** (optional)",
        "**second-run-absent-slots** (optional)",
        "original signup slot numbers",
        "Combined: exclude all specified absences",
      ],
    },
    {
      command: "/changesharevendor",
      expected: [
        "Repeat the same value to retry",
        "spacer columns stay unchanged",
        "preserve the Discord edit",
        "bot-generated thread",
        "configured payout forum",
        "vendor name",
        "`n/a`",
        "`none`",
        "**vendor** (required)",
      ],
    },
    {
      command: "/changeshareparticipants",
      expected: [
        "bot-generated thread",
        "configured payout forum",
        "copy the roster",
        "next message in that thread",
        "unique mentions",
        "adds or removes thread members",
        "Ready/distributed shares require manual",
        "preserving totals and reimbursements",
        "saved vending membership",
        "edits add no spacer columns",
        "adjust default cell formulas",
      ],
    },
    {
      command: "/show",
      expected: [
        "current action buttons",
        "obsolete Export button",
        "/export with a vendor",
      ],
    },
    {
      command: "/guildsetting set payout-channel-id",
      expected: ["**channel** (required)", "Select or mention a forum channel"],
    },
    {
      command: "/guildsetting set cooldown-instance-types",
      expected: ["**initials** (optional)", "preserve existing initials"],
    },
    {
      command: "/ping",
      expected: [
        "up to 500 characters",
        "split large recipient lists",
        "DM delivery acknowledges first",
        "maximum 500 characters",
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
    const payout = embeds[0]?.data.fields.find(
      (field) => field.name === "Payout",
    );
    expect(administration?.value).toContain(
      "/guildsetting set tracked-category",
    );
    expect(payout?.value).toContain("/changesharevendor");
    expect(payout?.value).toContain("/changeshareparticipants");
    for (const field of embeds[0]?.data.fields ?? []) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
    }
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
