import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  InteractionContextType,
  MessageFlags,
  type InteractionDeferReplyOptions,
  type InteractionEditReplyOptions,
} from "discord.js";

const updateUserNotificationSetting = jest.fn(
  async (_guildId: string, _userId: string, _enabled: boolean) => undefined,
);
jest.unstable_mockModule("../services/guild-settings.service.js", () => ({
  updateUserNotificationSetting,
  getUserNotificationSettings: jest.fn(async () => ({})),
}));
const { setNotificationSetting, notificationControlledActions } =
  await import("./notification-setting.command.js");
const { setShareStatusCommand } = await import("./share-status.command.js");

const createInteraction = (setting: string) => ({
  guildId: "guild-id",
  guild: { name: "Guild Name" },
  user: { id: "user-id" },
  options: {
    getString: jest.fn(() => setting),
    getSubcommandGroup: jest.fn(() => "notification"),
  },
  deferReply: jest.fn(
    async (_options: InteractionDeferReplyOptions) => undefined,
  ),
  editReply: jest.fn(
    async (_options: InteractionEditReplyOptions) => undefined,
  ),
});

describe("/set notification setting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("registers required On/Off choices in the payout-guild set command", () => {
    const data = setShareStatusCommand.data.toJSON();
    expect(data.contexts).toEqual([InteractionContextType.Guild]);
    expect(setShareStatusCommand.guildIds).toBeDefined();
    expect(
      data.options?.find(({ name }) => name === "notification"),
    ).toMatchObject({
      name: "notification",
      type: 2,
      options: [
        {
          name: "setting",
          type: 1,
          options: [
            {
              name: "setting",
              type: 3,
              required: true,
              choices: [
                { name: "On", value: "on" },
                { name: "Off", value: "off" },
              ],
            },
          ],
        },
      ],
    });
    expect(setShareStatusCommand.data.toJSON().options).toContainEqual(
      data.options?.[0],
    );
  });

  it.each([
    ["on", true, "On"],
    ["off", false, "Off"],
  ] as const)(
    "persists %s for the caller and confirms ephemerally",
    async (setting, enabled, choice) => {
      const interaction = createInteraction(setting);
      await setNotificationSetting(interaction as never);
      expect(interaction.deferReply).toHaveBeenCalledWith({
        flags: MessageFlags.Ephemeral,
      });
      expect(updateUserNotificationSetting).toHaveBeenCalledWith(
        "guild-id",
        "user-id",
        enabled,
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining(
          `You have set your notification settings in Guild Name as ${choice}`,
        ),
        allowedMentions: { parse: [] },
      });
      const content = interaction.editReply.mock.calls[0]?.[0].content;
      if (enabled) {
        expect(content).toBe(
          `You have set your notification settings in Guild Name as ${choice}`,
        );
      } else {
        expect(content).toContain(
          "The following commands/actions will no longer DM you in this server:",
        );
        expect(content).toContain("- `/set share status`");
        for (const action of notificationControlledActions) {
          expect(content).toContain(`- \`${action}\``);
        }
      }
    },
  );

  it("dispatches the guild-specific set command to the same private preference handler", async () => {
    const interaction = createInteraction("off");
    await setShareStatusCommand.execute(interaction as never);
    expect(updateUserNotificationSetting).toHaveBeenCalledWith(
      "guild-id",
      "user-id",
      false,
    );
    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
  });

  it("escapes markdown in the guild name in the confirmation", async () => {
    const interaction = createInteraction("on");
    interaction.guild.name = "Raid *Guild*";
    await setNotificationSetting(interaction as never);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          "You have set your notification settings in Raid \\*Guild\\* as On",
      }),
    );
  });

  it.each(["invalid", "missing-guild", "write-error", "non-error-write-error"])(
    "reports %s privately without success",
    async (scenario) => {
      const interaction = createInteraction(
        scenario === "invalid" ? "invalid" : "on",
      );
      if (scenario === "missing-guild") interaction.guildId = "";
      if (scenario === "write-error")
        updateUserNotificationSetting.mockRejectedValueOnce(
          new Error("disk failure"),
        );
      if (scenario === "non-error-write-error")
        updateUserNotificationSetting.mockRejectedValueOnce("disk failure");
      await setNotificationSetting(interaction as never);
      expect(interaction.deferReply).toHaveBeenCalledWith({
        flags: MessageFlags.Ephemeral,
      });
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining(
            "Could not set notification settings:",
          ),
        }),
      );
      if (scenario !== "write-error" && scenario !== "non-error-write-error") {
        expect(updateUserNotificationSetting).not.toHaveBeenCalled();
      }
      if (scenario === "non-error-write-error")
        expect(interaction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: "Could not set notification settings: disk failure",
          }),
        );
    },
  );
});
