import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { PermissionFlagsBits } from "discord.js";
import type {
  ShareFinalizationStatus,
  SignupExportHistoryEntry,
} from "../types/signup-export.js";
import type {
  PayoutSheetFinalizationResult,
  PayoutSheetSnapshot,
} from "../types/payout-sheet-export.js";

const exportIdentifier = "-# Export ID: botbito-export:v1:test";
const starter = { content: `Roster\n${exportIdentifier}` };
const sentDms = new Map<string, jest.Mock>();
const publicMessages: Array<{
  id: string;
  content: string;
  allowedMentions: unknown;
}> = [];
let entry: SignupExportHistoryEntry;
let thread: {
  id: string;
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

const getSharePost = jest.fn(async () => ({ thread, starter, botId: "bot" }));
const canEditShare = jest.fn(
  (organizerId: string | null, userId: string, isManager: boolean) =>
    isManager || organizerId === userId,
);
jest.unstable_mockModule("../commands/payout-thread.command.js", () => ({
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
  sheetName: "Payout Sheet",
  columnName: "EB 27/10",
  shareAmounts:
    status === "ready"
      ? [
          { userId: "111", thisRun: 100_000, totalUnclaimed: 250_000 },
          { userId: "222", thisRun: 50_000, totalUnclaimed: 300_000 },
        ]
      : [],
}));
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
jest.unstable_mockModule("./payout-sheet-export.service.js", () => ({
  finalizePayoutExport,
  queuePayoutSheetOperation,
}));

const save = jest.fn(async () => undefined);
jest.unstable_mockModule("./signup-export.service.js", () => ({
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
  DISCORD_SETTINGS: {
    payoutWorksheets: { guild: "Payout Sheet" },
    payoutToPingId: "contact-id",
    payoutToPingTag: "contact-tag",
  },
}));

const { finalizeShareStatus } = await import("./share-status.service.js");

const createInteraction = (userId = "organizer", isManager = false) => {
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
        me: {
          permissionsIn: jest.fn(() => ({ has: jest.fn(() => true) })),
        },
      },
    },
    channel: { id: "thread" },
    client: { user: { id: "bot" }, users: { fetch: usersFetch } },
    user: { id: userId, username: userId, globalName: userId },
    memberPermissions: {
      has: jest.fn(
        (permission: bigint) =>
          isManager && permission === PermissionFlagsBits.ManageGuild,
      ),
    },
    usersFetch,
    editReply,
  };
};

