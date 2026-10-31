import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ChannelType } from "discord.js";

const syncPayoutExport = jest.fn(async (..._args: unknown[]) => "");
jest.unstable_mockModule("../services/payout-sheet-export.service.js", () => ({
  syncPayoutExport,
  queuePayoutSheetOperation: async (action: () => Promise<unknown>) => action(),
}));

jest.unstable_mockModule("../config/discord-settings.js", () => ({
  DISCORD_SETTINGS: {
    payoutSheetChannelIdByGuild: { guild: "forum" },
  },
  PAYOUT_GUILD_IDS: ["guild"],
}));

const {
  changeShareParticipantsCommand,
  changeShareVendorCommand,
  handleShareParticipantsMessage,
} = await import("./payout-thread.command.js");

const exportIdentifier = `-# Export ID: botbito-export:v1:${"a".repeat(64)}`;

const createHarness = (parentId = "forum") => {
  let starter: {
    id: string;
    content: string;
    author: { id: string };
    createdTimestamp: number;
    edit: jest.Mock<(options: { content: string }) => Promise<unknown>>;
    delete: jest.Mock<() => Promise<unknown>>;
  };
  starter = {
    id: "starter",
    content: `**Party 1:**\n01: Champ - <@111>\n02: Clown - <@333>\n\nParticipants: **2**\n\nVendor: **Vendor**\n*Your Time: <t:1793290800:F>* (*<t:1793290800:R>*)\n${exportIdentifier}`,
    author: { id: "bot" },
    createdTimestamp: 1,
    edit: jest.fn(async ({ content }: { content: string }) => {
      starter.content = content;
      return starter;
    }),
    delete: jest.fn(async () => undefined),
  };
  const memberList = new Map([
    ["111", {}],
    ["333", {}],
  ]);
  const thread = {
    id: `thread-${parentId}`,
    guildId: "guild",
    parentId,
    parent: { type: ChannelType.GuildForum },
    isThread: () => true,
    fetchStarterMessage: jest.fn(async () => starter),
    messages: {
      fetch: jest.fn(async () => ({
        size: 1,
        values: () => [starter],
        last: () => starter,
      })),
    },
    members: {
      fetch: jest.fn(async () => memberList),
      add: jest.fn(async (_userId: string) => undefined),
      remove: jest.fn(async (_userId: string) => undefined),
    },
    send: jest.fn(async () => undefined),
  };
  const editReply = jest.fn(async (_content: string) => undefined);
  const interaction = {
    guildId: "guild",
    guild: { channels: { fetch: jest.fn() } },
    channel: thread,
    client: { user: { id: "bot" } },
    user: { id: "editor" },
    options: { getString: jest.fn(() => "none") },
    deferReply: jest.fn(async () => undefined),
    editReply,
  };
  return { editReply, interaction, memberList, starter, thread };
};

describe("payout thread commands", () => {
  beforeEach(() => {
    syncPayoutExport.mockReset().mockResolvedValue("");
  });

  it("keeps a successful vendor edit when Sheets reports a failure", async () => {
    const { interaction, starter } = createHarness();
    syncPayoutExport.mockResolvedValueOnce(
      "Google Sheets was not confirmed updated. Please update Google Sheets manually.",
    );
    await changeShareVendorCommand.execute(interaction as never);
    expect(starter.content).toContain("Vendor: **none**");
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("Vendor updated to **none**."),
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("update Google Sheets manually"),
    );
  });

  it("allows retrying the same vendor value to repair a failed Sheets sync", async () => {
    const { interaction, starter } = createHarness();
    interaction.options.getString.mockReturnValue("Vendor");
    await changeShareVendorCommand.execute(interaction as never);
    expect(starter.edit).toHaveBeenCalled();
    expect(syncPayoutExport).toHaveBeenCalled();
  });
  it("registers the renamed slash commands", () => {
    expect(changeShareVendorCommand.data.name).toBe("changesharevendor");
    expect(changeShareParticipantsCommand.data.name).toBe(
      "changeshareparticipants",
    );
  });

  it("updates the vendor on a bot-generated payout post", async () => {
    const { editReply, interaction, starter } = createHarness();

    await changeShareVendorCommand.execute(interaction as never);

    expect(starter.edit).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Vendor: **none**"),
      }),
    );
    expect(editReply).toHaveBeenCalledWith("Vendor updated to **none**.");
  });

  it("rejects threads outside the configured payout forum", async () => {
    const { editReply, interaction, starter } = createHarness("other-forum");

    await changeShareVendorCommand.execute(interaction as never);

    expect(starter.edit).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(
      expect.stringContaining("configured payout channel"),
    );
  });

  it("recalculates participants and synchronizes thread membership", async () => {
    const { editReply, interaction, memberList, starter, thread } =
      createHarness();
    await changeShareParticipantsCommand.execute(interaction as never);
    expect(editReply).toHaveBeenCalledWith(
      expect.stringContaining("Current roster:"),
    );

    const reply = jest.fn(async (_content: string) => undefined);
    await handleShareParticipantsMessage({
      guildId: "guild",
      guild: interaction.guild,
      channelId: thread.id,
      channel: thread,
      client: interaction.client,
      author: { id: "editor", bot: false },
      content: "**Party 1:**\n01: Champ - <@222>\n02: Clown - <@333>",
      reply,
    } as never);

    expect(thread.members.add).toHaveBeenCalledWith("222");
    expect(thread.members.remove).toHaveBeenCalledWith("111");
    expect(starter.edit).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Participants: **2**"),
      }),
    );
    expect(starter.content).toContain("01: Champ - <@222>");
    expect(starter.content).not.toContain("<@111>");
    expect(memberList.has("333")).toBe(true);
    expect(reply).toHaveBeenCalledWith(
      "Roster updated successfully. Participants: **2**.",
    );
  });
});
