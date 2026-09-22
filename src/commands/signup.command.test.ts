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

const {
  signupCommands,
  parseSetup,
  handleSignupAddButton,
  handleSignupRemoveButton,
  handleSignupTbcButton,
  handleSignupCharNoteButton,
  handleSignupRemoveCharNoteButton,
  handleSignupSwapButton,
  handleSignupWhenButton,
  handleSignupRosterButton,
  handleSignupRosterMessage,
  handleSignupNoRosterChangesButton,
  handleSignupCancelSetupButton,
  handleSignupAddConfirmButton,
  handleSignupAddCancelButton,
  handleSignupModal,
  pendingSetupDrafts,
  pendingRosterUsers,
  pendingAddConfirmations,
  addConfirmationKey,
  SIGNUP_CANCEL_SETUP_BUTTON_ID,
  SIGNUP_MODAL_ADD_ID,
  SIGNUP_MODAL_REMOVE_ID,
  SIGNUP_MODAL_TBC_ID,
  SIGNUP_MODAL_CHARNOTE_ID,
  SIGNUP_MODAL_REMOVE_CHARNOTE_ID,
  SIGNUP_MODAL_SWAP_ID,
} = await import("./signup.command.js");

const changeCommand = signupCommands.find(
  (command) => command.data.name === "change",
)!;
const charNoteCommand = signupCommands.find(
  (command) => command.data.name === "charnote",
)!;
const removeCharNoteCommand = signupCommands.find(
  (command) => command.data.name === "removecharnote",
)!;
const rcCommand = signupCommands.find((command) => command.data.name === "rc")!;
const tbcCommand = signupCommands.find(
  (command) => command.data.name === "tbc",
)!;
const removeTbcCommand = signupCommands.find(
  (command) => command.data.name === "removetbc",
)!;
const rtbcCommand = signupCommands.find(
  (command) => command.data.name === "rtbc",
)!;
const swapCommand = signupCommands.find(
  (command) => command.data.name === "swap",
)!;
const addCommand = signupCommands.find(
  (command) => command.data.name === "add",
)!;
const addAliasCommand = signupCommands.find(
  (command) => command.data.name === "a",
)!;
const nextCommand = signupCommands.find(
  (command) => command.data.name === "next",
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
      charNote: "pally note",
    },
    {
      number: 2,
      role: "DPS",
      signupUserId: "user-2",
      signupDisplayName: "Bob",
      charNote: "sniper note",
    },
  ],
  reserves: [
    {
      userId: "user-3",
      displayName: "Charlie",
      charNote: "reserve note",
    },
  ],
  notes: null,
  thumbnailUrl: null,
  color: null,
  instanceType: null,
  timestamp: null,
  scheduleTimezone: null,
  serverTimezone: null,
  ...overrides,
});

const createInteraction = (
  input: string | null = null,
  userId = "user-1",
  char: string | null = null,
  tbc = false,
) => ({
  guildId: "guild-1",
  channelId: "channel-1",
  guild: { id: "guild-1", name: "Guild 1", iconURL: () => null },
  user: { id: userId, displayName: "Invoker" },
  reply: jest.fn(),
  followUp: jest.fn(),
  deferred: false,
  options: {
    getString: jest.fn((name: string) => {
      if (name === "input") return input;
      if (name === "char") return char;
      return null;
    }),
    getBoolean: jest.fn((name: string) => (name === "tbc" ? tbc : null)),
  },
});

describe("/add options", () => {
  it("exposes char and tbc options on the /a alias", () => {
    const optionNames = (addAliasCommand.data.toJSON().options ?? []).map(
      (option) => option.name,
    );

    expect(optionNames).toEqual(["input", "char", "tbc"]);
  });

  it("applies char and tbc to an open slot", async () => {
    const sheet = buildSheet({
      slots: [
        {
          number: 1,
          role: "Tank",
          signupUserId: null,
          signupDisplayName: null,
          charNote: null,
        },
      ],
    });
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction("1", "user-1", "Paladin", true);

    await addCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: [
          expect.objectContaining({
            signupUserId: "user-1",
            charNote: "Paladin",
            isTbc: true,
          }),
        ],
      }),
    );
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: "**Invoker** added as **01: Tank** (Paladin, TBC).",
    });
  });

  it("accepts yes as true for the Add modal TBC field", async () => {
    const sheet = buildSheet({
      slots: [
        {
          number: 1,
          role: "Tank",
          signupUserId: null,
          signupDisplayName: null,
          charNote: null,
        },
      ],
    });
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = {
      customId: SIGNUP_MODAL_ADD_ID,
      guildId: "guild-1",
      channelId: "channel-1",
      guild: { id: "guild-1", name: "Guild 1", iconURL: () => null },
      user: { id: "user-1", displayName: "Invoker" },
      fields: {
        getTextInputValue: jest.fn(
          (id: string) =>
            ({ input: "1", char: "Paladin", tbc: "yes" })[id] ?? "",
        ),
      },
      reply: jest.fn(),
      followUp: jest.fn(),
      deferred: false,
      client: {
        users: {
          fetch: jest
            .fn<() => Promise<{ id: string; displayName: string }>>()
            .mockResolvedValue({ id: "user-2", displayName: "Bob" }),
        },
      },
    };

    await handleSignupModal(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: [expect.objectContaining({ charNote: "Paladin", isTbc: true })],
      }),
    );
  });
});

