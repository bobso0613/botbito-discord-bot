import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ChannelType, type ChatInputCommandInteraction } from "discord.js";

const syncPayoutExport = jest.fn(async (..._args: unknown[]) => "");
const getSignupExportOrganizerId = jest.fn(
  async (_guildId: string, _threadId: string) => null as string | null,
);
jest.unstable_mockModule("../services/payout-sheet-export.service.js", () => ({
  syncPayoutExport,
  queuePayoutSheetOperation: async (action: () => Promise<unknown>) => action(),
}));
jest.unstable_mockModule("../services/signup-export.service.js", () => ({
  getSignupExportOrganizerId,
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
  const followups: Array<{
    id: string;
    content: string;
    author: { id: string };
    createdTimestamp: number;
    edit: jest.Mock<(options: { content: string }) => Promise<unknown>>;
    delete: jest.Mock<() => Promise<unknown>>;
  }> = [];
  let nextMessageId = 0;
  const thread = {
    id: `thread-${parentId}`,
    guildId: "guild",
    parentId,
    parent: { type: ChannelType.GuildForum },
    isThread: () => true,
    fetchStarterMessage: jest.fn(async () => starter),
    messages: {
      fetch: jest.fn(async () => ({
        size: followups.length + 1,
        values: () => [starter, ...followups],
        last: () => followups.at(-1) ?? starter,
      })),
    },
    members: {
      fetch: jest.fn(async () => memberList),
      add: jest.fn(async (_userId: string) => undefined),
      remove: jest.fn(async (_userId: string) => undefined),
    },
    send: jest.fn(async ({ content }: { content: string }) => {
      const sent = {
        id: `followup-${++nextMessageId}`,
        content,
        author: { id: "bot" },
        createdTimestamp: nextMessageId + 1,
        edit: jest.fn(async ({ content: updated }: { content: string }) => {
          sent.content = updated;
          return sent;
        }),
        delete: jest.fn(async () => undefined),
      };
      followups.push(sent);
      return sent;
    }),
  };
  const editReply = jest.fn(
    async (_options: Parameters<ChatInputCommandInteraction["editReply"]>[0]) =>
      undefined,
  );
  const interaction = {
    guildId: "guild",
    guild: { channels: { fetch: jest.fn() } },
    channel: thread,
    channelId: thread.id,
    client: { user: { id: "bot" } },
    user: { id: "editor" },
    memberPermissions: { has: jest.fn(() => true) },
    options: { getString: jest.fn(() => "none") },
    deferReply: jest.fn(async () => undefined),
    editReply,
  };
  return { editReply, followups, interaction, memberList, starter, thread };
};

describe("payout thread commands", () => {
  beforeEach(() => {
    syncPayoutExport.mockReset().mockResolvedValue("");
    getSignupExportOrganizerId.mockReset().mockResolvedValue(null);
  });

  it("includes three-digit export slots when copying and replacing a roster", async () => {
    const { interaction, thread, memberList, editReply } = createHarness();
    const continuation = await thread.send({ content: "100: Champ - <@444>" });
    memberList.set("444", {});
    await changeShareParticipantsCommand.execute(interaction as never);
    expect(editReply).toHaveBeenCalledWith(
      expect.stringContaining("100: Champ - <@444>"),
    );
    const message = {
      guildId: "guild",
      guild: interaction.guild,
      channelId: thread.id,
      channel: thread,
      client: interaction.client,
      author: { id: "editor", bot: false },
      member: { permissions: { has: jest.fn(() => true) } },
      content: "01: Champ - <@111>\n02: Clown - <@333>",
      reply: jest.fn(async (_content: string) => undefined),
    };
    await handleShareParticipantsMessage(message as never);
    await handleShareParticipantsMessage({ ...message, content: "done" } as never);
    expect(thread.members.remove).toHaveBeenCalledWith("444");
    expect(continuation.delete).toHaveBeenCalled();
  });

  it("keeps a successful vendor edit when Sheets reports a failure", async () => {
    const { interaction, starter } = createHarness();
    syncPayoutExport.mockResolvedValueOnce(
      "Google Sheets was not confirmed updated. Please update Google Sheets manually.",
    );
    await changeShareVendorCommand.execute(interaction as never);
    expect(starter.content).toContain("Vendor: **none**");
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Vendor updated to **none**."),
        allowedMentions: { parse: [] },
      }),
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("update Google Sheets manually"),
        allowedMentions: { parse: [] },
      }),
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
    expect(editReply).toHaveBeenCalledWith({
      content: "Vendor updated to **none**.",
      allowedMentions: { parse: [] },
    });
  });

  it("preserves vendor replacement tokens and suppresses echoed mentions", async () => {
    const { editReply, interaction, starter } = createHarness();
    interaction.options.getString.mockReturnValue("$& <@123>");

    await changeShareVendorCommand.execute(interaction as never);

    expect(starter.content).toContain("Vendor: **$& <@123>**");
    expect(editReply).toHaveBeenCalledWith({
      content: "Vendor updated to **$& <@123>**.",
      allowedMentions: { parse: [] },
    });
    expect(syncPayoutExport).toHaveBeenCalledWith(
      expect.anything(),
      "thread-forum",
      expect.objectContaining({ vendor: "$& <@123>" }),
    );
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
    const makeMessage = (content: string) => ({
      guildId: "guild",
      guild: interaction.guild,
      channelId: thread.id,
      channel: thread,
      client: interaction.client,
      author: { id: "editor", bot: false },
      member: { permissions: { has: jest.fn(() => true) } },
      content,
      reply,
    });
    await handleShareParticipantsMessage(
      makeMessage("**Party 1:**\n01: Champ - <@222>") as never,
    );
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("Roster part received"),
    );
    await handleShareParticipantsMessage(
      makeMessage("02: Clown - <@!333>") as never,
    );
    await handleShareParticipantsMessage(makeMessage("done") as never);

    expect(thread.members.add).toHaveBeenCalledWith("222");
    expect(thread.members.remove).toHaveBeenCalledWith("111");
    expect(starter.edit).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Participants: **2**"),
      }),
    );
    expect(starter.content).toContain("01: Champ - <@222>");
    expect(starter.content).not.toContain("<@111>");
    expect(starter.content).toContain("02: Clown - <@333>");
    expect(starter.content).not.toContain("<@!333>");
    expect(memberList.has("333")).toBe(true);
    expect(reply).toHaveBeenCalledWith(
      "Roster updated successfully. Participants: **2**.",
    );
  });

  it("counts participant positions without treating roster notes as members", async () => {
    const { interaction, starter, thread } = createHarness();
    starter.content = starter.content.replace(
      "01: Champ - <@111>",
      "01: Champ - <@111> (alt for <@222>)",
    );
    await changeShareParticipantsCommand.execute(interaction as never);

    const reply = jest.fn(async (_content: string) => undefined);
    const makeMessage = (content: string) => ({
      guildId: "guild",
      guild: interaction.guild,
      channelId: thread.id,
      channel: thread,
      client: interaction.client,
      author: { id: "editor", bot: false },
      member: { permissions: { has: jest.fn(() => true) } },
      content,
      reply,
    });
    await handleShareParticipantsMessage(
      makeMessage("01: Champ - <@111> (alt for <@222>)\n02: Clown - <@333>") as never,
    );
    await handleShareParticipantsMessage(makeMessage("done") as never);

    expect(thread.members.add).not.toHaveBeenCalledWith("222");
    expect(syncPayoutExport).toHaveBeenCalledWith(
      expect.anything(),
      thread.id,
      expect.objectContaining({ userIds: ["111", "333"] }),
    );
  });

  it("preserves a valid 2,000-character roster line across continuation messages", async () => {
    const { interaction, followups, starter, thread } = createHarness();
    const longLine = `01: Champ - <@222> (${"x".repeat(1_979)})`;
    expect(longLine).toHaveLength(2_000);
    await changeShareParticipantsCommand.execute(interaction as never);

    const reply = jest.fn(async (_content: string) => undefined);
    const makeMessage = (content: string) => ({
      guildId: "guild",
      guild: interaction.guild,
      channelId: thread.id,
      channel: thread,
      client: interaction.client,
      author: { id: "editor", bot: false },
      member: { permissions: { has: jest.fn(() => true) } },
      content,
      reply,
    });
    await handleShareParticipantsMessage(makeMessage(longLine) as never);
    await handleShareParticipantsMessage(makeMessage("done") as never);

    let reconstructed = starter.content.split(
      /\n\nParticipants: \*\*\d+\*\*/,
    )[0]!;
    for (const followup of followups) {
      if (followup.content.startsWith("**Payout roster continued (same line):**\n")) {
        reconstructed += followup.content.slice(
          "**Payout roster continued (same line):**\n".length,
        );
      } else {
        reconstructed += `\n${followup.content.replace(
          "**Payout roster continued:**\n",
          "",
        )}`;
      }
    }
    expect(reconstructed).toBe(longLine);
    expect(followups[0]?.content).toContain(
      "**Payout roster continued (same line):**\n",
    );
  });

  it("keeps a newer participant edit session when an earlier completion finishes", async () => {
    const { interaction, thread } = createHarness();
    await changeShareParticipantsCommand.execute(interaction as never);

    let releaseAdd!: () => void;
    let signalAddStarted!: () => void;
    const addGate = new Promise<void>((resolve) => {
      releaseAdd = resolve;
    });
    const addStarted = new Promise<void>((resolve) => {
      signalAddStarted = resolve;
    });
    thread.members.add.mockImplementationOnce(async () => {
      signalAddStarted();
      await addGate;
    });
    const reply = jest.fn(async (_content: string) => undefined);
    const makeMessage = (authorId: string, content: string) => ({
      guildId: "guild",
      guild: interaction.guild,
      channelId: thread.id,
      channel: thread,
      client: interaction.client,
      author: { id: authorId, bot: false },
      member: { permissions: { has: jest.fn(() => true) } },
      content,
      reply,
    });
    await handleShareParticipantsMessage(
      makeMessage("editor", "01: Champ - <@222>") as never,
    );
    const earlierCompletion = handleShareParticipantsMessage(
      makeMessage("editor", "done") as never,
    );
    await addStarted;
    expect(thread.members.add).toHaveBeenCalledWith("222");

    const newerInteraction = {
      ...interaction,
      user: { id: "other-editor" },
    };
    await changeShareParticipantsCommand.execute(newerInteraction as never);
    releaseAdd();
    await earlierCompletion;
    await handleShareParticipantsMessage(
      makeMessage("other-editor", "01: Champ - <@444>") as never,
    );
    await handleShareParticipantsMessage(
      makeMessage("other-editor", "done") as never,
    );

    expect(thread.members.add).toHaveBeenCalledWith("444");
    expect(syncPayoutExport).toHaveBeenCalledTimes(2);
  });

  it("allows only the organizer or a Manage Server member to edit a payout", async () => {
    const { interaction, starter, editReply } = createHarness();
    interaction.memberPermissions.has.mockReturnValue(false);
    await changeShareVendorCommand.execute(interaction as never);
    expect(starter.edit).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(
      expect.stringContaining("Only the original organizer"),
    );

    getSignupExportOrganizerId.mockResolvedValueOnce("editor");
    await changeShareVendorCommand.execute(interaction as never);
    expect(starter.edit).toHaveBeenCalledTimes(1);
  });

  it("rechecks roster-editor authorization when the completed roster is applied", async () => {
    const { interaction, starter, thread } = createHarness();
    interaction.memberPermissions.has.mockReturnValue(false);
    getSignupExportOrganizerId
      .mockResolvedValueOnce("editor")
      .mockResolvedValueOnce(null);
    await changeShareParticipantsCommand.execute(interaction as never);

    const reply = jest.fn(async (_content: string) => undefined);
    const makeMessage = (content: string) => ({
      guildId: "guild",
      guild: interaction.guild,
      channelId: thread.id,
      channel: thread,
      client: interaction.client,
      author: { id: "editor", bot: false },
      member: { permissions: { has: jest.fn(() => false) } },
      content,
      reply,
    });
    await handleShareParticipantsMessage(
      makeMessage("**Party 1:**\n01: Champ - <@222>") as never,
    );
    await handleShareParticipantsMessage(makeMessage("done") as never);

    expect(starter.edit).not.toHaveBeenCalled();
    expect(thread.members.add).not.toHaveBeenCalled();
    expect(reply).toHaveBeenLastCalledWith(
      expect.stringContaining("Only the original organizer"),
    );
  });

  it.each([false, true])(
    "rolls membership back in reverse order even when rollback fails: %s",
    async (rollbackFails) => {
      const { interaction, memberList, thread } = createHarness();
      await changeShareParticipantsCommand.execute(interaction as never);
      thread.members.remove.mockRejectedValueOnce(new Error("remove failed"));
      if (rollbackFails) {
        thread.members.remove
          .mockRejectedValueOnce(new Error("first rollback failed"))
          .mockRejectedValueOnce(new Error("second rollback failed"));
      }

      const reply = jest.fn(async (_content: string) => undefined);
      const message = {
        guildId: "guild",
        guild: interaction.guild,
        channelId: thread.id,
        channel: thread,
        client: interaction.client,
        author: { id: "editor", bot: false },
        member: { permissions: { has: jest.fn(() => true) } },
        content: "**Party 1:**\n01: Champ - <@222>\n02: Clown - <@444>",
        reply,
      };
      await handleShareParticipantsMessage(message as never);
      await handleShareParticipantsMessage({
        ...message,
        content: "done",
      } as never);

      expect(thread.members.add).toHaveBeenNthCalledWith(1, "222");
      expect(thread.members.add).toHaveBeenNthCalledWith(2, "444");
      expect(thread.members.remove).toHaveBeenNthCalledWith(1, "111");
      expect(thread.members.remove).toHaveBeenNthCalledWith(2, "444");
      expect(thread.members.remove).toHaveBeenNthCalledWith(3, "222");
      expect(memberList.has("111")).toBe(true);
      expect(reply).toHaveBeenLastCalledWith(
        rollbackFails
          ? expect.stringContaining("2 rollback operation(s) failed")
          : "Could not update roster: remove failed",
      );
      expect(syncPayoutExport).not.toHaveBeenCalled();
    },
  );

  it("restores the original roster and membership when a later message send fails", async () => {
    const { interaction, starter, thread } = createHarness();
    const originalContent = starter.content;
    await changeShareParticipantsCommand.execute(interaction as never);
    thread.send.mockRejectedValueOnce(new Error("send failed"));

    const reply = jest.fn(async (_content: string) => undefined);
    const makeMessage = (content: string) => ({
      guildId: "guild",
      guild: interaction.guild,
      channelId: thread.id,
      channel: thread,
      client: interaction.client,
      author: { id: "editor", bot: false },
      member: { permissions: { has: jest.fn(() => true) } },
      content,
      reply,
    });
    await handleShareParticipantsMessage(
      makeMessage(
        `01: Champ - <@222> (${"x".repeat(1_950)})\n02: Clown - <@333>`,
      ) as never,
    );
    await handleShareParticipantsMessage(makeMessage("done") as never);

    expect(starter.content).toBe(originalContent);
    expect(thread.members.add).toHaveBeenCalledWith("222");
    expect(thread.members.add).toHaveBeenCalledWith("111");
    expect(thread.members.remove).toHaveBeenCalledWith("111");
    expect(thread.members.remove).toHaveBeenCalledWith("222");
    expect(reply).toHaveBeenLastCalledWith(
      "Could not update roster: send failed",
    );
    expect(syncPayoutExport).not.toHaveBeenCalled();
  });

  it("supports metadata-only starters and marks arbitrary continuation chunks", async () => {
    const { interaction, starter, followups, thread } = createHarness();
    starter.content = `Participants: **2**\n\nVendor: **Vendor**\n${exportIdentifier}`;
    await changeShareParticipantsCommand.execute(interaction as never);

    const reply = jest.fn(async (_content: string) => undefined);
    const makeMessage = (content: string) => ({
      guildId: "guild",
      guild: interaction.guild,
      channelId: thread.id,
      channel: thread,
      client: interaction.client,
      author: { id: "editor", bot: false },
      member: { permissions: { has: jest.fn(() => true) } },
      content,
      reply,
    });
    await handleShareParticipantsMessage(
      makeMessage(
        `01: Champ - <@222> (${"x".repeat(1_950)})\n02: Clown - <@333>`,
      ) as never,
    );
    await handleShareParticipantsMessage(makeMessage("done") as never);

    expect(starter.content).toMatch(/^Participants: \*\*2\*\*/);
    expect(followups[0]?.content).toMatch(/^\*\*Payout roster continued:\*\*/);

    await changeShareParticipantsCommand.execute(interaction as never);
    await handleShareParticipantsMessage(
      makeMessage("02: Clown - <@333>") as never,
    );
    await handleShareParticipantsMessage(makeMessage("done") as never);
    expect(followups[0]?.delete).toHaveBeenCalled();
    expect(starter.content).toContain("- <@333>");
  });

  it("deletes surplus roster continuations from the end before rollback", async () => {
    const { interaction, followups, starter, thread } = createHarness();
    const earlier = await thread.send({
      content: "**Payout roster continued:**\n01: First - <@111>",
    });
    const later = await thread.send({
      content: "**Payout roster continued:**\n02: Second - <@333>",
    });
    later.delete.mockRejectedValueOnce(new Error("delete failed"));
    const originalContent = starter.content;
    await changeShareParticipantsCommand.execute(interaction as never);

    const reply = jest.fn(async (_content: string) => undefined);
    const makeMessage = (content: string) => ({
      guildId: "guild",
      guild: interaction.guild,
      channelId: thread.id,
      channel: thread,
      client: interaction.client,
      author: { id: "editor", bot: false },
      member: { permissions: { has: jest.fn(() => true) } },
      content,
      reply,
    });
    await handleShareParticipantsMessage(
      makeMessage("**Party 1:**\n01: Champ - <@111>") as never,
    );
    await handleShareParticipantsMessage(makeMessage("done") as never);

    expect(later.delete).toHaveBeenCalledTimes(1);
    expect(earlier.delete).not.toHaveBeenCalled();
    expect(followups).toEqual([earlier, later]);
    expect(starter.content).toBe(originalContent);
    expect(reply).toHaveBeenLastCalledWith(
      "Could not update roster: delete failed",
    );
  });
});
