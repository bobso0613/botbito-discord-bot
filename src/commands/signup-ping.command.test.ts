import { jest } from "@jest/globals";
import type { SignupSheet } from "../types/signup-sheet.js";

const getSignupSheet =
  jest.fn<
    (guildId: string, channelId: string) => Promise<SignupSheet | null>
  >();
const saveSignupSheet = jest.fn();
const deleteSignupSheet = jest.fn();
const mutateSignupSheet = jest.fn(
  async (
    guildId: string,
    channelId: string,
    mutate: (sheet: SignupSheet) => string | null,
  ) => {
    const sheet = await getSignupSheet(guildId, channelId);
    if (!sheet) return { sheet: null, error: "MISSING_SHEET" };
    const cloned = structuredClone(sheet);
    const error = mutate(cloned);
    if (error) return { sheet: null, error };
    await saveSignupSheet(cloned);
    return { sheet: cloned, error: null };
  },
);

jest.unstable_mockModule("../services/signup-sheet.service.js", () => ({
  getSignupSheet,
  saveSignupSheet,
  deleteSignupSheet,
  mutateSignupSheet,
}));

const { signupCommands } = await import("./signup.command.js");

const pingCommand = signupCommands.find(
  (command) => command.data.name === "ping",
)!;

const buildSheet = (overrides: Partial<SignupSheet> = {}): SignupSheet => ({
  guildId: "guild-1",
  channelId: "channel-1",
  title: "Test Run",
  organizerName: "Organizer",
  organizerAvatarUrl: "https://example.com/organizer.png",
  partySizes: [2],
  slots: [
    {
      number: 1,
      role: "Tank",
      signupUserId: "user-1",
      signupDisplayName: "Alice",
      charNote: null,
    },
    {
      number: 2,
      role: "DPS",
      signupUserId: null,
      signupDisplayName: null,
      charNote: null,
    },
  ],
  reserves: [{ userId: "user-2", displayName: "Bob", charNote: null }],
  notes: null,
  thumbnailUrl: null,
  color: null,
  instanceType: null,
  timestamp: null,
  scheduleTimezone: null,
  serverTimezone: null,
  ...overrides,
});

const createInteraction = (which: string | null, message = "hello") => ({
  guildId: "guild-1",
  channelId: "channel-1",
  guild: { id: "guild-1" },
  channel: { name: "general" },
  user: { id: "invoker-1", displayName: "Invoker" },
  reply: jest.fn(),
  options: {
    getString: jest.fn((name: string) => {
      if (name === "message") return message;
      if (name === "which") return which;
      return null;
    }),
  },
});

describe("/ping", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    { which: "all", label: "All", mentions: "<@user-1> , <@user-2>" },
    { which: "main", label: "Main Roster", mentions: "<@user-1>" },
    { which: "reserves", label: "Reserves", mentions: "<@user-2>" },
  ])(
    "pings the expected roster when which=$which",
    async ({ which, label, mentions }) => {
      getSignupSheet.mockResolvedValue(buildSheet());
      const interaction = createInteraction(which);

      await pingCommand.execute(interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: `-# Ping from **Invoker** to **${label}**:\n\n**hello**\n\n-# ${mentions}\n-# sent from __Test Run__ in __general__`,
      });
    },
  );

  it("only pings TBC participants across slots and reserves when which=tbc", async () => {
    getSignupSheet.mockResolvedValue(
      buildSheet({
        slots: [
          {
            number: 1,
            role: "Tank",
            signupUserId: "user-1",
            signupDisplayName: "Alice",
            charNote: null,
            isTbc: true,
          },
          {
            number: 2,
            role: "DPS",
            signupUserId: "user-3",
            signupDisplayName: "Charlie",
            charNote: null,
            isTbc: false,
          },
        ],
        reserves: [
          {
            userId: "user-2",
            displayName: "Bob",
            charNote: null,
            isTbc: true,
          },
        ],
      }),
    );
    const interaction = createInteraction("tbc");

    await pingCommand.execute(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        "-# Ping from **Invoker** to **TBC**:\n\n**hello**\n\n-# <@user-1> , <@user-2>\n-# sent from __Test Run__ in __general__",
    });
  });
});