describe("/next", () => {
  it("clears reserves along with party signups", async () => {
    const sheet = buildSheet({ timestamp: 1_700_000_000 });
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = {
      ...createInteraction(),
      options: {
        getString: jest.fn((name: string) =>
          name === "value" ? "next week" : null,
        ),
      },
    };

    await nextCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        reserves: [],
        slots: expect.arrayContaining([
          expect.objectContaining({
            signupUserId: null,
            signupDisplayName: null,
          }),
        ]),
      }),
    );
  });
});

describe("/charnote", () => {
  const createCharNoteInteraction = (
    note: string,
    position: number | null = null,
    userId = "user-1",
  ) => ({
    guildId: "guild-1",
    channelId: "channel-1",
    guild: { id: "guild-1", name: "Guild 1", iconURL: () => null },
    user: { id: userId, displayName: "Invoker" },
    reply: jest.fn(),
    followUp: jest.fn(),
    deferred: false,
    options: {
      getString: jest.fn((name: string) => {
        if (name === "note") return note;
        return null;
      }),
      getInteger: jest.fn((name: string) => {
        if (name === "position") return position;
        return null;
      }),
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sets charNote on invoker's party slot when no position is provided", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createCharNoteInteraction(
      "Updated Tank Note",
      null,
      "user-1",
    );

    await charNoteCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: expect.arrayContaining([
          expect.objectContaining({ number: 1, charNote: "Updated Tank Note" }),
        ]),
      }),
    );
  });

  it("sets charNote on invoker's reserve slot when no position is provided", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createCharNoteInteraction(
      "Updated Reserve Note",
      null,
      "user-3",
    );

    await charNoteCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        reserves: [
          expect.objectContaining({
            userId: "user-3",
            charNote: "Updated Reserve Note",
          }),
        ],
      }),
    );
  });

  it("sets charNote on specific reserve slot number", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createCharNoteInteraction(
      "Reserve Note by Slot 3",
      3,
      "user-1",
    );

    await charNoteCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        reserves: [
          expect.objectContaining({
            userId: "user-3",
            charNote: "Reserve Note by Slot 3",
          }),
        ],
      }),
    );
  });

  it("returns an error if slot number does not exist", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createCharNoteInteraction("Invalid Note", 99, "user-1");

    await charNoteCommand.execute(interaction as never);

    expect(saveSignupSheet).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "That slot does not exist.",
      }),
    );
  });

  it("returns an error if no position is provided and user is neither in a slot nor reserve", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createCharNoteInteraction("Note", null, "outsider");

    await charNoteCommand.execute(interaction as never);

    expect(saveSignupSheet).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          "You must be signed up in a party slot or reserve when no position is provided.",
      }),
    );
  });
});

describe("/removecharnote and /rc", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("removes the invoker's charNote from party slot when no input is provided", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction(null, "user-1");

    await removeCharNoteCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: expect.arrayContaining([
          expect.objectContaining({ number: 1, charNote: null }),
          expect.objectContaining({ number: 2, charNote: "sniper note" }),
        ]),
      }),
    );
    expect(interaction.reply).toHaveBeenCalled();
  });

  it("removes the invoker's charNote from reserves when no input is provided", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction(null, "user-3");

    await removeCharNoteCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        reserves: [
          expect.objectContaining({ userId: "user-3", charNote: null }),
        ],
      }),
    );
  });

  it("returns an error when no input is provided and invoker is not signed up or in reserves", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction(null, "outsider-user");

    await removeCharNoteCommand.execute(interaction as never);

    expect(saveSignupSheet).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "You are not signed up or a reserve.",
      }),
    );
  });

  it("removes charNote for specified slot numbers", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction("1, 2", "outsider-user");

    await removeCharNoteCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: [
          expect.objectContaining({ number: 1, charNote: null }),
          expect.objectContaining({ number: 2, charNote: null }),
        ],
      }),
    );
  });

  it("removes charNote for reserve slot number", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction("3", "outsider-user");

    await removeCharNoteCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        reserves: [
          expect.objectContaining({ userId: "user-3", charNote: null }),
        ],
      }),
    );
  });

  it("returns an error when invalid slot number is provided", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction("99", "user-1");

    await removeCharNoteCommand.execute(interaction as never);

    expect(saveSignupSheet).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "These slot numbers do not exist: 99.",
      }),
    );
  });

  it("delegates /rc alias to /removecharnote", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction("1", "user-1");

    await rcCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: expect.arrayContaining([
          expect.objectContaining({ number: 1, charNote: null }),
        ]),
      }),
    );
  });
});

