import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  ApplicationIntegrationType,
  InteractionContextType,
  PermissionFlagsBits,
} from "discord.js";
import type { SignupExportHistoryEntry } from "../types/signup-export.js";
import type {
  PayoutSheetFinalizationResult,
  PayoutSheetSnapshot,
} from "../types/payout-sheet-export.js";
import type { ShareFinalizationStatus } from "../types/signup-export.js";

const getSharePost = jest.fn(async () => ({ thread, starter, botId: "bot" }));
const canEditShare = jest.fn(
  (organizerId: string | null, userId: string, manager: boolean) =>
    manager || organizerId === userId,
);
jest.unstable_mockModule("./payout-thread.command.js", () => ({
  getSharePost,
  canEditShare,
}));
const finalizePayoutExport = jest.fn<
  (
    worksheet: string,
    guildId: string,
    threadId: string,
    snapshot: PayoutSheetSnapshot,
    status: ShareFinalizationStatus,
  ) => Promise<PayoutSheetFinalizationResult>
>(async (_worksheet, _guildId, _threadId, _snapshot, status) => ({
  sheetName: "Sheet",
  columnName: "EB 27/10",
  payoutTotals: { totalEarned: 200_000, reimbursements: 50_000 },
  shareAmounts:
    status === "ready"
      ? [
          { userId: "111", thisRun: 100_000, totalUnclaimed: 250_000 },
          { userId: "222", thisRun: 50_000, totalUnclaimed: 300_000 },
        ]
      : [],
}));
let operationQueue: Promise<void> = Promise.resolve();
const queuePayoutSheetOperation = async <Result>(
  action: () => Promise<Result>,
): Promise<Result> => {
  const operation = operationQueue.then(action);
  operationQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
};
jest.unstable_mockModule("../services/payout-sheet-export.service.js", () => ({
  finalizePayoutExport,
  queuePayoutSheetOperation,
  PayoutSheetNoWriteAttemptError: class extends Error {},
}));
const save = jest.fn(async () => undefined);
let entry: SignupExportHistoryEntry;
jest.unstable_mockModule("../services/signup-export.service.js", () => ({
  withSignupExportHistory: async (
    _guildId: string,
    _threadId: string,
    action: (
      current: SignupExportHistoryEntry,
      persist: () => Promise<void>,
      history: Record<string, SignupExportHistoryEntry>,
    ) => Promise<string>,
  ) => action(entry, save, {}),
}));
jest.unstable_mockModule("../config/discord-settings.js", () => ({
  PAYOUT_GUILD_IDS: ["guild"],
  DISCORD_SETTINGS: {
    payoutWorksheets: { guild: "Sheet" },
    payoutToPingId: "contact-id",
    payoutToPingTag: "contact-tag",
  },
}));

const { setShareStatusCommand } = await import("./share-status.command.js");

const exportIdentifier = "-# Export ID: stable-export-id";
const starter = { content: `Roster\n${exportIdentifier}` };
const sentDms = new Map<string, jest.Mock>();
const publicMessages: Array<{
  id: string;
  content: string;
  allowedMentions: unknown;
}> = [];
let thread: {
  id: string;
  guildId: string;
  parentId: string;
  name: string;
  url: string;
  setName: jest.Mock<(name: string) => Promise<unknown>>;
  setLocked: jest.Mock<(locked: boolean) => Promise<unknown>>;
  send: jest.Mock<
    (message: { content: string; allowedMentions: unknown }) => Promise<{
      id: string;
      content: string;
      allowedMentions: unknown;
    }>
  >;
};

