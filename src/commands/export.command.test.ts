import { jest } from "@jest/globals";
import { createHash } from "node:crypto";
import { ChannelType, Collection } from "discord.js";
import type { SignupSheet } from "../types/signup-sheet.js";
import type { InstanceType } from "../constants/cooldowns.js";

const settings = {
  payoutSheetChannelIdByGuild: { guild: "forum" },
  cooldownInstanceTypesByGuild: {} as Record<string, InstanceType[]>,
};
const getSignupSheet = jest.fn<() => Promise<SignupSheet | null>>();
const exportHistory = new Map<string, string>();
const exportSignupRun = jest.fn(
  async (
    guildId: string,
    runKey: string,
    createThread: () => Promise<string>,
    findExistingThread: () => Promise<string | null>,
  ) => {
    const key = `${guildId}:${runKey}`;
    const existing = exportHistory.get(key);
    if (existing) return { created: false, threadId: existing };
    const found = await findExistingThread();
    if (found) {
      exportHistory.set(key, found);
      return { created: false, threadId: found };
    }
    const threadId = await createThread();
    exportHistory.set(key, threadId);
    return { created: true, threadId };
  },
);
jest.unstable_mockModule("../services/signup-export.service.js", () => ({
  exportSignupRun,
}));
jest.unstable_mockModule("../config/discord-settings.js", () => ({
  DISCORD_SETTINGS: settings,
  PAYOUT_GUILD_IDS: ["guild"],
}));
jest.unstable_mockModule("../services/signup-sheet.service.js", () => ({
  getSignupSheet,
}));
const { executeExport, exportCommand } = await import("./export.command.js");

const buildSheet = (): SignupSheet => ({
  guildId: "guild",
  channelId: "signup",
  title: "Endless Tower",
  organizerId: "organizer",
  organizerName: "Organizer",
  organizerAvatarUrl: "",
  partySizes: [3],
  slots: [
    {
      number: 1,
      role: "Champ",
      signupUserId: "alice",
      signupDisplayName: "Alice",
      charNote: "Main",
    },
    {
      number: 2,
      role: "DPS",
      signupUserId: null,
      signupDisplayName: null,
      charNote: null,
    },
    {
      number: 3,
      role: "Priest",
      signupUserId: "tbc-user",
      signupDisplayName: "TBC User",
      charNote: null,
      isTbc: true,
    },
  ],
  reserves: [{ userId: "reserve", displayName: "Reserve", charNote: null }],
  notes: null,
  thumbnailUrl: null,
  color: null,
  instanceType: null,
  timestamp: Date.UTC(2026, 8, 30, 23, 30) / 1000,
  serverTimezone: "GMT+8",
  scheduleTimezone: "GMT",
});
const schedule = `*Your Time: <t:${buildSheet().timestamp}:F>* (*<t:${buildSheet().timestamp}:R>*)`;
const identifier = `-# Export ID: botbito-export:v1:${createHash("sha256")
  .update(
    JSON.stringify(["guild", JSON.stringify(["endless tower", "2026-10-01"])]),
  )
  .digest("hex")}`;
const buildThread = (id: string, content: string, authorId = "bot") => ({
  id,
  archiveTimestamp: Date.UTC(2026, 9, 1),
  fetchStarterMessage: jest.fn(async () => ({
    content,
    author: { id: authorId },
  })),
});
const createInteraction = () => {
  const create = jest.fn(async () => ({ id: "thread", send: jest.fn() }));
  const forum = {
    type: ChannelType.GuildForum,
    client: { user: { id: "bot" } },
    threads: {
      create,
      fetchActive: jest.fn(async () => ({
        threads: new Collection<string, ReturnType<typeof buildThread>>(),
      })),
      fetchArchived: jest.fn(async () => ({
        threads: new Collection<string, ReturnType<typeof buildThread>>(),
        hasMore: false,
      })),
    },
  };
  return {
    guildId: "guild",
    channelId: "signup",
    user: { id: "organizer" },
    isChatInputCommand: () => true,
    options: {
      getString: jest.fn((name: string): string | null =>
        name === "vendor" ? "Vendor" : null,
      ),
      getBoolean: jest.fn((): boolean | null => null),
    },
    guild: { channels: { fetch: jest.fn(async () => forum) } },
    forum,
    deferReply: jest.fn(),
    editReply: jest.fn(),
    create,
  };
};