describe("/tbc", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("toggles the invoker's TBC status for party slots when no input is provided", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction(null, "user-1");

    await tbcCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: expect.arrayContaining([
          expect.objectContaining({ number: 1, isTbc: true }),
          expect.objectContaining({ number: 2 }),
        ]),
      }),
    );
  });

  it("toggles the invoker's TBC status from true to false when toggled again", async () => {
    const sheet = buildSheet();
    sheet.slots[0]!.isTbc = true;
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction(null, "user-1");

    await tbcCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: expect.arrayContaining([
          expect.objectContaining({ number: 1, isTbc: false }),
        ]),
      }),
    );
  });

  it("toggles the invoker's TBC status for reserves when no input is provided", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction(null, "user-3");

    await tbcCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        reserves: [expect.objectContaining({ userId: "user-3", isTbc: true })],
      }),
    );
  });

  it("returns an error when no input is provided and invoker is not signed up or a reserve", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction(null, "outsider-user");

    await tbcCommand.execute(interaction as never);

    expect(saveSignupSheet).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "You are not signed up or a reserve.",
      }),
    );
  });

  it("toggles TBC status for specified slot numbers and reserve slots", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction("1, 3", "outsider-user");

    await tbcCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: expect.arrayContaining([
          expect.objectContaining({ number: 1, isTbc: true }),
          expect.objectContaining({ number: 2 }),
        ]),
        reserves: [expect.objectContaining({ userId: "user-3", isTbc: true })],
      }),
    );
  });

  it("returns an error when invalid slot number is provided", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction("99", "user-1");

    await tbcCommand.execute(interaction as never);

    expect(saveSignupSheet).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "These slot numbers do not exist: 99.",
      }),
    );
  });
});

describe("/removetbc and /rtbc", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("removes the invoker's TBC status from party slots when no input is provided", async () => {
    const sheet = buildSheet();
    sheet.slots[0]!.isTbc = true;
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction(null, "user-1");

    await removeTbcCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: expect.arrayContaining([
          expect.objectContaining({ number: 1, isTbc: false }),
        ]),
      }),
    );
  });

  it("removes the invoker's TBC status from reserves when no input is provided", async () => {
    const sheet = buildSheet();
    sheet.reserves[0]!.isTbc = true;
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction(null, "user-3");

    await removeTbcCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        reserves: [expect.objectContaining({ userId: "user-3", isTbc: false })],
      }),
    );
  });

  it("returns an error when no input is provided and invoker is not signed up or a reserve", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction(null, "outsider-user");

    await removeTbcCommand.execute(interaction as never);

    expect(saveSignupSheet).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "You are not signed up or a reserve.",
      }),
    );
  });

  it("removes TBC status for specified slot numbers and reserves", async () => {
    const sheet = buildSheet();
    sheet.slots[0]!.isTbc = true;
    sheet.reserves[0]!.isTbc = true;
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction("1, 3", "outsider-user");

    await removeTbcCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: expect.arrayContaining([
          expect.objectContaining({ number: 1, isTbc: false }),
        ]),
        reserves: [expect.objectContaining({ userId: "user-3", isTbc: false })],
      }),
    );
  });

  it("returns an error when invalid slot number is provided", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction("99", "user-1");

    await removeTbcCommand.execute(interaction as never);

    expect(saveSignupSheet).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "These slot numbers do not exist: 99.",
      }),
    );
  });

  it("delegates /rtbc alias to /removetbc", async () => {
    const sheet = buildSheet();
    sheet.slots[0]!.isTbc = true;
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createInteraction("1", "user-1");

    await rtbcCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: expect.arrayContaining([
          expect.objectContaining({ number: 1, isTbc: false }),
        ]),
      }),
    );
  });
});