const createInteraction = (
  status = "ready",
  userId = "organizer",
  isManager = false,
  botPermissions = true,
) => {
  const permissions = { has: jest.fn(() => botPermissions) };
  const usersFetch = jest.fn(async (id: string) => ({
    username: id === "111" ? "alice" : "bob",
    displayAvatarURL: () =>
      `https://cdn.discordapp.com/avatars/${id}/avatar.png`,
    send: sentDms.get(id) ?? jest.fn(async () => undefined),
  }));
  const interactionResponse = {
    id: "interaction-response",
    content: "",
    allowedMentions: undefined as unknown,
  };
  const editReply = jest.fn(
    async (options: { content: string; allowedMentions?: unknown }) => {
      interactionResponse.content = options.content;
      interactionResponse.allowedMentions = options.allowedMentions;
      if (
        !publicMessages.some((message) => message.id === interactionResponse.id)
      ) {
        publicMessages.unshift(interactionResponse);
      }
      return interactionResponse;
    },
  );
  return {
    guildId: "guild",
    guild: {
      name: "Actual Guild",
      iconURL: () => "https://cdn.discordapp.com/icons/guild/icon.png",
      members: {
        me: { permissionsIn: jest.fn(() => permissions) },
      },
    },
    channel: { id: "thread" },
    channelId: "thread",
    client: { user: { id: "bot" }, users: { fetch: usersFetch } },
    user: { id: userId, username: userId, globalName: userId },
    memberPermissions: {
      has: jest.fn(
        (permission: bigint) =>
          isManager && permission === PermissionFlagsBits.ManageGuild,
      ),
    },
    options: { getString: jest.fn(() => status) },
    deferReply: jest.fn(async (_options: unknown) => undefined),
    editReply,
    usersFetch,
  };
};

const resetState = (): void => {
  operationQueue = Promise.resolve();
  sentDms.clear();
  publicMessages.length = 0;
  thread = {
    id: "thread",
    guildId: "guild",
    parentId: "forum",
    name: "⏳Run Name - 02/11 [guild emoji]",
    url: "https://discord.test/threads/thread",
    setName: jest.fn(async (name: string) => {
      thread.name = name;
      return thread;
    }),
    setLocked: jest.fn(async () => undefined),
    send: jest.fn(
      async (message: { content: string; allowedMentions: unknown }) => {
        const sent = { id: `public-${publicMessages.length + 1}`, ...message };
        publicMessages.push(sent);
        return sent;
      },
    ),
  };
  starter.content = `Roster\n${exportIdentifier}`;
  entry = {
    threadId: "thread",
    organizerId: "organizer",
    participantUserIds: ["111", "222", "111"],
    sheetsSync: {
      identifier: exportIdentifier,
      title: "Run Name 02/11",
      vendor: "Vendor",
      userIds: ["111", "222"],
      mode: "create",
      status: "synced",
      members: [
        { userId: "111", displayName: "Alice", discordTag: "alice" },
        { userId: "222", displayName: "Bob", discordTag: "bob" },
      ],
    },
  };
  save.mockClear();
  finalizePayoutExport
    .mockReset()
    .mockImplementation(
      async (_worksheet, _guildId, _threadId, _snapshot, status) => ({
        sheetName: "Sheet",
        columnName: "EB 27/10",
        payoutTotals: { totalEarned: 200_000, reimbursements: 50_000 },
        shareAmounts:
          status === "ready"
            ? [
                { userId: "111", thisRun: 100_000, totalUnclaimed: 250_000 },
                { userId: "222", thisRun: 50_000, totalUnclaimed: 300_000 },
              ]
            : [],
      }),
    );
  getSharePost.mockReset().mockImplementation(async () => ({
    thread: thread as never,
    starter: starter as never,
    botId: "bot",
  }));
};

