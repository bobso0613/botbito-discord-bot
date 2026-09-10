import { jest } from "@jest/globals";
import type { SignupSheet } from "../types/signup-sheet.js";

const getSignupSheet = jest.fn<() => Promise<SignupSheet | null>>();
const saveSignupSheet = jest.fn();
const deleteSignupSheet = jest.fn();

jest.unstable_mockModule("../services/signup-sheet.service.js", () => ({
  getSignupSheet,
  saveSignupSheet,
  deleteSignupSheet,
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

  it("pings both main roster and reserves when which=all", async () => {
    getSignupSheet.mockResolvedValue(buildSheet());
    const interaction = createInteraction("all");

    await pingCommand.execute(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Ping from **Invoker**: hello\n\n<@user-1> <@user-2>",
    });
  });

  it("only pings the main roster when which=main", async () => {
    getSignupSheet.mockResolvedValue(buildSheet());
    const interaction = createInteraction("main");

    await pingCommand.execute(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Ping from **Invoker**: hello\n\n<@user-1>",
    });
  });

  it("only pings reserves when which=reserves", async () => {
    getSignupSheet.mockResolvedValue(buildSheet());
    const interaction = createInteraction("reserves");

    await pingCommand.execute(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Ping from **Invoker**: hello\n\n<@user-2>",
    });
  });
});