describe("signup action buttons", () => {
  const createButtonInteraction = () => ({
    guildId: "guild-1",
    channelId: "channel-1",
    guild: { id: "guild-1", name: "Guild 1", iconURL: () => null },
    user: { id: "user-1", displayName: "Invoker" },
    showModal: jest.fn(),
    reply: jest.fn(),
    deferred: false,
  });

  it("shows modal on handleSignupAddButton", async () => {
    const interaction = createButtonInteraction();
    await handleSignupAddButton(interaction as never);
    expect(interaction.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ custom_id: SIGNUP_MODAL_ADD_ID }),
      }),
    );
  });

  it("shows modal on handleSignupRemoveButton", async () => {
    const interaction = createButtonInteraction();
    await handleSignupRemoveButton(interaction as never);
    expect(interaction.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ custom_id: SIGNUP_MODAL_REMOVE_ID }),
      }),
    );
  });

  it("shows modal on handleSignupTbcButton", async () => {
    const interaction = createButtonInteraction();
    await handleSignupTbcButton(interaction as never);
    expect(interaction.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ custom_id: SIGNUP_MODAL_TBC_ID }),
      }),
    );
  });

  it("shows modal on handleSignupCharNoteButton", async () => {
    const interaction = createButtonInteraction();
    await handleSignupCharNoteButton(interaction as never);
    expect(interaction.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ custom_id: SIGNUP_MODAL_CHARNOTE_ID }),
      }),
    );
  });

  it("shows modal on handleSignupRemoveCharNoteButton", async () => {
    const interaction = createButtonInteraction();
    await handleSignupRemoveCharNoteButton(interaction as never);
    expect(interaction.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          custom_id: SIGNUP_MODAL_REMOVE_CHARNOTE_ID,
        }),
      }),
    );
  });

  it("shows modal on handleSignupSwapButton", async () => {
    const interaction = createButtonInteraction();
    await handleSignupSwapButton(interaction as never);
    expect(interaction.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ custom_id: SIGNUP_MODAL_SWAP_ID }),
      }),
    );
  });

  it("replies with schedule on handleSignupWhenButton", async () => {
    const sheet = buildSheet({ timestamp: 1700000000 });
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createButtonInteraction();
    await handleSignupWhenButton(interaction as never);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Your Time:"),
      }),
    );
  });
});

describe("signup modal submissions for action buttons", () => {
  const createModalInteraction = (
    customId: string,
    fields: Record<string, string>,
  ) => ({
    customId,
    guildId: "guild-1",
    channelId: "channel-1",
    guild: { id: "guild-1", name: "Guild 1", iconURL: () => null },
    user: { id: "user-1", displayName: "Invoker" },
    fields: {
      getTextInputValue: jest.fn((id: string) => fields[id] ?? ""),
    },
    reply: jest.fn(),
    followUp: jest.fn(),
    deferred: false,
    client: {
      users: {
        fetch: jest
          .fn<() => Promise<{ id: string; displayName: string }>>()
          .mockResolvedValue({ id: "user-2", displayName: "Bob" }),
      },
    },
  });

  it("handles SIGNUP_MODAL_ADD_ID", async () => {
    const sheet = buildSheet({
      slots: [
        {
          number: 1,
          role: "Tank",
          signupUserId: null,
          signupDisplayName: null,
          charNote: null,
        },
      ],
    });
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createModalInteraction(SIGNUP_MODAL_ADD_ID, {
      input: "1",
    });

    await handleSignupModal(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: [expect.objectContaining({ number: 1, signupUserId: "user-1" })],
      }),
    );
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: "**Invoker** added as **01: Tank**.",
    });
  });

  it("handles SIGNUP_MODAL_ADD_ID with username or @tag resolved via guild members", async () => {
    const sheet = buildSheet({
      slots: [
        {
          number: 1,
          role: "Tank",
          signupUserId: null,
          signupDisplayName: null,
          charNote: null,
        },
      ],
    });
    getSignupSheet.mockResolvedValue(sheet);
    const mockMember = {
      displayName: "B4D",
      user: { id: "user-478", displayName: "B4D", username: "b4d" },
    };
    const membersMap = new Map([["user-478", mockMember]]);
    const interaction = {
      ...createModalInteraction(SIGNUP_MODAL_ADD_ID, {
        input: "1 @B4D",
      }),
      guild: {
        id: "guild-1",
        name: "Guild 1",
        iconURL: () => null,
        members: {
          fetch: jest
            .fn<() => Promise<typeof membersMap>>()
            .mockResolvedValue(membersMap),
        },
      },
    };

    await handleSignupModal(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: [
          expect.objectContaining({
            number: 1,
            signupUserId: "user-478",
            signupDisplayName: "B4D",
          }),
        ],
      }),
    );
  });

  it("handles SIGNUP_MODAL_REMOVE_ID", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createModalInteraction(SIGNUP_MODAL_REMOVE_ID, {
      position: "1",
    });

    await handleSignupModal(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: expect.arrayContaining([
          expect.objectContaining({ number: 1, signupUserId: null }),
        ]),
      }),
    );
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: "**Invoker** removed from **01: Tank**.",
    });
  });

  it("handles SIGNUP_MODAL_TBC_ID", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createModalInteraction(SIGNUP_MODAL_TBC_ID, {
      input: "1",
    });

    await handleSignupModal(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: expect.arrayContaining([
          expect.objectContaining({ number: 1, isTbc: true }),
        ]),
      }),
    );
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: "**Invoker** marked as **TBC**.",
    });
  });

  it("handles SIGNUP_MODAL_CHARNOTE_ID", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createModalInteraction(SIGNUP_MODAL_CHARNOTE_ID, {
      note: "New Note",
      position: "1",
    });

    await handleSignupModal(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: expect.arrayContaining([
          expect.objectContaining({ number: 1, charNote: "New Note" }),
        ]),
      }),
    );
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: "**Invoker** put **New Note** in **01: Tank**.",
    });
  });

  it("handles SIGNUP_MODAL_CHARNOTE_ID for reserve slot", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createModalInteraction(SIGNUP_MODAL_CHARNOTE_ID, {
      note: "Reserve Slot Note",
      position: "3",
    });

    await handleSignupModal(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        reserves: [
          expect.objectContaining({
            userId: "user-3",
            charNote: "Reserve Slot Note",
          }),
        ],
      }),
    );
  });

  it("handles SIGNUP_MODAL_REMOVE_CHARNOTE_ID", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createModalInteraction(
      SIGNUP_MODAL_REMOVE_CHARNOTE_ID,
      { input: "1" },
    );

    await handleSignupModal(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: expect.arrayContaining([
          expect.objectContaining({ number: 1, charNote: null }),
        ]),
      }),
    );
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: "**Invoker** removed the char note from **01: Tank**.",
    });
  });

  it("handles SIGNUP_MODAL_SWAP_ID", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createModalInteraction(SIGNUP_MODAL_SWAP_ID, {
      first: "1",
      second: "2",
    });

    await handleSignupModal(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: [
          expect.objectContaining({ number: 1, signupUserId: "user-2" }),
          expect.objectContaining({ number: 2, signupUserId: "user-1" }),
        ],
      }),
    );
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: "**Invoker** swapped to **02: DPS**.",
    });
    expect(interaction.followUp).toHaveBeenCalledWith({
      content:
        "<@user-2>, you got swapped by <@user-1> to **01: Tank** on Test Run.",
    });
  });
});