describe("/set share status", () => {
  beforeEach(resetState);

  it("registers the exact nested command, required choices, and payout guild scope", () => {
    const data = setShareStatusCommand.data.toJSON();
    expect(data.name).toBe("set");
    expect(data.integration_types).toEqual([
      ApplicationIntegrationType.GuildInstall,
    ]);
    expect(data.contexts).toEqual([InteractionContextType.Guild]);
    expect(setShareStatusCommand.guildIds).toEqual(["guild"]);
    expect(data.options?.[0]).toMatchObject({
      name: "share",
      type: 2,
      options: [
        {
          name: "status",
          type: 1,
          options: [
            {
              name: "status",
              type: 3,
              required: true,
              choices: [
                { name: "Ready for distribution", value: "ready" },
                { name: "Done (no share)", value: "done-no-share" },
                { name: "Cancelled", value: "cancelled" },
              ],
            },
          ],
        },
      ],
    });
  });

  it("defers publicly and preflights bot thread permissions before Sheets writes", async () => {
    const interaction = createInteraction("ready", "organizer", false, false);

    await setShareStatusCommand.execute(interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(interaction.deferReply.mock.calls[0]).toEqual([]);
    expect(finalizePayoutExport).not.toHaveBeenCalled();
    expect(thread.setName).not.toHaveBeenCalled();
    expect(thread.send).not.toHaveBeenCalled();
    expect(thread.setLocked).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          "Manage Threads and Send Messages in Threads",
        ),
      }),
    );
  });

  it("recolors first, DMs each unique current participant, reports, and locks", async () => {
    const firstDm = jest.fn(async (_message: unknown) => undefined);
    const secondDm = jest.fn(async (_message: unknown) => undefined);
    sentDms.set("111", firstDm);
    sentDms.set("222", secondDm);
    const interaction = createInteraction();

    await setShareStatusCommand.execute(interaction as never);

    expect(finalizePayoutExport).toHaveBeenCalledWith(
      "Sheet",
      "guild",
      "thread",
      entry.sheetsSync!,
      "ready",
    );
    expect(firstDm).toHaveBeenCalledTimes(1);
    expect(secondDm).toHaveBeenCalledTimes(1);
    expect(firstDm.mock.calls[0]![0]).toMatchObject({
      content: expect.stringContaining("Run Name - 02/11** - Alice"),
      allowedMentions: { parse: [] },
    });
    expect(firstDm.mock.calls[0]![0]).toMatchObject({
      content: expect.stringContaining(
        "organizer has set https://discord.test/threads/thread status to **Ready for Distribution**.",
      ),
    });
    const sentOptions = firstDm.mock.calls[0]![0] as {
      embeds: Array<{
        toJSON: () => {
          author: { name: string };
          thumbnail: { url: string };
          fields: Array<{ name: string; value: string }>;
        };
      }>;
    };
    const dmEmbed = sentOptions.embeds[0]!.toJSON();
    expect(dmEmbed.author.name).toBe("💰 Alice (@alice)");
    expect(dmEmbed.thumbnail.url).toContain("/avatars/111/avatar.png");
    expect(dmEmbed.fields).toEqual([
      { name: "This run", value: "`100,000 z`", inline: false },
      { name: "Total unclaimed", value: "`250,000 z`", inline: false },
      {
        name: "How to claim",
        value: expect.stringContaining("Please type `/payout` in Actual Guild"),
        inline: false,
      },
    ]);
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(
      finalizePayoutExport.mock.invocationCallOrder[0]!,
    );
    expect(publicMessages[0]?.content).toContain(
      "**Sheet (EB 27/10)** updated successfully. DMs sent to participants.",
    );
    expect(publicMessages).toHaveLength(2);
    expect(thread.name).toBe("✅Run Name - 02/11 [guild emoji]");
    expect(thread.setLocked).toHaveBeenCalledWith(true);
    expect(entry.shareFinalization?.completed).toBe(true);
  });

  it.each<[ShareFinalizationStatus, string, string]>([
    [
      "done-no-share",
      "**Sheet (EB 27/10)** updated successfully. Note: No share; no DMs were sent.",
      "manually adjust amounts and formulas",
    ],
    [
      "cancelled",
      "**Sheet (EB 27/10)** removed in the sheet successfully.",
      "removed in the sheet successfully",
    ],
  ])("handles %s without participant DMs", async (status, report, detail) => {
    const interaction = createInteraction(status);

    await setShareStatusCommand.execute(interaction as never);

    expect(interaction.usersFetch).not.toHaveBeenCalled();
    expect(finalizePayoutExport).toHaveBeenCalledWith(
      "Sheet",
      "guild",
      "thread",
      entry.sheetsSync!,
      status,
    );
    expect(
      publicMessages.map((message) => message.content).join("\n"),
    ).toContain(report);
    expect(
      publicMessages.map((message) => message.content).join("\n"),
    ).toContain(detail);
    expect(thread.name.startsWith(status === "cancelled" ? "❌" : "✅")).toBe(
      true,
    );
  });

  it("continues Discord completion after Sheets failure without Ready DMs", async () => {
    finalizePayoutExport.mockRejectedValueOnce(new Error("offline"));
    const interaction = createInteraction();

    await setShareStatusCommand.execute(interaction as never);

    expect(interaction.usersFetch).not.toHaveBeenCalled();
    expect(publicMessages[0]?.content).toContain("was not confirmed updated");
    expect(publicMessages[0]?.content).toContain(
      "No participant DMs were sent",
    );
    expect(publicMessages[0]?.content).not.toContain(
      "confirmed the run's shares",
    );
    expect(thread.setLocked).toHaveBeenCalledWith(true);
    expect(entry.shareFinalization?.sheets).toBe("manual");
  });

  it("rejects starter/history identity mismatch before any mutation", async () => {
    starter.content = "Roster\n-# Export ID: different-export";
    const interaction = createInteraction();

    await setShareStatusCommand.execute(interaction as never);

    expect(finalizePayoutExport).not.toHaveBeenCalled();
    expect(thread.setName).not.toHaveBeenCalled();
    expect(thread.send).not.toHaveBeenCalled();
    expect(thread.setLocked).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("does not match saved Sheets history"),
      }),
    );
  });

  it("allows only the original organizer or a Manage Server member", async () => {
    const unauthorized = createInteraction("ready", "other-user");

    await setShareStatusCommand.execute(unauthorized as never);

    expect(finalizePayoutExport).not.toHaveBeenCalled();
    expect(thread.setName).not.toHaveBeenCalled();
    expect(thread.send).not.toHaveBeenCalled();

    resetState();
    const manager = createInteraction("ready", "server-manager", true);
    await setShareStatusCommand.execute(manager as never);
    expect(finalizePayoutExport).toHaveBeenCalledTimes(1);
  });

  it("reports blocked DMs with suppressed mentions and still completes", async () => {
    const blockedDm = jest.fn(async (_message: unknown) => {
      throw new Error("blocked");
    });
    sentDms.set("111", blockedDm);
    const interaction = createInteraction();

    await setShareStatusCommand.execute(interaction as never);

    expect(publicMessages[0]?.content).toContain("<@111>: DM failed.");
    expect(publicMessages[0]?.allowedMentions).toEqual({ parse: [] });
    expect(thread.setLocked).toHaveBeenCalledWith(true);
    expect(entry.shareFinalization?.dmDeliveries?.["111"]).toBe("failed");
    expect(entry.shareFinalization?.completed).toBe(true);
  });

  it("rejects legacy, unsynced, and incomplete exports with distinct guidance", async () => {
    const interaction = createInteraction();
    entry.sheetsSync = undefined;
    await setShareStatusCommand.execute(interaction as never);
    expect(interaction.editReply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("legacy or unmanaged"),
      }),
    );

    resetState();
    const pending = createInteraction();
    entry.sheetsSync!.status = "pending";
    await setShareStatusCommand.execute(pending as never);
    expect(pending.editReply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("successfully synchronized"),
      }),
    );

    resetState();
    const incomplete = createInteraction();
    entry.sheetsSync!.deliveryIncomplete = true;
    await setShareStatusCommand.execute(incomplete as never);
    expect(incomplete.editReply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          "Repair it with `/changeshareparticipants`",
        ),
      }),
    );
  });

  it("resumes only the selected status without repeating sent or ambiguous effects", async () => {
    const dm = jest.fn(async (_message: unknown) => undefined);
    sentDms.set("222", dm);
    entry.shareFinalization = {
      status: "ready",
      sheets: "confirmed",
      titleUpdated: true,
      dmDeliveries: { "111": "sent", "222": "attempting" },
      publicMessages: [
        { content: "previous result", status: "sent", messageId: "public-1" },
      ],
      summaryMessages: [
        { content: "previous summary", status: "sent", messageId: "summary-1" },
      ],
      locked: true,
    };
    thread.name = "✅Run Name - 02/11 [guild emoji]";
    const interaction = createInteraction();

    await setShareStatusCommand.execute(interaction as never);

    expect(finalizePayoutExport).not.toHaveBeenCalled();
    expect(interaction.usersFetch).not.toHaveBeenCalled();
    expect(thread.send).not.toHaveBeenCalled();
    expect(dm).not.toHaveBeenCalled();
    expect(entry.shareFinalization?.completed).toBe(true);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          "This status report was already published",
        ),
      }),
    );
  });

  it("rejects already-marked legacy-looking titles without saved intent", async () => {
    thread.name = "✅Run Name - 02/11 [guild emoji]";
    const interaction = createInteraction();

    await setShareStatusCommand.execute(interaction as never);

    expect(finalizePayoutExport).not.toHaveBeenCalled();
    expect(thread.send).not.toHaveBeenCalled();
    expect(thread.setLocked).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("only be set on a pending thread"),
      }),
    );
  });

  it("serializes concurrent invocations and delivers each effect once", async () => {
    const firstDm = jest.fn(async (_message: unknown) => undefined);
    const secondDm = jest.fn(async (_message: unknown) => undefined);
    sentDms.set("111", firstDm);
    sentDms.set("222", secondDm);
    const first = createInteraction();
    const second = createInteraction();

    await Promise.all([
      setShareStatusCommand.execute(first as never),
      setShareStatusCommand.execute(second as never),
    ]);

    expect(finalizePayoutExport).toHaveBeenCalledTimes(1);
    expect(firstDm).toHaveBeenCalledTimes(1);
    expect(secondDm).toHaveBeenCalledTimes(1);
    expect(thread.send).toHaveBeenCalledTimes(1);
    expect(thread.setLocked).toHaveBeenCalledTimes(1);
    expect(entry.shareFinalization?.completed).toBe(true);
  });

  it("splits long failed-recipient reports within Discord's message limit", async () => {
    const participantIds = Array.from(
      { length: 130 },
      (_, index) => `user-${index}`,
    );
    entry.participantUserIds = participantIds;
    for (const id of participantIds) {
      sentDms.set(
        id,
        jest.fn(async (_message: unknown) => {
          throw new Error("blocked");
        }),
      );
    }
    const interaction = createInteraction();

    await setShareStatusCommand.execute(interaction as never);

    expect(publicMessages.length).toBeGreaterThan(1);
    expect(
      publicMessages.every((message) => message.content.length <= 1_900),
    ).toBe(true);
    expect(publicMessages.every((message) => message.allowedMentions)).toBe(
      true,
    );
    expect(entry.shareFinalization?.completed).toBe(true);
  });

  it("does not allow a different or completed status to reopen finalization", async () => {
    entry.shareFinalization = {
      status: "cancelled",
      sheets: "confirmed",
      completed: true,
    };
    const interaction = createInteraction("ready");

    await setShareStatusCommand.execute(interaction as never);

    expect(finalizePayoutExport).not.toHaveBeenCalled();
    expect(thread.send).not.toHaveBeenCalled();
    expect(thread.setLocked).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("already been finalized"),
      }),
    );
  });
});
