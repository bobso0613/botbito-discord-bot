import { describe, expect, it, jest, afterEach } from "@jest/globals";
import { ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";
import type {
  DiscordSettings,
  GuildSettings,
} from "../types/discord-settings.js";

const updateGuildScheduleSource =
  jest.fn<
    (
      guildId: string,
      update: (source: GuildSettings["guildScheduleSource"]) => void,
    ) => Promise<void>
  >();
const publishGuildScheduleAnnouncement = jest.fn();
const updateGuildCooldownSettings =
  jest.fn<
    (
      guildId: string,
      update: (
        settings: Pick<
          GuildSettings,
          "cooldownInstanceTypes" | "multiplierInstanceTypes"
        >,
      ) => void,
    ) => Promise<void>
  >();
const DISCORD_SETTINGS: DiscordSettings = {
  payoutGuildIds: [],
  payoutToPingId: "",
  payoutToPingTag: "",
  guildScheduleBotIds: [],
  guildIcons: { DEV: {}, PROD: {} },
  guildScheduleSourceByGuild: {},
  cooldownInstanceTypesByGuild: {},
  multiplierInstanceTypesByGuild: {},
};

jest.unstable_mockModule("../services/guild-settings.service.js", () => ({
  updateGuildScheduleSource,
  updateGuildCooldownSettings,
}));
jest.unstable_mockModule(
  "../services/guild-schedule-announcement.service.js",
  () => ({ publishGuildScheduleAnnouncement }),
);
jest.unstable_mockModule("../config/discord-settings.js", () => ({
  DISCORD_SETTINGS,
}));

const { guildSettingCommand } = await import("./guildsetting.command.js");

afterEach(() => {
  Object.assign(DISCORD_SETTINGS, {
    cooldownInstanceTypesByGuild: {},
    multiplierInstanceTypesByGuild: {},
  });
});

const source: GuildSettings["guildScheduleSource"] = {
  categoryIds: [],
  excludedChannelIds: [],
  roleRestrictedChannels: {},
  scheduleTextChannelIds: [],
};
const guild = {
  name: "Test Guild",
  iconURL: jest.fn().mockReturnValue(null),
  channels: {
    cache: new Map([
      [
        "100000000000000001",
        {
          id: "100000000000000001",
          name: "run-signups",
          type: ChannelType.GuildCategory,
        },
      ],
      [
        "100000000000000002",
        {
          id: "100000000000000002",
          name: "schedule",
          type: ChannelType.GuildText,
        },
      ],
      [
        "100000000000000003",
        {
          id: "100000000000000003",
          name: "private-run",
          type: ChannelType.GuildText,
        },
      ],
    ]),
    fetch: jest.fn(),
  },
  roles: {
    cache: new Map([
      ["100000000000000004", { id: "100000000000000004", name: "Elite" }],
    ]),
    fetch: jest.fn(),
  },
};
guild.channels.fetch.mockImplementation(async () => guild.channels.cache);
guild.roles.fetch.mockImplementation(async () => guild.roles.cache);

const createInteraction = (
  subcommand: string,
  value: string,
  subcommandGroup: string | null = "set",
  isAdministrator = true,
  optionValues: Record<string, string> = {},
) => ({
  guildId: "guild-id",
  guild,
  user: {
    id: "user-id",
    username: "admin",
    tag: "admin#0001",
    displayName: "Admin",
    displayAvatarURL: jest.fn().mockReturnValue("avatar-url"),
  },
  memberPermissions: {
    has: jest.fn().mockReturnValue(isAdministrator),
  },
  options: {
    getSubcommand: jest.fn().mockReturnValue(subcommand),
    getSubcommandGroup: jest.fn().mockReturnValue(subcommandGroup),
    getString: jest.fn((name: string) => optionValues[name] ?? value),
  },
  reply: jest.fn(),
});

describe("guild setting command", () => {
  it("sets tracked categories from channel links and names", async () => {
    updateGuildScheduleSource.mockImplementation(
      async (_guildId, update: (value: typeof source) => void) =>
        update(source),
    );
    const interaction = createInteraction(
      "tracked-category",
      "https://discord.com/channels/100000000000000000/100000000000000001, #run-signups",
    );

    await guildSettingCommand.execute(interaction as never);

    expect(source.categoryIds).toEqual(["100000000000000001"]);
    expect(updateGuildScheduleSource).toHaveBeenCalledWith(
      "guild-id",
      expect.any(Function),
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Guild schedule setting updated.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("sets tracked categories from a raw category ID", async () => {
    updateGuildScheduleSource.mockImplementation(
      async (_guildId, update: (value: typeof source) => void) =>
        update(source),
    );
    const interaction = createInteraction(
      "tracked-category",
      "100000000000000001",
    );

    await guildSettingCommand.execute(interaction as never);

    expect(source.categoryIds).toEqual(["100000000000000001"]);
  });

  it("sets role-restricted channel mappings from channel and role mentions", async () => {
    updateGuildScheduleSource.mockImplementation(
      async (_guildId, update: (value: typeof source) => void) =>
        update(source),
    );
    const interaction = createInteraction(
      "role-restricted-channels",
      "#private-run=<@&100000000000000004>",
    );

    await guildSettingCommand.execute(interaction as never);

    expect(source.roleRestrictedChannels).toEqual({
      "100000000000000003": "100000000000000004",
    });
  });

  it("publishes an embed to newly added schedule channels", async () => {
    updateGuildScheduleSource.mockImplementation(
      async (_guildId, update: (value: typeof source) => void) => {
        source.scheduleTextChannelIds = ["100000000000000002"];
        update(source);
      },
    );
    const interaction = createInteraction("schedule-channels", "#schedule");

    await guildSettingCommand.execute(interaction as never);

    expect(publishGuildScheduleAnnouncement).toHaveBeenCalledWith(
      guild,
      ["100000000000000002"],
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("sets one cooldown instance type from separate string options", async () => {
    updateGuildCooldownSettings.mockImplementation(
      async (
        _guildId,
        update: (
          value: Pick<
            GuildSettings,
            "cooldownInstanceTypes" | "multiplierInstanceTypes"
          >,
        ) => void,
      ) =>
        update({
          cooldownInstanceTypes: [],
          multiplierInstanceTypes: [],
        }),
    );
    const interaction = createInteraction(
      "cooldown-instance-types",
      "Custom Run",
      "set",
      true,
      {
        name: "Custom Run",
        keywords: "CR, Custom Run",
        maxattempts: "2",
        emoji: "✨",
      },
    );

    await guildSettingCommand.execute(interaction as never);

    expect(updateGuildCooldownSettings).toHaveBeenCalledWith(
      "guild-id",
      expect.any(Function),
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Guild cooldown setting updated.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("updates an existing cooldown instance type instead of erroring on a duplicate name", async () => {
    Object.assign(DISCORD_SETTINGS.cooldownInstanceTypesByGuild, {
      "guild-id": [
        { name: "Custom Run", keywords: ["CR"], maxAttempts: 1, emoji: "🌀" },
      ],
    });
    let savedTypes: GuildSettings["cooldownInstanceTypes"] = [];
    updateGuildCooldownSettings.mockImplementation(
      async (
        _guildId,
        update: (
          value: Pick<
            GuildSettings,
            "cooldownInstanceTypes" | "multiplierInstanceTypes"
          >,
        ) => void,
      ) => {
        const settings = {
          cooldownInstanceTypes: [],
          multiplierInstanceTypes: [],
        };
        update(settings);
        savedTypes = settings.cooldownInstanceTypes;
      },
    );
    const interaction = createInteraction(
      "cooldown-instance-types",
      "Custom Run",
      "set",
      true,
      {
        name: "Custom Run",
        keywords: "CR, Custom Run",
        maxattempts: "2",
        emoji: "✨",
      },
    );

    await guildSettingCommand.execute(interaction as never);

    expect(savedTypes).toEqual([
      {
        name: "Custom Run",
        keywords: ["CR", "Custom Run"],
        maxAttempts: 2,
        emoji: "✨",
      },
    ]);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Guild cooldown setting updated.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("removes a single cooldown instance type by name", async () => {
    Object.assign(DISCORD_SETTINGS.cooldownInstanceTypesByGuild, {
      "guild-id": [
        { name: "Custom Run", keywords: ["CR"], maxAttempts: 1, emoji: "🌀" },
      ],
    });
    let savedSettings: Pick<
      GuildSettings,
      "cooldownInstanceTypes" | "multiplierInstanceTypes"
    > = { cooldownInstanceTypes: [], multiplierInstanceTypes: [] };
    updateGuildCooldownSettings.mockImplementation(
      async (
        _guildId,
        update: (
          value: Pick<
            GuildSettings,
            "cooldownInstanceTypes" | "multiplierInstanceTypes"
          >,
        ) => void,
      ) => {
        const settings = {
          cooldownInstanceTypes: [
            {
              name: "Custom Run",
              keywords: ["CR"],
              maxAttempts: 1,
              emoji: "🌀",
            },
          ],
          multiplierInstanceTypes: ["Custom Run"],
        };
        update(settings);
        savedSettings = settings;
      },
    );
    const interaction = createInteraction(
      "cooldown-instance-type",
      "",
      "remove",
      true,
      { name: "Custom Run" },
    );

    await guildSettingCommand.execute(interaction as never);

    expect(savedSettings).toEqual({
      cooldownInstanceTypes: [],
      multiplierInstanceTypes: [],
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Removed cooldown instance type "Custom Run".',
      flags: MessageFlags.Ephemeral,
    });
  });

  it("rejects removing a cooldown instance type that does not exist", async () => {
    updateGuildCooldownSettings.mockImplementation(
      async (
        _guildId,
        update: (
          value: Pick<
            GuildSettings,
            "cooldownInstanceTypes" | "multiplierInstanceTypes"
          >,
        ) => void,
      ) =>
        update({
          cooldownInstanceTypes: [],
          multiplierInstanceTypes: [],
        }),
    );
    const interaction = createInteraction(
      "cooldown-instance-type",
      "",
      "remove",
      true,
      { name: "Nonexistent" },
    );

    await guildSettingCommand.execute(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'No instance type named "Nonexistent" exists.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it("shows the current guild settings", async () => {
    const interaction = createInteraction("show", "", null);

    await guildSettingCommand.execute(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining("Tracked categories:"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it("resolves tracked category IDs to names on show", async () => {
    DISCORD_SETTINGS.guildScheduleSourceByGuild["guild-id"] = {
      ...source,
      categoryIds: ["100000000000000001"],
    };
    try {
      const interaction = createInteraction("show", "", null);

      await guildSettingCommand.execute(interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("**Tracked categories:** run-signups"),
        flags: MessageFlags.Ephemeral,
      });
    } finally {
      delete DISCORD_SETTINGS.guildScheduleSourceByGuild["guild-id"];
    }
  });

  it("shows all categories tracked when none are set but schedule channels are", async () => {
    DISCORD_SETTINGS.guildScheduleSourceByGuild["guild-id"] = {
      ...source,
      categoryIds: [],
      scheduleTextChannelIds: ["100000000000000002"],
    };
    try {
      const interaction = createInteraction("show", "", null);

      await guildSettingCommand.execute(interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining(
          "**Tracked categories:** All categories",
        ),
        flags: MessageFlags.Ephemeral,
      });
    } finally {
      delete DISCORD_SETTINGS.guildScheduleSourceByGuild["guild-id"];
    }
  });

  it("clears multiplier instance types", async () => {
    const interaction = createInteraction(
      "multiplier-instance-types",
      "",
      "clear",
    );

    await guildSettingCommand.execute(interaction as never);

    expect(updateGuildCooldownSettings).toHaveBeenCalledWith(
      "guild-id",
      expect.any(Function),
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Guild cooldown setting cleared.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it.each([
    ["tracked-category", "categoryIds", ["category-id"]],
    ["excluded-channels", "excludedChannelIds", ["excluded-channel-id"]],
    ["schedule-channels", "scheduleTextChannelIds", ["schedule-channel-id"]],
    [
      "role-restricted-channels",
      "roleRestrictedChannels",
      { "private-channel-id": "role-id" },
    ],
  ])("clears %s", async (subcommand, setting, existingValue) => {
    Object.assign(source, {
      [setting]: existingValue,
    });
    updateGuildScheduleSource.mockImplementation(
      async (_guildId, update: (value: typeof source) => void) =>
        update(source),
    );
    const interaction = createInteraction(subcommand, "", "clear");

    await guildSettingCommand.execute(interaction as never);

    expect(source[setting as keyof typeof source]).toEqual(
      setting === "roleRestrictedChannels" ? {} : [],
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Guild schedule setting cleared.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("rejects members without Administrator permission", async () => {
    const interaction = createInteraction(
      "schedule-channels",
      "#schedule",
      "set",
      false,
    );

    await guildSettingCommand.execute(interaction as never);

    expect(updateGuildScheduleSource).not.toHaveBeenCalled();
    expect(interaction.memberPermissions.has).toHaveBeenCalledWith(
      PermissionFlagsBits.Administrator,
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        "You need the Administrator permission to change guild settings.",
      flags: MessageFlags.Ephemeral,
    });
  });
});