describe("/swap", () => {
  const createSwapInteraction = (
    first: string,
    second: string | null = null,
    userId = "user-1",
  ) => ({
    guildId: "guild-1",
    channelId: "channel-1",
    guild: { id: "guild-1", name: "Guild 1", iconURL: () => null },
    user: { id: userId, displayName: "Invoker" },
    reply: jest.fn(),
    followUp: jest.fn(),
    deferred: false,
    options: {
      getString: jest.fn((name: string) => {
        if (name === "first") return first;
        if (name === "second") return second;
        return null;
      }),
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("requires second parameter when the invoker has multiple signups across slots and reserves", async () => {
    const sheet = buildSheet({
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
      reserves: [
        {
          userId: "user-1",
          displayName: "Alice",
          charNote: null,
        },
      ],
    });
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createSwapInteraction("2", null, "user-1");

    await swapCommand.execute(interaction as never);

    expect(saveSignupSheet).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          "You have multiple signups. Specify the second slot or reserve to swap.",
      }),
    );
  });

  it("requires second parameter when the invoker has multiple party slot signups", async () => {
    const sheet = buildSheet({
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
          signupUserId: "user-1",
          signupDisplayName: "Alice",
          charNote: null,
        },
      ],
      reserves: [],
    });
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createSwapInteraction("reserve", null, "user-1");

    await swapCommand.execute(interaction as never);

    expect(saveSignupSheet).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          "You have multiple slot signups. Specify which slot to move to reserves, e.g. `/swap first:1 second:reserve`.",
      }),
    );
  });

  it("swaps correctly when second parameter is provided even if invoker has multiple signups", async () => {
    const sheet = buildSheet({
      partySizes: [3],
      slots: [
        {
          number: 1,
          role: "Tank",
          signupUserId: "user-1",
          signupDisplayName: "Alice",
          charNote: "tank note",
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
          signupUserId: null,
          signupDisplayName: null,
          charNote: null,
        },
      ],
      reserves: [
        {
          userId: "user-1",
          displayName: "Alice",
          charNote: "reserve note",
        },
      ],
    });
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = createSwapInteraction("2", "1", "user-1");

    await swapCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: [
          expect.objectContaining({ number: 1, signupUserId: null }),
          expect.objectContaining({
            number: 2,
            signupUserId: "user-1",
            charNote: "tank note",
          }),
          expect.objectContaining({ number: 3, signupUserId: null }),
        ],
        reserves: [
          expect.objectContaining({
            userId: "user-1",
            charNote: "reserve note",
          }),
        ],
      }),
    );
  });
});