describe("/export", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    exportHistory.clear();
    settings.payoutSheetChannelIdByGuild.guild = "forum";
    settings.cooldownInstanceTypesByGuild = {};
    getSignupSheet.mockResolvedValue(buildSheet());
  });
  it("registers only in payout guilds", () => {
    expect(exportCommand.guildIds).toEqual(["guild"]);
  });
  it("exports confirmed filled slots, excluding reserves and TBC users from content and mentions", async () => {
    const interaction = createInteraction();
    await executeExport(interaction as never);
    expect(interaction.deferReply).toHaveBeenCalledWith();
    expect(interaction.create).toHaveBeenCalledWith({
      name: "\u23f3Endless Tower - 01/10",
      message: {
        content: `**Party 1:**\n01: Champ - <@alice> (Main)\n\nParticipants: **1**\n\nVendor: **Vendor**\n${schedule}\n${identifier}`,
        allowedMentions: { parse: [], users: ["alice"] },
      },
    });
    expect(interaction.editReply).toHaveBeenCalledWith(
      "Exported the signup roster to <#thread>. Vendor - **Vendor**",
    );
  });
  it.each([
    {
      instanceType: "Endless Tower",
      emojis: "\u{1FA9C}",
      details: "\u{1FA9C} **Endless Tower**",
    },
    {
      instanceType: ["Endless Tower", "Endless Cellar"],
      emojis: "\u{1FA9C} \u{1F4C9}",
      details: "\u{1FA9C} **Endless Tower**, \u{1F4C9} **Endless Cellar**",
    },
  ])(
    "exports instance metadata for $instanceType with localized and relative timestamps",
    async ({ instanceType, emojis, details }) => {
      getSignupSheet.mockResolvedValue({ ...buildSheet(), instanceType });
      const interaction = createInteraction();
      await executeExport(interaction as never);
      expect(interaction.create).toHaveBeenCalledWith({
        name: `\u23f3Endless Tower - 01/10 [${emojis}]`,
        message: {
          content: `**Party 1:**\n01: Champ - <@alice> (Main)\n\nParticipants: **1**\n\nVendor: **Vendor**\nInstance Types: ${details}\n${schedule}\n${identifier}`,
          allowedMentions: { parse: [], users: ["alice"] },
        },
      });
    },
  );

  it("uses guild-specific instance emojis rather than built-in defaults", async () => {
    settings.cooldownInstanceTypesByGuild.guild = [
      {
        name: "Endless Tower",
        emoji: "\u{1F525}",
        keywords: [],
        maxAttempts: 1,
      },
      {
        name: "Custom Run",
        emoji: "\u{1F6E1}\uFE0F",
        keywords: [],
        maxAttempts: 1,
      },
    ];
    getSignupSheet.mockResolvedValue({
      ...buildSheet(),
      instanceType: ["Endless Tower", "Custom Run"],
    });
    const interaction = createInteraction();
    await executeExport(interaction as never);
    expect(interaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "\u23f3Endless Tower - 01/10 [\u{1F525} \u{1F6E1}\uFE0F]",
        message: expect.objectContaining({
          content: expect.stringContaining(
            "Instance Types: \u{1F525} **Endless Tower**, \u{1F6E1}\uFE0F **Custom Run**",
          ),
        }),
      }),
    );
  });

  it("splits multi-instance exports and omits first-run absent slots from the first post only", async () => {
    const base = buildSheet();
    getSignupSheet.mockResolvedValue({
      ...base,
      instanceType: ["Endless Tower", "Endless Cellar"],
      slots: base.slots.map((slot) =>
        slot.number === 2
          ? { ...slot, signupUserId: "bob", signupDisplayName: "Bob" }
          : slot,
      ),
    });
    const interaction = createInteraction();
    const options: Record<string, string | boolean> = {
      vendor: "Vendor",
      split: true,
      "first-run-absent-slots": "1",
    };
    interaction.options.getString.mockImplementation(
      (name: string) => (options[name] as string | undefined) ?? null,
    );
    interaction.options.getBoolean.mockImplementation(() => true);
    await executeExport(interaction as never);
    const calls = interaction.create.mock.calls as unknown as Array<
      [{ name: string; message: { content: string } }]
    >;
    expect(calls.map(([call]) => call.name)).toEqual([
      "\u23f3(ET) Endless Tower - 01/10 [\u{1FA9C}]",
      "\u23f3(EC) Endless Tower - 01/10 [\u{1F4C9}]",
    ]);
    expect(calls[0]![0].message.content).not.toContain("<@alice>");
    expect(calls[0]![0].message.content).toContain("<@bob>");
    expect(calls[1]![0].message.content).toContain("<@alice>");
  });

  it("rejects invalid first-run absent slots", async () => {
    const interaction = createInteraction();
    interaction.options.getString.mockImplementation((name: string) =>
      name === "vendor" ? "Vendor" : "abc",
    );
    await executeExport(interaction as never);
    expect(interaction.create).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("Invalid first run absent slot"),
    );
  });

  it("keeps unknown instance names without inventing an emoji", async () => {
    getSignupSheet.mockResolvedValue({
      ...buildSheet(),
      instanceType: "Unknown Run",
    });
    const interaction = createInteraction();
    await executeExport(interaction as never);
    expect(interaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "\u23f3Endless Tower - 01/10",
        message: expect.objectContaining({
          content: expect.stringContaining(
            `Participants: **1**\n\nVendor: **Vendor**\nInstance Types: **Unknown Run**\n${schedule}\n${identifier}`,
          ),
        }),
      }),
    );
  });

  it("preserves the date and instance emojis when shortening a long title", async () => {
    getSignupSheet.mockResolvedValue({
      ...buildSheet(),
      title: "Run ".repeat(40),
      instanceType: ["Endless Tower", "Endless Cellar"],
    });
    const interaction = createInteraction();
    await executeExport(interaction as never);
    const [{ name }] = interaction.create.mock.calls[0] as unknown as [
      { name: string },
    ];
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith(" - 01/10 [\u{1FA9C} \u{1F4C9}]")).toBe(true);
  });

  it("rejects metadata that cannot fit Discord's first-message limit", async () => {
    getSignupSheet.mockResolvedValue({
      ...buildSheet(),
      instanceType: "Long name ".repeat(220),
    });
    const interaction = createInteraction();
    await executeExport(interaction as never);
    expect(interaction.create).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("instance-type names"),
    );
  });

  it("rejects instance emojis that cannot fit the thread title", async () => {
    settings.cooldownInstanceTypesByGuild.guild = [
      { name: "Custom", emoji: "x".repeat(100), keywords: [], maxAttempts: 1 },
    ];
    getSignupSheet.mockResolvedValue({
      ...buildSheet(),
      instanceType: "Custom",
    });
    const interaction = createInteraction();
    await executeExport(interaction as never);
    expect(interaction.create).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("thread title limit"),
    );
  });

  it("does not create a thread when every filled slot is TBC", async () => {
    const sheet = buildSheet();
    sheet.slots = sheet.slots.map((slot) => ({ ...slot, isTbc: true }));
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction();
    await executeExport(interaction as never);
    expect(interaction.create).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      "There are no filled, non-TBC signup slots to export.",
    );
  });

  it("detects the identifier in an active bot-authored post without local history", async () => {
    const interaction = createInteraction();
    interaction.forum.threads.fetchActive.mockResolvedValueOnce({
      threads: new Collection([
        ["existing", buildThread("existing", `Roster\n\n${identifier}`)],
      ]),
    });
    await executeExport(interaction as never);
    expect(interaction.create).not.toHaveBeenCalled();
    expect(interaction.forum.threads.fetchArchived).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      "This run has already been exported for this date: <#existing>.",
    );
  });

  it("detects matching identifiers beyond the first page of archived posts", async () => {
    const interaction = createInteraction();
    const first = buildThread("unrelated", "Other run");
    interaction.forum.threads.fetchArchived
      .mockResolvedValueOnce({
        threads: new Collection([[first.id, first]]),
        hasMore: true,
      })
      .mockResolvedValueOnce({
        threads: new Collection([
          ["archived", buildThread("archived", `Roster\n\n${identifier}`)],
        ]),
        hasMore: false,
      });
    await executeExport(interaction as never);
    expect(interaction.create).not.toHaveBeenCalled();
    expect(interaction.forum.threads.fetchArchived).toHaveBeenNthCalledWith(2, {
      limit: 100,
      before: new Date(first.archiveTimestamp),
    });
    expect(interaction.editReply).toHaveBeenCalledWith(
      "This run has already been exported for this date: <#archived>.",
    );
  });

  it("ignores copied identifiers in posts not authored by this bot", async () => {
    const interaction = createInteraction();
    interaction.forum.threads.fetchActive.mockResolvedValueOnce({
      threads: new Collection([
        ["copied", buildThread("copied", identifier, "other-user")],
      ]),
    });
    await executeExport(interaction as never);
    expect(interaction.create).toHaveBeenCalledTimes(1);
  });

  it("only matches the exact identifier footer, not an identifier in the middle of content", async () => {
    const interaction = createInteraction();
    interaction.forum.threads.fetchActive.mockResolvedValueOnce({
      threads: new Collection([
        ["unrelated", buildThread("unrelated", `${identifier}\nNot a footer`)],
      ]),
    });
    await executeExport(interaction as never);
    expect(interaction.create).toHaveBeenCalledTimes(1);
  });

  it("does not create a post if existing forum content cannot be checked", async () => {
    const interaction = createInteraction();
    interaction.forum.threads.fetchActive.mockRejectedValueOnce(
      new Error("Missing permissions"),
    );
    await executeExport(interaction as never);
    expect(interaction.create).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("Could not create"),
    );
  });

  it("keeps the identifier stable across title casing, whitespace, and same-day time changes", async () => {
    const sheet = buildSheet();
    sheet.title = "  ENDLESS   TOWER  ";
    sheet.timestamp! += 3600;
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction();
    await executeExport(interaction as never);
    expect(interaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          content: expect.stringContaining(identifier),
        }),
      }),
    );
  });
  it("rejects another export of the same run and date with the existing thread link", async () => {
    const first = createInteraction();
    await executeExport(first as never);
    const second = createInteraction();
    await executeExport(second as never);
    expect(first.create).toHaveBeenCalledTimes(1);
    expect(second.create).not.toHaveBeenCalled();
    expect(second.editReply).toHaveBeenCalledWith(
      "This run has already been exported for this date: <#thread>.",
    );
  });
  it("does not allow time changes on the same calendar date to bypass the guard", async () => {
    await executeExport(createInteraction() as never);
    const sheet = buildSheet();
    sheet.timestamp! += 3600;
    sheet.title = "  ENDLESS   TOWER  ";
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction();
    await executeExport(interaction as never);
    expect(interaction.create).not.toHaveBeenCalled();
  });
  it("allows the same run on a different date", async () => {
    await executeExport(createInteraction() as never);
    const sheet = buildSheet();
    sheet.timestamp! += 86400;
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction();
    await executeExport(interaction as never);
    expect(interaction.create).toHaveBeenCalledTimes(1);
  });
  it("allows a different run on the same date", async () => {
    await executeExport(createInteraction() as never);
    getSignupSheet.mockResolvedValue({
      ...buildSheet(),
      title: "Endless Cellar",
    });
    const interaction = createInteraction();
    await executeExport(interaction as never);
    expect(interaction.create).toHaveBeenCalledTimes(1);
  });
  it.each(["other", ""])("rejects non-organizers (%s)", async (userId) => {
    const interaction = createInteraction();
    interaction.user.id = userId;
    await executeExport(interaction as never);
    expect(interaction.deferReply).toHaveBeenCalledWith();
    expect(interaction.create).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("Only the run organizer"),
    );
  });

  it("rejects the stored organizer ID when the displayed Discord avatar belongs to someone else", async () => {
    const sheet = buildSheet();
    sheet.organizerId = "92073343238279168";
    sheet.organizerName = "Different Organizer";
    sheet.organizerAvatarUrl =
      "https://cdn.discordapp.com/avatars/122921412129325060/avatar.png?size=512";
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction();
    interaction.user.id = sheet.organizerId;
    await executeExport(interaction as never);
    expect(interaction.create).not.toHaveBeenCalled();
    expect(exportSignupRun).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("/swaporganizer"),
    );
  });

  it("allows an organizer whose ID and Discord avatar agree", async () => {
    const sheet = buildSheet();
    sheet.organizerId = "122921412129325060";
    sheet.organizerAvatarUrl =
      "https://cdn.discordapp.com/avatars/122921412129325060/avatar.png";
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction();
    interaction.user.id = sheet.organizerId;
    await executeExport(interaction as never);
    expect(interaction.create).toHaveBeenCalledTimes(1);
  });

  it("rechecks the organizer after waiting for forum lookup and before creating the post", async () => {
    const sheet = buildSheet();
    getSignupSheet
      .mockResolvedValueOnce(sheet)
      .mockResolvedValue({ ...sheet, organizerId: "new-organizer" });
    const interaction = createInteraction();
    await executeExport(interaction as never);
    expect(interaction.create).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("Only the run organizer"),
    );
  });

  it("does not export a stale run when its scheduled date changes during lookup", async () => {
    const sheet = buildSheet();
    getSignupSheet
      .mockResolvedValueOnce(sheet)
      .mockResolvedValue({ ...sheet, timestamp: sheet.timestamp! + 86400 });
    const interaction = createInteraction();
    await executeExport(interaction as never);
    expect(interaction.create).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("run title or date changed"),
    );
  });

  it("renumbers filled slots 2 and 3 as 1 and 2 without changing the signup sheet", async () => {
    const sheet = buildSheet();
    sheet.partySizes = [4];
    sheet.slots = [
      { ...sheet.slots[1]!, number: 1 },
      {
        ...sheet.slots[0]!,
        number: 2,
        role: "High Priest",
        signupUserId: "keira",
        charNote: "test char",
      },
      {
        ...sheet.slots[0]!,
        number: 3,
        role: "Clown",
        signupUserId: "bob",
        charNote: "bobitott",
      },
      { ...sheet.slots[2]!, number: 4 },
    ];
    const original = structuredClone(sheet);
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction();
    await executeExport(interaction as never);
    expect(interaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: {
          content: `**Party 1:**\n01: High Priest - <@keira> (test char)\n02: Clown - <@bob> (bobitott)\n\nParticipants: **2**\n\nVendor: **Vendor**\n${schedule}\n${identifier}`,
          allowedMentions: { parse: [], users: ["keira", "bob"] },
        },
      }),
    );
    expect(sheet).toEqual(original);
  });

  it("preserves party numbers and counts unique people before the export identifier", async () => {
    const sheet = buildSheet();
    sheet.partySizes = [2, 2, 1];
    sheet.slots = [
      sheet.slots[0]!,
      sheet.slots[1]!,
      { ...sheet.slots[0]!, number: 3, role: "Priest", charNote: null },
      {
        ...sheet.slots[0]!,
        number: 4,
        role: "DPS",
        signupUserId: "bob",
        charNote: null,
        isTbc: false,
      },
      { ...sheet.slots[2]!, number: 5 },
    ];
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction();
    await executeExport(interaction as never);
    expect(interaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: {
          content: `**Party 1:**\n01: Champ - <@alice> (Main)\n**Party 2:**\n02: Priest - <@alice>\n03: DPS - <@bob>\n\nParticipants: **2**\n\nVendor: **Vendor**\n${schedule}\n${identifier}`,
          allowedMentions: { parse: [], users: ["alice", "bob"] },
        },
      }),
    );
  });
  it("rejects payout-disabled guilds", async () => {
    const interaction = createInteraction();
    interaction.guildId = "other";
    await executeExport(interaction as never);
    expect(getSignupSheet).not.toHaveBeenCalled();
    expect(interaction.create).not.toHaveBeenCalled();
  });
  it.each(["missing", "date", "empty", "legacy organizer"])(
    "rejects a %s sheet",
    async (reason) => {
      const sheet = buildSheet();
      if (reason === "date") sheet.timestamp = null;
      if (reason === "empty") sheet.slots = [];
      if (reason === "legacy organizer") delete sheet.organizerId;
      getSignupSheet.mockResolvedValue(reason === "missing" ? null : sheet);
      const interaction = createInteraction();
      await executeExport(interaction as never);
      expect(interaction.create).not.toHaveBeenCalled();
    },
  );
  it("requires a configured payout channel", async () => {
    settings.payoutSheetChannelIdByGuild.guild = "";
    const interaction = createInteraction();
    await executeExport(interaction as never);
    expect(interaction.create).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("payout-channel-id"),
    );
  });
  it("handles Discord failures without reporting success", async () => {
    const interaction = createInteraction();
    interaction.create.mockRejectedValue(new Error("Missing permissions"));
    await executeExport(interaction as never);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("Could not create"),
    );
    const retry = createInteraction();
    await executeExport(retry as never);
    expect(retry.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a configured channel that is no longer a forum", async () => {
    const interaction = createInteraction();
    interaction.guild.channels.fetch.mockResolvedValueOnce({
      ...interaction.forum,
      type: ChannelType.GuildText,
    });
    await executeExport(interaction as never);
    expect(interaction.create).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("must be a forum"),
    );
  });

  it("splits long rosters without dropping slots", async () => {
    const sheet = buildSheet();
    sheet.partySizes = [40];
    sheet.slots = Array.from({ length: 40 }, (_, index) => ({
      ...sheet.slots[0]!,
      number: index + 1,
      role: "A long role name ".repeat(4),
    }));
    getSignupSheet.mockResolvedValue(sheet);
    const send = jest.fn();
    const interaction = createInteraction();
    interaction.create.mockResolvedValueOnce({ id: "thread", send });
    await executeExport(interaction as never);
    const initial = interaction.create.mock.calls[0] as unknown as [
      { message: { content: string } },
    ];
    const contents = [
      initial[0].message.content,
      ...send.mock.calls.map(
        (call) => (call[0] as { content: string }).content,
      ),
    ];
    expect(contents.length).toBeGreaterThan(1);
    expect(contents.every((content) => content.length <= 2000)).toBe(true);
    expect(
      contents
        .join("\n")
        .split("\n")
        .filter((line) => /^\d+:/.test(line)),
    ).toHaveLength(40);
    expect(contents[0]?.endsWith(identifier)).toBe(true);
    expect(contents.at(-1)).toContain("40:");
  });

  it("keeps a maximum-length slot intact while reserving a first-message identifier", async () => {
    const sheet = buildSheet();
    sheet.partySizes = [1];
    const fixedText = "01:  - <@alice> (Main)";
    sheet.slots = [
      { ...sheet.slots[0]!, role: "x".repeat(2000 - fixedText.length) },
    ];
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction();
    const send = jest.fn();
    interaction.create.mockResolvedValueOnce({ id: "thread", send });
    await executeExport(interaction as never);
    expect(interaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: {
          content: `**Party 1:**\n\nParticipants: **1**\n\nVendor: **Vendor**\n${schedule}\n${identifier}`,
          allowedMentions: { parse: [], users: [] },
        },
      }),
    );
    const [payload] = send.mock.calls[0] as [{ content: string }];
    expect(payload.content).toHaveLength(2000);
    expect(payload.content).toContain("<@alice>");
  });

  it("reports partial delivery with a link to the created thread", async () => {
    const sheet = buildSheet();
    sheet.partySizes = [30];
    sheet.slots = Array.from({ length: 30 }, (_, index) => ({
      ...sheet.slots[0]!,
      number: index + 1,
      role: "Long role ".repeat(8),
    }));
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction();
    const send = jest
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("Send failed"));
    interaction.create.mockResolvedValueOnce({ id: "thread", send });
    await executeExport(interaction as never);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("Created <#thread>, but could not send"),
    );
    const retry = createInteraction();
    await executeExport(retry as never);
    expect(retry.create).not.toHaveBeenCalled();
  });

  it("formats October 21 as 21/10 in the thread title", async () => {
    getSignupSheet.mockResolvedValue({
      ...buildSheet(),
      timestamp: Date.UTC(2026, 9, 21, 12) / 1000,
    });
    const interaction = createInteraction();
    await executeExport(interaction as never);
    expect(interaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "\u23f3Endless Tower - 21/10",
      }),
    );
  });

  it("keeps different years distinct even when the displayed day and month match", async () => {
    await executeExport(createInteraction() as never);
    getSignupSheet.mockResolvedValue({
      ...buildSheet(),
      timestamp: Date.UTC(2027, 8, 30, 23, 30) / 1000,
    });
    const interaction = createInteraction();
    await executeExport(interaction as never);
    expect(interaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "\u23f3Endless Tower - 01/10",
        message: expect.objectContaining({
          content: expect.not.stringContaining(identifier),
        }),
      }),
    );
    expect(exportHistory.size).toBe(2);
  });

  it("preserves the date when truncating long titles", async () => {
    getSignupSheet.mockResolvedValue({
      ...buildSheet(),
      title: "Run ".repeat(40),
    });
    const interaction = createInteraction();
    await executeExport(interaction as never);
    const [{ name }] = interaction.create.mock.calls[0] as unknown as [
      { name: string },
    ];
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name).toMatch(/ - 01\/10$/);
  });

  it.each([
    {
      serverTimezone: null,
      scheduleTimezone: "GMT-5",
      expected: "30/09",
    },
    { serverTimezone: null, scheduleTimezone: null, expected: "30/09" },
  ])(
    "falls back to schedule timezone then UTC ($scheduleTimezone)",
    async ({ serverTimezone, scheduleTimezone, expected }) => {
      getSignupSheet.mockResolvedValue({
        ...buildSheet(),
        serverTimezone,
        scheduleTimezone,
      });
      const interaction = createInteraction();
      await executeExport(interaction as never);
      expect(interaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: `\u23f3Endless Tower - ${expected}` }),
      );
    },
  );
});
