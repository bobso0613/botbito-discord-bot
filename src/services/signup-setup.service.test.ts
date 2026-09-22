import { describe, expect, it, jest } from "@jest/globals";
import { MessageFlags } from "discord.js";
import { INSTANCE_TYPE_NONE_VALUE } from "../constants/signup.js";
import type { SignupSheet } from "../types/signup-sheet.js";
import {
  buildInstanceTypeSelectRow,
  buildRosterPromptButtons,
  buildSetupPromptButtons,
  handleSignupInstanceTypeSelect,
  handleSignupRosterButton,
  parseSetup,
  pendingRosterUsers,
  pendingSetupDrafts,
} from "./signup-setup.service.js";

const createSheet = (): SignupSheet => ({
  guildId: "guild-id",
  channelId: "channel-id",
  title: "Existing run",
  organizerId: "organizer-id",
  organizerName: "Organizer",
  organizerAvatarUrl: "https://example.com/organizer.png",
  partySizes: [2],
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
      signupUserId: "member-id",
      signupDisplayName: "Member",
      charNote: null,
    },
  ],
  reserves: [],
  notes: null,
  thumbnailUrl: null,
  color: null,
  instanceType: null,
  timestamp: null,
  scheduleTimezone: null,
  serverTimezone: "GMT",
});

const createModalInteraction = (values: Record<string, string>) =>
  ({
    guildId: "guild-id",
    channelId: "channel-id",
    user: {
      id: "organizer-id",
      displayName: "Organizer",
      displayAvatarURL: jest
        .fn()
        .mockReturnValue("https://example.com/avatar.png"),
    },
    fields: {
      getTextInputValue: jest.fn((name: string) => values[name] ?? ""),
    },
  }) as never;

describe("signup setup service", () => {
  beforeEach(() => {
    pendingSetupDrafts.clear();
    pendingRosterUsers.clear();
  });

  it("builds the setup controls and roster prompt cancel button", () => {
    expect(
      buildSetupPromptButtons().components.map(
        (button) => (button.data as { label?: string }).label,
      ),
    ).toEqual([
      "Edit Roster",
      "Edit Party Setup",
      "Set Instance Type",
      "Save Changes",
      "Cancel",
    ]);
    expect(
      buildRosterPromptButtons().components.map(
        (button) => (button.data as { label?: string }).label,
      ),
    ).toEqual(["Cancel"]);
  });

  it("preselects the current instance type in the setup menu", () => {
    const select = buildInstanceTypeSelectRow("Endless Tower").components[0];
    const options = select?.toJSON().options ?? [];

    expect(
      options.find((option) => option.value === "Endless Tower"),
    ).toMatchObject({
      default: true,
    });
    expect(
      options.find((option) => option.value === INSTANCE_TYPE_NONE_VALUE),
    ).toMatchObject({
      default: false,
    });
  });

  it("parses a valid new setup submission", () => {
    const result = parseSetup(
      createModalInteraction({
        title: "Friday Endless Tower",
        datetime: "10/09 20:00 GMT+8",
        timezone: "GMT+8",
        parties: "2",
        sizes: "6,6",
      }),
    );

    expect(result).toMatchObject({
      sheet: {
        guildId: "guild-id",
        channelId: "channel-id",
        title: "Friday Endless Tower",
        partySizes: [6, 6],
        serverTimezone: "GMT+8",
      },
    });
  });

  it("requires a valid scheduled time when creating a new sheet", () => {
    const result = parseSetup(
      createModalInteraction({
        title: "Friday Endless Tower",
        datetime: "",
        timezone: "GMT",
        parties: "1",
        sizes: "6",
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it("rejects party sizes when their count does not match the party count", () => {
    const result = parseSetup(
      createModalInteraction({
        title: "Friday Endless Tower",
        datetime: "10/09 20:00 GMT+8",
        timezone: "GMT+8",
        parties: "2",
        sizes: "12",
      }),
    );

    expect(result).toEqual({
      error:
        "Number of parties (2) must match the number of party sizes (1). Enter one size for each party, separated by commas, e.g. 12,6.",
    });
  });

  it("prevents an edit from dropping an occupied party slot", () => {
    const result = parseSetup(
      createModalInteraction({
        title: "Existing run",
        datetime: "TBD",
        timezone: "GMT",
        parties: "1",
        sizes: "1",
      }),
      createSheet(),
    );

    expect(result).toEqual({
      error:
        "Reducing party sizes would drop signups in slot(s): 02: Healer. Remove or move those players before shrinking party sizes.",
    });
  });

  it("updates a pending draft's selected instance type and restores setup controls", async () => {
    const key = "guild-id:channel-id";
    const sheet = createSheet();
    pendingSetupDrafts.set(key, sheet);
    pendingRosterUsers.set(key, "organizer-id");
    const interaction = {
      guildId: "guild-id",
      channelId: "channel-id",
      user: { id: "organizer-id" },
      values: ["Endless Tower"],
      deferUpdate: jest.fn(),
      editReply: jest.fn(),
    };

    await handleSignupInstanceTypeSelect(interaction as never);

    expect(sheet.instanceType).toBe("Endless Tower");
    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ components: [expect.anything()] }),
    );
  });

  it("rejects roster edits from anyone other than the pending setup owner", async () => {
    const reply = jest.fn();

    await handleSignupRosterButton({
      guildId: "guild-id",
      channelId: "channel-id",
      user: { id: "other-user-id" },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith({
      content: "This roster setup expired or belongs to another user.",
      flags: MessageFlags.Ephemeral,
    });
  });
});