describe("/change roster and roster editing buttons", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("replies with roster prompt and Cancel button on /change roster", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = {
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "user-1", displayName: "Invoker" },
      options: {
        getSubcommand: jest.fn().mockReturnValue("roster"),
      },
      reply: jest.fn(),
    };

    await changeCommand.execute(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          "Send your completed roster as your next message",
        ),
        components: [
          expect.objectContaining({
            components: [
              expect.objectContaining({
                data: expect.objectContaining({
                  custom_id: SIGNUP_CANCEL_SETUP_BUTTON_ID,
                  label: "Cancel",
                }),
              }),
            ],
          }),
        ],
      }),
    );
  });

  it("rejects a party-header shrink that would drop an occupied slot", async () => {
    const sheet = buildSheet({
      partySizes: [2, 1],
      slots: [
        {
          number: 1,
          role: "Tank",
          signupUserId: null,
          signupDisplayName: null,
          charNote: null,
        },
        {
          number: 2,
          role: "Healer",
          signupUserId: null,
          signupDisplayName: null,
          charNote: null,
        },
        {
          number: 3,
          role: "DPS",
          signupUserId: "user-2",
          signupDisplayName: "Bob",
          charNote: null,
        },
      ],
    });
    const key = "guild-1:channel-1";
    pendingSetupDrafts.set(key, structuredClone(sheet));
    pendingRosterUsers.set(key, "user-1");
    const reply = jest.fn();
    const message = {
      guildId: "guild-1",
      channelId: "channel-1",
      author: { id: "user-1", bot: false },
      content: "Party 1:\n01: Tank -",
      reply,
    };

    await handleSignupRosterMessage(message as never);

    expect(reply).toHaveBeenCalledWith(
      "Reducing party sizes would drop signups in slot(s): 03: DPS. Remove or move those players before shrinking party sizes.",
    );
    expect(pendingSetupDrafts.get(key)?.slots).toHaveLength(3);
  });

  it("cancels pending roster edit on handleSignupCancelSetupButton", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = {
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "user-1", displayName: "Invoker" },
      options: {
        getSubcommand: jest.fn().mockReturnValue("roster"),
      },
      reply: jest.fn(),
    };

    await changeCommand.execute(interaction as never);

    const buttonInteraction = {
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "user-1", displayName: "Invoker" },
      deferUpdate: jest.fn(),
      editReply: jest.fn(),
    };

    await handleSignupCancelSetupButton(buttonInteraction as never);

    expect(saveSignupSheet).not.toHaveBeenCalled();
    expect(buttonInteraction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Setup discarded; no changes saved.",
        components: [],
      }),
    );
  });

  it("clones sheet for /change roster draft so mutating draft does not mutate original sheet", async () => {
    const sheet = buildSheet({ title: "Original Title" });
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = {
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "user-1", displayName: "Invoker" },
      options: {
        getSubcommand: jest.fn().mockReturnValue("roster"),
      },
      reply: jest.fn(),
    };

    await changeCommand.execute(interaction as never);

    const draft = pendingSetupDrafts.get("guild-1:channel-1");
    expect(draft).toBeDefined();
    expect(draft).not.toBe(sheet);
    if (draft) {
      draft.title = "Modified In Draft";
      expect(sheet.title).toBe("Original Title");
    }
  });

  it("shows Cancel button when handleSignupRosterButton is clicked", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const setupInteraction = {
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "user-1", displayName: "Invoker" },
      options: {
        getSubcommand: jest.fn().mockReturnValue("roster"),
      },
      reply: jest.fn(),
    };
    await changeCommand.execute(setupInteraction as never);

    const buttonInteraction = {
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "user-1", displayName: "Invoker" },
      deferUpdate: jest.fn(),
      editReply: jest.fn(),
    };

    await handleSignupRosterButton(buttonInteraction as never);

    expect(buttonInteraction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          "Send your completed roster as your next message",
        ),
        components: [
          expect.objectContaining({
            components: [
              expect.objectContaining({
                data: expect.objectContaining({
                  custom_id: SIGNUP_CANCEL_SETUP_BUTTON_ID,
                  label: "Cancel",
                }),
              }),
            ],
          }),
        ],
      }),
    );
  });

  it("rejects unauthorized user from executing /change", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const interaction = {
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "stranger-99", displayName: "Stranger" },
      options: {
        getSubcommand: jest.fn().mockReturnValue("roster"),
      },
      reply: jest.fn(),
    };

    await changeCommand.execute(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          "Only the organizer or players on the roster can change the signup sheet.",
      }),
    );
  });

  it("rejects unauthorized user on handleSignupCancelSetupButton", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const setupInteraction = {
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "user-1", displayName: "Organizer" },
      options: {
        getSubcommand: jest.fn().mockReturnValue("roster"),
      },
      reply: jest.fn(),
    };
    await changeCommand.execute(setupInteraction as never);

    const buttonInteraction = {
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "stranger-99", displayName: "Stranger" },
      reply: jest.fn(),
      deferUpdate: jest.fn(),
      editReply: jest.fn(),
    };

    await handleSignupCancelSetupButton(buttonInteraction as never);

    expect(buttonInteraction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "This roster setup expired or belongs to another user.",
      }),
    );
    expect(buttonInteraction.deferUpdate).not.toHaveBeenCalled();
  });

  it("persists newly created sheet to storage on /newrun Save Changes button click", async () => {
    const modalInteraction = {
      guildId: "guild-1",
      channelId: "channel-1",
      customId: "signup-setup",
      user: {
        id: "user-1",
        displayName: "Organizer",
        displayAvatarURL: () => "https://example.com/avatar.png",
      },
      fields: {
        getTextInputValue: jest.fn((name: string) => {
          if (name === "title") return "New Run Title";
          if (name === "datetime") return "10/09 20:00 GMT+8";
          if (name === "timezone") return "GMT+8";
          if (name === "parties") return "1";
          if (name === "sizes") return "2";
          return "";
        }),
      },
      deferReply: jest.fn(),
      editReply: jest.fn(),
    };

    await handleSignupModal(modalInteraction as never);

    const buttonMessageEdit = jest.fn();
    const saveButtonInteraction = {
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "user-1", displayName: "Organizer" },
      message: { edit: buttonMessageEdit },
      deferred: true,
      replied: false,
      deferReply: jest.fn(),
      reply: jest.fn(),
      editReply: jest
        .fn<() => Promise<{ id: string }>>()
        .mockResolvedValue({ id: "posted-msg-999" }),
      guild: { id: "guild-1", name: "Guild 1", iconURL: () => null },
    };

    await handleSignupNoRosterChangesButton(saveButtonInteraction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New Run Title",
        partySizes: [2],
      }),
    );
    expect(saveButtonInteraction.deferReply).toHaveBeenCalled();
    expect(saveButtonInteraction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      }),
    );
  });

  it("rejects unauthorized user on handleSignupNoRosterChangesButton", async () => {
    const sheet = buildSheet();
    getSignupSheet.mockResolvedValue(sheet);
    const setupInteraction = {
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "user-1", displayName: "Organizer" },
      options: {
        getSubcommand: jest.fn().mockReturnValue("roster"),
      },
      reply: jest.fn(),
    };
    await changeCommand.execute(setupInteraction as never);

    const buttonInteraction = {
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "stranger-99", displayName: "Stranger" },
      reply: jest.fn(),
    };

    await handleSignupNoRosterChangesButton(buttonInteraction as never);

    expect(buttonInteraction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "This roster setup expired or belongs to another user.",
      }),
    );
    expect(saveSignupSheet).not.toHaveBeenCalled();
  });

  it("cleans up stale message components on publishing a new sheet message", async () => {
    const oldMessageEdit = jest.fn();
    const mockChannel = {
      messages: {
        fetch: jest
          .fn<() => Promise<{ edit: typeof oldMessageEdit }>>()
          .mockResolvedValue({ edit: oldMessageEdit }),
      },
    };
    const sheet = buildSheet({ messageId: "old-msg-123" });
    getSignupSheet.mockResolvedValue(sheet);

    const interaction = {
      guildId: "guild-1",
      channelId: "channel-1",
      channel: mockChannel,
      guild: { id: "guild-1", name: "Guild 1", iconURL: () => null },
      user: { id: "user-1", displayName: "Organizer" },
      reply: jest.fn(),
      fetchReply: jest
        .fn<() => Promise<{ id: string }>>()
        .mockResolvedValue({ id: "new-msg-456" }),
      deferred: false,
      replied: false,
      options: {
        getString: jest.fn((name: string) =>
          name === "input" ? "New Run Title" : null,
        ),
      },
    };

    const nameCommand = signupCommands.find((c) => c.data.name === "name")!;
    await nameCommand.execute(interaction as never);

    expect(oldMessageEdit).toHaveBeenCalledWith({ components: [] });
    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "new-msg-456" }),
    );
  });
});

