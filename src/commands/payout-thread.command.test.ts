import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ChannelType, type ChatInputCommandInteraction } from "discord.js";

const syncPayoutExport = jest.fn(async (..._args: unknown[]) => "");
const getSignupExportOrganizerId = jest.fn(
  async (_guildId: string, _threadId: string) => null as string | null,
);
const assertSignupExportEditable = jest.fn(
  async (_guildId: string, _threadId: string) => undefined,
);
let spreadsheetQueue: Promise<void> = Promise.resolve();
const queuePayoutSheetOperation = async <Result>(
  action: () => Promise<Result>,
): Promise<Result> => {
  const operation = spreadsheetQueue.then(action);
  spreadsheetQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
};
jest.unstable_mockModule("../services/payout-sheet-export.service.js", () => ({
  syncPayoutExport,
  queuePayoutSheetOperation,
}));
jest.unstable_mockModule("../services/signup-export.service.js", () => ({
  getSignupExportOrganizerId,
  assertSignupExportEditable,
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
  getSharePost,
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
    spreadsheetQueue = Promise.resolve();
    syncPayoutExport.mockReset().mockResolvedValue("");
    getSignupExportOrganizerId.mockReset().mockResolvedValue(null);
    assertSignupExportEditable.mockReset().mockResolvedValue(undefined);
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
    await handleShareParticipantsMessage({
      ...message,
      content: "done",
    } as never);
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

  it("rejects an empty vendor and inserts the vendor line when absent", async () => {
    const emptyVendor = createHarness();
    emptyVendor.interaction.options.getString.mockReturnValue("  ");
    await changeShareVendorCommand.execute(emptyVendor.interaction as never);
    expect(emptyVendor.starter.edit).not.toHaveBeenCalled();
    expect(emptyVendor.editReply).toHaveBeenCalledWith(
      expect.stringContaining("Enter a vendor name"),
    );

    const missingVendor = createHarness();
    missingVendor.starter.content = missingVendor.starter.content.replace(
      "Vendor: **Vendor**\n",
      "",
    );
    await changeShareVendorCommand.execute(missingVendor.interaction as never);
    expect(missingVendor.starter.content).toContain(
      "Vendor: **none**\n*Your Time:",
    );
  });

  it("reports non-Error vendor command failures", async () => {
    const { interaction, editReply } = createHarness();
    syncPayoutExport.mockRejectedValueOnce("thread unavailable");

    await changeShareVendorCommand.execute(interaction as never);

    expect(editReply).toHaveBeenCalledWith(
      "Could not update vendor: thread unavailable",
    );
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

  it("rejects non-thread and non-payout-guild status targets", async () => {
    const { interaction, thread } = createHarness();
    await expect(
      getSharePost(
        "guild",
        interaction.guild as never,
        { isThread: () => false } as never,
        "bot",
      ),
    ).rejects.toThrow("configured payout channel");
    await expect(
      getSharePost(
        "other-guild",
        interaction.guild as never,
        thread as never,
        "bot",
      ),
    ).rejects.toThrow("payout-enabled server");
  });

  it("ignores roster messages without an active edit from the same user", async () => {
    const { interaction, thread } = createHarness();
    const reply = jest.fn(async (_content: string) => undefined);
    const message = {
      guildId: "guild",
      guild: interaction.guild,
      channelId: thread.id,
      channel: thread,
      client: interaction.client,
      author: { id: "editor", bot: false },
      content: "done",
      reply,
    };

    await handleShareParticipantsMessage({
      ...message,
      guildId: null,
    } as never);
    await handleShareParticipantsMessage({
      ...message,
      author: { id: "bot", bot: true },
    } as never);
    await handleShareParticipantsMessage({
      ...message,
      channel: { isThread: () => false },
    } as never);
    await handleShareParticipantsMessage(message as never);

    await changeShareParticipantsCommand.execute(interaction as never);
    await handleShareParticipantsMessage({
      ...message,
      author: { id: "another-user", bot: false },
    } as never);
    expect(reply).not.toHaveBeenCalled();
  });

  it("requires roster content before done and rejects an oversized chunk", async () => {
    const { interaction, thread } = createHarness();
    await changeShareParticipantsCommand.execute(interaction as never);
    const makeMessage = (content: string) => ({
      guildId: "guild",
      guild: interaction.guild,
      channelId: thread.id,
      channel: thread,
      client: interaction.client,
      author: { id: "editor", bot: false },
      content,
      reply: jest.fn(async (_content: string) => undefined),
    });
    const emptyDone = makeMessage("done");
    await handleShareParticipantsMessage(emptyDone as never);
    expect(emptyDone.reply).toHaveBeenCalledWith(
      "Paste at least one roster message before `done`.",
    );

    const oversized = makeMessage("x".repeat(100_001));
    await handleShareParticipantsMessage(oversized as never);
    expect(oversized.reply).toHaveBeenCalledWith(
      expect.stringContaining("updated roster is too large to process"),
    );
  });

  it("validates payout starter identity and resolves an uncached forum parent", async () => {
    const { interaction, starter, thread } = createHarness();
    const guild = interaction.guild as never;

    await expect(
      getSharePost(null, guild, thread as never, "bot"),
    ).rejects.toThrow("payout-enabled server");
    await expect(
      getSharePost("guild", null, thread as never, "bot"),
    ).rejects.toThrow("payout-enabled server");
    await expect(
      getSharePost("guild", guild, thread as never, null),
    ).rejects.toThrow("bot user is unavailable");

    thread.fetchStarterMessage.mockImplementationOnce(
      async () => null as never,
    );
    await expect(
      getSharePost("guild", guild, thread as never, "bot"),
    ).rejects.toThrow("no starter post");

    starter.author.id = "another-bot";
    await expect(
      getSharePost("guild", guild, thread as never, "bot"),
    ).rejects.toThrow("not created by the bot");
    starter.author.id = "bot";
    starter.content = "Roster\n-# Export ID: invalid";
    await expect(
      getSharePost("guild", guild, thread as never, "bot"),
    ).rejects.toThrow("not created by the bot");
    starter.content = `Roster\n${exportIdentifier}`;
    await expect(
      getSharePost("guild", guild, thread as never, "bot"),
    ).rejects.toThrow("missing its Participants metadata");

    starter.content = `Roster\n\nParticipants: **2**\n${exportIdentifier}`;
    const uncachedThread = { ...thread, parent: undefined };
    interaction.guild.channels.fetch.mockResolvedValueOnce({
      type: ChannelType.GuildForum,
    });
    await expect(
      getSharePost("guild", guild, uncachedThread as never, "bot"),
    ).resolves.toMatchObject({ botId: "bot", starter });
    expect(interaction.guild.channels.fetch).toHaveBeenCalledWith("forum");
  });

  it("rejects a thread attached to another guild or a non-forum parent", async () => {
    const { interaction, thread } = createHarness();
    const guild = interaction.guild as never;

    await expect(
      getSharePost(
        "guild",
        guild,
        { ...thread, guildId: "other-guild" } as never,
        "bot",
      ),
    ).rejects.toThrow("configured payout channel");
    await expect(
      getSharePost(
        "guild",
        guild,
        { ...thread, parent: { type: ChannelType.GuildText } } as never,
        "bot",
      ),
    ).rejects.toThrow("not a forum channel");

    interaction.guild.channels.fetch.mockResolvedValueOnce({
      type: ChannelType.GuildText,
    });
    await expect(
      getSharePost(
        "guild",
        guild,
        { ...thread, parent: undefined } as never,
        "bot",
      ),
    ).rejects.toThrow("not a forum channel");
  });

  it("blocks vendor changes after share finalization has been selected", async () => {
    const { interaction, starter, editReply } = createHarness();
    assertSignupExportEditable.mockRejectedValueOnce(
      new Error("This payout is being finalized"),
    );

    await changeShareVendorCommand.execute(interaction as never);

    expect(starter.edit).not.toHaveBeenCalled();
    expect(syncPayoutExport).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(
      expect.stringContaining("This payout is being finalized"),
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

  it("uses a copy-from-thread prompt for a long current roster", async () => {
    const { interaction, starter, editReply } = createHarness();
    starter.content = `${"x".repeat(1_701)}\n\nParticipants: **2**\n${exportIdentifier}`;

    await changeShareParticipantsCommand.execute(interaction as never);

    expect(editReply).toHaveBeenCalledWith(
      expect.stringContaining(
        "Copy the current roster from this thread before editing it.",
      ),
    );
    expect(editReply).not.toHaveBeenCalledWith(
      expect.stringContaining("x".repeat(100)),
    );
  });

  it("rejects a submitted roster without participant mentions", async () => {
    const { interaction, thread } = createHarness();
    await changeShareParticipantsCommand.execute(interaction as never);
    const reply = jest.fn(async (_content: string) => undefined);
    const message = {
      guildId: "guild",
      guild: interaction.guild,
      channelId: thread.id,
      channel: thread,
      client: interaction.client,
      author: { id: "editor", bot: false },
      member: { permissions: { has: jest.fn(() => true) } },
      content: "Just a note, no participant IDs",
      reply,
    };

    await handleShareParticipantsMessage(message as never);
    await handleShareParticipantsMessage({
      ...message,
      content: "done",
    } as never);

    expect(reply).toHaveBeenLastCalledWith(
      "Could not update roster: Include a Discord mention for each roster participant.",
    );
    expect(thread.members.add).not.toHaveBeenCalled();
  });

  it("rejects an empty roster submission", async () => {
    const { interaction, thread } = createHarness();
    await changeShareParticipantsCommand.execute(interaction as never);
    const reply = jest.fn(async (_content: string) => undefined);
    const message = {
      guildId: "guild",
      guild: interaction.guild,
      channelId: thread.id,
      channel: thread,
      client: interaction.client,
      author: { id: "editor", bot: false },
      member: { permissions: { has: jest.fn(() => true) } },
      content: "   ",
      reply,
    };

    await handleShareParticipantsMessage(message as never);
    await handleShareParticipantsMessage({
      ...message,
      content: "done",
    } as never);

    expect(reply).toHaveBeenLastCalledWith(
      "Could not update roster: Paste the updated roster after the command.",
    );
  });

  it("rejects roster metadata that alone exceeds Discord's message limit", async () => {
    const { interaction, starter, thread } = createHarness();
    starter.content = `**Party 1:**\n01: Champ - <@111>\n\nParticipants: **2**${"x".repeat(2_001)}\n${exportIdentifier}`;
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
      makeMessage("01: Champ - <@222>") as never,
    );
    await handleShareParticipantsMessage(makeMessage("done") as never);

    expect(reply).toHaveBeenLastCalledWith(
      expect.stringContaining(
        "payout post metadata exceeds Discord's message limit",
      ),
    );
  });

  it("rejects an incomplete thread-message pagination cursor", async () => {
    const { interaction, thread, editReply, starter } = createHarness();
    thread.messages.fetch.mockResolvedValueOnce({
      size: 100,
      values: () => Array.from({ length: 100 }, () => starter),
      last: () => undefined,
    } as never);

    await changeShareParticipantsCommand.execute(interaction as never);

    expect(editReply).toHaveBeenCalledWith(
      expect.stringContaining("Could not finish reading the payout thread"),
    );
  });

  it("rejects a repeated pagination cursor", async () => {
    const { interaction, thread, editReply, starter } = createHarness();
    const page = {
      size: 100,
      values: () => [starter],
      last: () => ({ id: "same-cursor" }),
    };
    thread.messages.fetch
      .mockResolvedValueOnce(page as never)
      .mockResolvedValueOnce(page as never);

    await changeShareParticipantsCommand.execute(interaction as never);

    expect(thread.messages.fetch).toHaveBeenCalledTimes(2);
    expect(editReply).toHaveBeenCalledWith(
      expect.stringContaining("Could not finish reading the payout thread"),
    );
  });

  it("preserves blank lines between roster sections", async () => {
    const { interaction, starter, thread } = createHarness();
    await changeShareParticipantsCommand.execute(interaction as never);
    const roster = "**Party 1:**\n\n01: Champ - <@222>";
    const makeMessage = (content: string) => ({
      guildId: "guild",
      guild: interaction.guild,
      channelId: thread.id,
      channel: thread,
      client: interaction.client,
      author: { id: "editor", bot: false },
      member: { permissions: { has: jest.fn(() => true) } },
      content,
      reply: jest.fn(async (_content: string) => undefined),
    });

    await handleShareParticipantsMessage(makeMessage(roster) as never);
    await handleShareParticipantsMessage(makeMessage("done") as never);

    expect(starter.content).toContain("**Party 1:**\n\n01: Champ - <@222>");
  });

  it("moves an overlong but intact roster line to a continuation", async () => {
    const { interaction, followups, thread } = createHarness();
    await changeShareParticipantsCommand.execute(interaction as never);
    const roster = `01: Champ - <@222> ${"x".repeat(1_900)}`;
    const makeMessage = (content: string) => ({
      guildId: "guild",
      guild: interaction.guild,
      channelId: thread.id,
      channel: thread,
      client: interaction.client,
      author: { id: "editor", bot: false },
      member: { permissions: { has: jest.fn(() => true) } },
      content,
      reply: jest.fn(async (_content: string) => undefined),
    });

    await handleShareParticipantsMessage(makeMessage(roster) as never);
    await handleShareParticipantsMessage(makeMessage("done") as never);

    expect(followups[0]?.content).toContain("**Payout roster continued:**\n");
    expect(followups[0]?.content).toContain(roster);
  });

  it("rechecks a prepared roster edit inside the queue after finalization wins", async () => {
    const { interaction, starter, thread } = createHarness();
    await changeShareParticipantsCommand.execute(interaction as never);
    const message = {
      guildId: "guild",
      guild: interaction.guild,
      channelId: thread.id,
      channel: thread,
      client: interaction.client,
      author: { id: "editor", bot: false },
      member: { permissions: { has: jest.fn(() => true) } },
      content: "01: Champ - <@222>",
      reply: jest.fn(async (_content: string) => undefined),
    };
    await handleShareParticipantsMessage(message as never);

    let releaseFinalization!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseFinalization = resolve;
    });
    const finalization = queuePayoutSheetOperation(async () => {
      await blocked;
      assertSignupExportEditable.mockRejectedValue(
        new Error("This payout is being finalized"),
      );
    });
    const edit = handleShareParticipantsMessage({
      ...message,
      content: "done",
    } as never);
    expect(assertSignupExportEditable).toHaveBeenCalledTimes(1);
    releaseFinalization();
    await Promise.all([finalization, edit]);

    expect(assertSignupExportEditable).toHaveBeenCalledTimes(2);
    expect(starter.edit).not.toHaveBeenCalled();
    expect(thread.members.add).not.toHaveBeenCalled();
    expect(thread.members.remove).not.toHaveBeenCalled();
    expect(syncPayoutExport).not.toHaveBeenCalled();
    expect(message.reply).toHaveBeenLastCalledWith(
      expect.stringContaining("This payout is being finalized"),
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
      makeMessage(
        "01: Champ - <@111> (alt for <@222>)\n02: Clown - <@333>",
      ) as never,
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
      if (
        followup.content.startsWith(
          "**Payout roster continued (same line):**\n",
        )
      ) {
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
