import { describe, expect, it, jest } from "@jest/globals";
import { MessageFlags } from "discord.js";
import type { SignupSheet } from "../types/signup-sheet.js";

const getSignupSheet =
  jest.fn<
    (guildId: string, channelId: string) => Promise<SignupSheet | null>
  >();
const mutateSignupSheet = jest.fn();
const buildSignupSheetEmbed = jest.fn().mockReturnValue({ data: {} });

jest.unstable_mockModule("./signup-sheet.service.js", () => ({
  getSignupSheet,
  mutateSignupSheet,
}));
jest.unstable_mockModule("../templates/signup-sheet.template.js", () => ({
  buildSignupSheetEmbed,
  formatSignupSchedule: jest.fn(),
}));

const {
  buildSignupSheetComponents,
  cleanupStaleSheetComponents,
  getSheet,
  publish,
  publishToChannel,
  replyMissing,
  resolveTargetUser,
} = await import("./signup-actions.service.js");

const createSheet = (): SignupSheet => ({
  guildId: "guild-id",
  channelId: "channel-id",
  title: "Test run",
  organizerName: "Organizer",
  organizerAvatarUrl: "https://example.com/organizer.png",
  partySizes: [1],
  slots: [],
  reserves: [],
  notes: null,
  thumbnailUrl: null,
  color: null,
  instanceType: null,
  timestamp: null,
  scheduleTimezone: null,
  serverTimezone: null,
});

describe("signup actions service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("builds the two expected rows of signup sheet action buttons", () => {
    const components = buildSignupSheetComponents();

    expect(components).toHaveLength(2);
    expect(
      components[0]?.components.map(
        (button) => (button.data as { label?: string }).label,
      ),
    ).toEqual(["Add", "Remove", "TBC", "Swap"]);
    expect(
      components[1]?.components.map(
        (button) => (button.data as { label?: string }).label,
      ),
    ).toEqual(["Char", "Remove Char", "Schedule", "Command List"]);
  });

  it("loads a sheet only when the interaction identifies a guild and channel", async () => {
    getSignupSheet.mockResolvedValue(createSheet());

    await expect(
      getSheet({ guildId: "guild-id", channelId: "channel-id" } as never),
    ).resolves.toMatchObject({
      title: "Test run",
    });
    await expect(
      getSheet({ guildId: null, channelId: "channel-id" } as never),
    ).resolves.toBeNull();

    expect(getSignupSheet).toHaveBeenCalledTimes(1);
    expect(getSignupSheet).toHaveBeenCalledWith("guild-id", "channel-id");
  });

  it("replies ephemerally when no sheet exists and edits a deferred response", async () => {
    const reply = jest.fn();
    await replyMissing({ deferred: false, replied: false, reply } as never);

    expect(reply).toHaveBeenCalledWith({
      content:
        "There is no signup sheet in this text channel. Use `/newrun` first.",
      flags: MessageFlags.Ephemeral,
    });

    const editReply = jest.fn();
    await replyMissing({ deferred: true, replied: false, editReply } as never);
    expect(editReply).toHaveBeenCalledWith(
      "There is no signup sheet in this text channel. Use `/newrun` first.",
    );
  });

  it("removes stale action components without failing when the message cannot be found", async () => {
    const edit = jest.fn();
    const fetch = jest.fn(async (_messageId: string) => ({ edit }));
    await cleanupStaleSheetComponents(
      { channel: { messages: { fetch } } } as never,
      "old-message-id",
    );

    expect(fetch).toHaveBeenCalledWith("old-message-id");
    expect(edit).toHaveBeenCalledWith({ components: [] });
  });

  it("publishes through an interaction reply and persists the returned message ID", async () => {
    const sheet = createSheet();
    const reply = jest.fn(async () => ({ id: "new-message-id" }));

    await publish(
      {
        guildId: "guild-id",
        channelId: "channel-id",
        reply,
        guild: { name: "Guild", iconURL: jest.fn().mockReturnValue(null) },
      } as never,
      sheet,
    );

    expect(sheet.messageId).toBe("new-message-id");
    expect(mutateSignupSheet).toHaveBeenCalledWith(
      "guild-id",
      "channel-id",
      expect.any(Function),
    );
  });

  it("publishes directly to the channel for an ephemeral action", async () => {
    const sheet = createSheet();
    const send = jest.fn(async () => ({ id: "channel-message-id" }));

    await expect(
      publishToChannel(
        {
          guildId: "guild-id",
          channelId: "channel-id",
          channel: { send },
          guild: { name: "Guild", iconURL: jest.fn().mockReturnValue(null) },
        } as never,
        sheet,
      ),
    ).resolves.toMatchObject({ id: "channel-message-id" });

    expect(sheet.messageId).toBe("channel-message-id");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("resolves a directly mentioned user", async () => {
    const user = { id: "100000000000000001", displayName: "Alice" };
    const fetch = jest.fn(async (_userId: string) => user);

    await expect(
      resolveTargetUser(
        { client: { users: { fetch } } } as never,
        "<@100000000000000001>",
      ),
    ).resolves.toBe(user);
    expect(fetch).toHaveBeenCalledWith("100000000000000001");
  });

  it("resolves the only guild member returned for a username search", async () => {
    const user = { id: "100000000000000002", displayName: "Alice" };
    const fetch = jest.fn(
      async (_options: { query: string; limit: number }) =>
        new Map([[user.id, { user, displayName: "Alice", nickname: null }]]),
    );

    await expect(
      resolveTargetUser({ guild: { members: { fetch } } } as never, "Alice"),
    ).resolves.toBe(user);
    expect(fetch).toHaveBeenCalledWith({ query: "Alice", limit: 100 });
  });
});