describe("parseSetup party size changes", () => {
  const createModalSubmitInteraction = (
    fields: {
      title?: string;
      datetime?: string;
      timezone?: string;
      parties?: string;
      sizes?: string;
    } = {},
  ) => ({
    guildId: "guild-1",
    channelId: "channel-1",
    user: {
      id: "user-1",
      displayName: "Organizer",
      displayAvatarURL: () => "https://example.com/avatar.png",
    },
    fields: {
      getTextInputValue: jest.fn((name: string) => {
        if (name === "title") return fields.title ?? "Test Run";
        if (name === "datetime") return fields.datetime ?? "10/09 20:00 GMT+8";
        if (name === "timezone") return fields.timezone ?? "GMT+8";
        if (name === "parties") return fields.parties ?? "1";
        if (name === "sizes") return fields.sizes ?? "2";
        return "";
      }),
    },
  });

  it("returns an error when reducing party sizes would drop occupied slots", () => {
    const existingSheet = buildSheet({
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
          signupUserId: "user-2",
          signupDisplayName: "Bob",
          charNote: null,
        },
      ],
    });

    const interaction = createModalSubmitInteraction({
      parties: "1",
      sizes: "1",
    });

    const result = parseSetup(interaction as never, existingSheet);
    expect(result).toEqual({
      error: expect.stringContaining(
        "Reducing party sizes would drop signups in slot(s): 02: DPS",
      ),
    });
  });

  it("allows reducing party sizes when dropped slots have no signups", () => {
    const existingSheet = buildSheet({
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
    });

    const interaction = createModalSubmitInteraction({
      parties: "1",
      sizes: "1",
    });

    const result = parseSetup(interaction as never, existingSheet);
    expect("sheet" in result).toBe(true);
    if ("sheet" in result) {
      expect(result.sheet.slots).toHaveLength(1);
      expect(result.sheet.slots[0]?.signupUserId).toBe("user-1");
    }
  });

  it("sets organizerId on sheet creation and preserves it on existing sheet", () => {
    const interaction = createModalSubmitInteraction({
      datetime: "10/09 20:00 GMT+8",
    });
    const newResult = parseSetup(interaction as never);
    expect("sheet" in newResult).toBe(true);
    if ("sheet" in newResult) {
      expect(newResult.sheet.organizerId).toBe("user-1");
    }

    const existingSheet = buildSheet({ organizerId: "orig-org-id" });
    const editResult = parseSetup(interaction as never, existingSheet);
    expect("sheet" in editResult).toBe(true);
    if ("sheet" in editResult) {
      expect(editResult.sheet.organizerId).toBe("orig-org-id");
    }
  });
});