const resetState = (): void => {
  spreadsheetQueue = Promise.resolve();
  sentDms.clear();
  publicMessages.length = 0;
  thread = {
    id: "thread",
    name: "⏳Run Name - 02/11 [instance emoji]",
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
      members: [
        { userId: "111", displayName: "Alice", discordTag: "alice" },
        { userId: "222", displayName: "Bob", discordTag: "bob" },
      ],
      mode: "create",
      status: "synced",
    },
  };
  save.mockClear();
  finalizePayoutExport
    .mockReset()
    .mockImplementation(
      async (_worksheet, _guildId, _threadId, _snapshot, status) => ({
        sheetName: "Payout Sheet",
        columnName: "EB 27/10",
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

describe("share status service", () => {
  beforeEach(resetState);

  it("finalizes Ready in Sheets, DMs each unique participant, reports, and locks", async () => {
    const firstDm = jest.fn(async (_message: unknown) => undefined);
    const secondDm = jest.fn(async (_message: unknown) => undefined);
    sentDms.set("111", firstDm);
    sentDms.set("222", secondDm);
    const interaction = createInteraction();

    await finalizeShareStatus(interaction as never, "ready");

    expect(finalizePayoutExport).toHaveBeenCalledWith(
      "Payout Sheet",
      "guild",
      "thread",
      entry.sheetsSync!,
      "ready",
    );
    expect(entry.shareFinalization).toMatchObject({
      sheets: "confirmed",
      sheetName: "Payout Sheet",
      columnName: "EB 27/10",
      shareAmounts: {
        "111": { thisRun: 100_000, totalUnclaimed: 250_000 },
      },
    });
    expect(firstDm).toHaveBeenCalledTimes(1);
    expect(secondDm).toHaveBeenCalledTimes(1);
    expect(firstDm.mock.calls[0]![0]).toMatchObject({
      content: expect.stringContaining("Run Name - 02/11** - Alice"),
      allowedMentions: { parse: [], users: ["contact-id"] },
    });
    expect(firstDm.mock.calls[0]![0]).toMatchObject({
      content: expect.stringContaining(
        "organizer has set https://discord.test/threads/thread status to **Ready for Distribution**.",
      ),
    });
    const sentOptions = firstDm.mock.calls[0]![0] as {
      embeds: Array<{
        toJSON: () => { fields: Array<{ name: string; value: string }> };
      }>;
    };
    expect(sentOptions.embeds[0]?.toJSON().fields).toEqual([
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
      "**Payout Sheet (EB 27/10)** updated successfully. DMs sent to participants.",
    );
    expect(publicMessages[0]?.allowedMentions).toEqual({ parse: [] });
    expect(thread.name).toBe("✅Run Name - 02/11 [instance emoji]");
    expect(thread.setLocked).toHaveBeenCalledWith(true);
    expect(entry.shareFinalization?.completed).toBe(true);
    expect(publicMessages).toHaveLength(1);
  });

  it("continues Discord completion after Sheets failure without Ready DMs", async () => {
    finalizePayoutExport.mockRejectedValueOnce(new Error("offline"));
    const interaction = createInteraction();

    await finalizeShareStatus(interaction as never, "ready");

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
    expect(entry.shareFinalization?.completed).toBe(true);
    expect(publicMessages).toHaveLength(1);
  });

  it("keeps Done (no share) DM-free and states the manual financial correction", async () => {
    const interaction = createInteraction();

    await finalizeShareStatus(interaction as never, "done-no-share");

    expect(finalizePayoutExport).toHaveBeenCalledWith(
      "Payout Sheet",
      "guild",
      "thread",
      entry.sheetsSync!,
      "done-no-share",
    );
    expect(interaction.usersFetch).not.toHaveBeenCalled();
    expect(publicMessages[0]?.content).toContain(
      "**Payout Sheet (EB 27/10)** updated successfully. Note: No share; no DMs were sent.",
    );
    expect(publicMessages[0]?.content).toContain("may appear claimable");
    expect(publicMessages[0]?.content).toContain(
      "financial values were not changed",
    );
    expect(thread.name).toBe("✅Run Name - 02/11 [instance emoji]");
    expect(publicMessages[0]?.content).toContain("Done (no share)");
  });

  it("rejects a mismatched starter Export ID before any side effect", async () => {
    starter.content = "Roster\n-# Export ID: different-id";
    const interaction = createInteraction();

    await expect(
      finalizeShareStatus(interaction as never, "ready"),
    ).rejects.toThrow("does not match saved Sheets history");

    expect(finalizePayoutExport).not.toHaveBeenCalled();
    expect(thread.setName).not.toHaveBeenCalled();
    expect(thread.send).not.toHaveBeenCalled();
    expect(thread.setLocked).not.toHaveBeenCalled();
    expect(entry.shareFinalization).toBeUndefined();
  });

  it("resumes the selected status without repeating uncertain DMs or reports", async () => {
    entry.shareFinalization = {
      status: "ready",
      sheets: "confirmed",
      shareAmounts: {
        "111": { thisRun: 100_000, totalUnclaimed: 250_000 },
        "222": { thisRun: 50_000, totalUnclaimed: 300_000 },
      },
      titleUpdated: true,
      dmDeliveries: { "111": "sent", "222": "attempting" },
      publicMessages: [
        { content: "previous result", status: "sent", messageId: "public-1" },
      ],
      locked: true,
    };
    thread.name = "✅Run Name - 02/11 [instance emoji]";
    const interaction = createInteraction();

    await finalizeShareStatus(interaction as never, "ready");

    expect(finalizePayoutExport).not.toHaveBeenCalled();
    expect(interaction.usersFetch).not.toHaveBeenCalled();
    expect(thread.send).not.toHaveBeenCalled();
    expect(thread.setLocked).not.toHaveBeenCalled();
    expect(entry.shareFinalization?.completed).toBe(true);
  });

  it("does not allow a selected status to change or a completed run to reopen", async () => {
    entry.shareFinalization = {
      status: "cancelled",
      sheets: "confirmed",
    };
    await expect(
      finalizeShareStatus(createInteraction() as never, "ready"),
    ).rejects.toThrow("Resume only that status");

    entry.shareFinalization.completed = true;
    await expect(
      finalizeShareStatus(createInteraction() as never, "cancelled"),
    ).rejects.toThrow("already been finalized");
    expect(finalizePayoutExport).not.toHaveBeenCalled();
  });
});