describe("/swaporganizer", () => {
  it("updates organizerId, organizerName, and organizerAvatarUrl", async () => {
    const sheet = buildSheet({
      organizerId: "user-1",
      organizerName: "Old Organizer",
      organizerAvatarUrl: "https://example.com/old.png",
    });
    getSignupSheet.mockResolvedValue(sheet);

    const newUser = {
      id: "user-new-99",
      displayName: "New Organizer",
      displayAvatarURL: () => "https://example.com/new.png",
    };

    const interaction = {
      guildId: "guild-1",
      channelId: "channel-1",
      guild: { id: "guild-1", name: "Guild 1", iconURL: () => null },
      user: { id: "user-1", displayName: "Invoker" },
      reply: jest.fn(),
      deferred: false,
      replied: false,
      options: {
        getUser: jest.fn((name: string) => (name === "user" ? newUser : null)),
      },
    };

    const swapOrgCommand = signupCommands.find(
      (c) => c.data.name === "swaporganizer",
    )!;
    await swapOrgCommand.execute(interaction as never);

    expect(saveSignupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        organizerId: "user-new-99",
        organizerName: "New Organizer",
        organizerAvatarUrl: "https://example.com/new.png",
      }),
    );
  });
});

describe("/add overwrite confirmation buttons", () => {
  it("updates ephemeral confirmation and publishes public sheet to channel on confirm", async () => {
    const oldMessageEdit = jest.fn();
    const channelSend = jest
      .fn<(options: unknown) => Promise<{ id: string }>>()
      .mockResolvedValue({ id: "public-msg-789" });
    const mockChannel = {
      messages: {
        fetch: jest
          .fn<() => Promise<{ edit: typeof oldMessageEdit }>>()
          .mockResolvedValue({ edit: oldMessageEdit }),
      },
      send: channelSend,
    };
    const sheet = buildSheet({
      messageId: "old-public-msg-123",
      slots: [
        {
          number: 1,
          role: "Tank",
          signupUserId: "user-existing",
          signupDisplayName: "ExistingTank",
          charNote: null,
        },
      ],
    });
    getSignupSheet.mockResolvedValue(sheet);

    const key = addConfirmationKey("guild-1", "channel-1", "user-1");
    pendingAddConfirmations.set(key, {
      userId: "user-1",
      displayName: "NewTank",
      slotNumbers: [1],
      charNote: null,
      isTbc: false,
    });

    const buttonInteraction = {
      guildId: "guild-1",
      channelId: "channel-1",
      channel: mockChannel,
      guild: { id: "guild-1", name: "Guild 1", iconURL: () => null },
      user: { id: "user-1", displayName: "NewTank" },
      update: jest.fn(),
      followUp: jest.fn(),
    };

    await handleSignupAddConfirmButton(buttonInteraction as never);

    expect(buttonInteraction.update).toHaveBeenCalledWith({
      content: "Signup updated.",
      components: [],
    });
    expect(channelSend).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      }),
    );
    expect(oldMessageEdit).toHaveBeenCalledWith({ components: [] });
    expect(mutateSignupSheet).toHaveBeenCalledWith(
      "guild-1",
      "channel-1",
      expect.any(Function),
    );
  });

  it("handles expired confirmation on confirm", async () => {
    const buttonInteraction = {
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "user-1", displayName: "NewTank" },
      update: jest.fn(),
    };

    await handleSignupAddConfirmButton(buttonInteraction as never);

    expect(buttonInteraction.update).toHaveBeenCalledWith({
      content: "This confirmation has expired.",
      components: [],
    });
  });

  it("updates ephemeral confirmation message on cancel", async () => {
    const key = addConfirmationKey("guild-1", "channel-1", "user-1");
    pendingAddConfirmations.set(key, {
      userId: "user-1",
      displayName: "NewTank",
      slotNumbers: [1],
      charNote: null,
      isTbc: false,
    });

    const buttonInteraction = {
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "user-1", displayName: "NewTank" },
      update: jest.fn(),
    };

    await handleSignupAddCancelButton(buttonInteraction as never);

    expect(buttonInteraction.update).toHaveBeenCalledWith({
      content: "No changes were made.",
      components: [],
    });
    expect(pendingAddConfirmations.has(key)).toBe(false);
  });
});
