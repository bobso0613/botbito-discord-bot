import {
  ApplicationIntegrationType,
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Collection,
  type Guild,
  type NonThreadGuildBasedChannel,
  type Role,
} from "discord.js";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import {
  updateGuildCooldownSettings,
  updateGuildScheduleSource,
} from "../services/guild-settings.service.js";
import { publishGuildScheduleAnnouncement } from "../services/guild-schedule-announcement.service.js";
import { getInteractionContext } from "../utils/interaction-context.js";
import type { Command } from "../types/command.js";
import type { GuildSettings } from "../types/discord-settings.js";
import type { InstanceType } from "../constants/cooldowns.js";

/** Splits comma-, semicolon-, or newline-delimited command input into values. */
const splitValues = (value: string): string[] =>
  value
    .split(/[,;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const parseInstanceType = (
  name: string,
  keywords: string,
  maxAttempts: string,
  emoji: string,
): InstanceType => {
  const parsedMaxAttempts = Number(maxAttempts);
  if (!name.trim() || !emoji.trim()) {
    throw new Error("Name and emoji cannot be empty.");
  }
  if (!Number.isInteger(parsedMaxAttempts) || parsedMaxAttempts < 0) {
    throw new Error("maxAttempts must be a non-negative integer.");
  }
  return {
    name: name.trim(),
    keywords: splitValues(keywords),
    maxAttempts: parsedMaxAttempts,
    emoji: emoji.trim(),
  };
};

/** Resolves a channel mention, channel link, raw ID, or #channel name to an ID of the expected type. */
const resolveChannel = (
  channels: Collection<string, NonThreadGuildBasedChannel | null>,
  value: string,
  type: ChannelType.GuildCategory | ChannelType.GuildText,
): string | undefined => {
  const id =
    /^<#(\d+)>$/.exec(value)?.[1] ??
    /discord\.com\/channels\/\d+\/(\d+)/.exec(value)?.[1] ??
    (/^\d+$/.test(value) ? value : undefined);
  const name = value.replace(/^#/, "").toLowerCase();
  const channel = id
    ? channels.get(id)
    : Array.from(channels.values()).find(
        (candidate) => candidate?.name.toLowerCase() === name,
      );
  return channel?.type === type ? channel.id : undefined;
};

/** Resolves a delimited channel list, retaining entries that could not be found or had the wrong type. */
const resolveChannels = (
  channels: Collection<string, NonThreadGuildBasedChannel | null>,
  value: string,
  type: ChannelType.GuildCategory | ChannelType.GuildText,
): { ids: string[]; invalid: string[] } => {
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const entry of splitValues(value)) {
    const id = resolveChannel(channels, entry, type);
    if (id) ids.push(id);
    else invalid.push(entry);
  }
  return { ids: [...new Set(ids)], invalid };
};

/** Resolves a role mention or @role name to its Discord ID. */
const resolveRole = (
  roles: Collection<string, Role>,
  value: string,
): string | undefined => {
  const id = /^<@&(\d+)>$/.exec(value)?.[1];
  const name = value.replace(/^@/, "").toLowerCase();
  const role = id
    ? roles.get(id)
    : Array.from(roles.values()).find(
        (candidate) => candidate.name.toLowerCase() === name,
      );
  return role?.id;
};

/** Sends the response used when a guild-only setting command is invoked outside a guild. */
const guildOnlyReply = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  await interaction.reply({
    content: "Guild settings can only be changed in a server.",
    flags: MessageFlags.Ephemeral,
  });
};

/** Formats the "Tracked categories" summary line, resolving IDs to names; empty tracks every category when schedule channels are set. */
const formatTrackedCategories = (
  guild: Guild,
  source: GuildSettings["guildScheduleSource"] | undefined,
): string => {
  if (source?.categoryIds.length) {
    return source.categoryIds
      .map((id) => guild.channels.cache.get(id)?.name ?? `<#${id}>`)
      .join(", ");
  }
  return source?.scheduleTextChannelIds.length ? "All categories" : "none";
};

/** Builds the ephemeral summary shown by `/guildsetting show`. */
const buildGuildSettingsSummary = (guild: Guild, guildId: string): string => {
  const source = DISCORD_SETTINGS.guildScheduleSourceByGuild[guildId];
  const cooldownTypes =
    DISCORD_SETTINGS.cooldownInstanceTypesByGuild[guildId] ?? [];
  const multiplierTypes =
    DISCORD_SETTINGS.multiplierInstanceTypesByGuild[guildId] ?? [];
  const roleRestrictedEntries = Object.entries(
    source?.roleRestrictedChannels ?? {},
  );

  return [
    `**Tracked categories:** ${formatTrackedCategories(guild, source)}`,
    `**Schedule channels:** ${
      source?.scheduleTextChannelIds.length
        ? source.scheduleTextChannelIds.map((id) => `<#${id}>`).join(", ")
        : "none"
    }`,
    `**Excluded channels:** ${
      source?.excludedChannelIds?.length
        ? source.excludedChannelIds.map((id) => `<#${id}>`).join(", ")
        : "none"
    }`,
    `**Role-restricted channels:** ${
      roleRestrictedEntries.length
        ? roleRestrictedEntries
            .map(([channelId, roleId]) => `<#${channelId}> -> <@&${roleId}>`)
            .join(", ")
        : "none"
    }`,
    `**Cooldown instance types:** ${
      cooldownTypes.length
        ? cooldownTypes
            .map(
              (type) => `${type.emoji} ${type.name} (max ${type.maxAttempts})`,
            )
            .join(", ")
        : "none"
    }`,
    `**Multiplier instance types:** ${
      multiplierTypes.length ? multiplierTypes.join(", ") : "none"
    }`,
  ].join("\n");
};

/** Maps a "set" subcommand to the string option name that holds its value. */
const getSetValueOptionName = (subcommand: string): string => {
  switch (subcommand) {
    case "cooldown-instance-types":
      return "name";
    case "tracked-category":
      return "categories";
    case "role-restricted-channels":
      return "mappings";
    case "multiplier-instance-types":
      return "types";
    default:
      return "channels";
  }
};

/** Replies with a validation error's message, falling back to a generic one. */
const replyWithError = async (
  interaction: ChatInputCommandInteraction,
  error: unknown,
  fallback: string,
): Promise<void> => {
  await interaction.reply({
    content: error instanceof Error ? error.message : fallback,
    flags: MessageFlags.Ephemeral,
  });
};

const handleShow = async (
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  guildId: string,
): Promise<void> => {
  await interaction.reply({
    content: buildGuildSettingsSummary(guild, guildId),
    flags: MessageFlags.Ephemeral,
  });
};

const handleRemoveCooldownInstanceType = async (
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> => {
  const name = interaction.options.getString("name", true);
  try {
    await updateGuildCooldownSettings(guildId, (settings) => {
      if (!settings.cooldownInstanceTypes.some((type) => type.name === name)) {
        throw new Error(`No instance type named "${name}" exists.`);
      }
      settings.cooldownInstanceTypes = settings.cooldownInstanceTypes.filter(
        (type) => type.name !== name,
      );
      settings.multiplierInstanceTypes =
        settings.multiplierInstanceTypes.filter(
          (multiplierName) => multiplierName !== name,
        );
    });
  } catch (error) {
    await replyWithError(interaction, error, "Invalid cooldown setting.");
    return;
  }
  await interaction.reply({
    content: `Removed cooldown instance type "${name}".`,
    flags: MessageFlags.Ephemeral,
  });
};

/** Applies a "clear" subcommand to the guild's schedule source in place. */
const clearScheduleSource = (
  source: GuildSettings["guildScheduleSource"],
  subcommand: string,
): void => {
  if (subcommand === "tracked-category") source.categoryIds = [];
  else if (subcommand === "excluded-channels") source.excludedChannelIds = [];
  else if (subcommand === "schedule-channels")
    source.scheduleTextChannelIds = [];
  else source.roleRestrictedChannels = {};
};

const handleClear = async (
  interaction: ChatInputCommandInteraction,
  guildId: string,
  subcommand: string,
): Promise<void> => {
  const isCooldownSetting =
    subcommand === "cooldown-instance-types" ||
    subcommand === "multiplier-instance-types";

  if (subcommand === "cooldown-instance-types") {
    await updateGuildCooldownSettings(guildId, (settings) => {
      settings.cooldownInstanceTypes = [];
    });
  } else if (subcommand === "multiplier-instance-types") {
    await updateGuildCooldownSettings(guildId, (settings) => {
      settings.multiplierInstanceTypes = [];
    });
  } else {
    await updateGuildScheduleSource(guildId, (source) =>
      clearScheduleSource(source, subcommand),
    );
  }

  await interaction.reply({
    content: isCooldownSetting
      ? "Guild cooldown setting cleared."
      : "Guild schedule setting cleared.",
    flags: MessageFlags.Ephemeral,
  });
};

const setCooldownInstanceType = async (
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> => {
  const type = parseInstanceType(
    interaction.options.getString("name", true),
    interaction.options.getString("keywords", true),
    interaction.options.getString("maxattempts", true),
    interaction.options.getString("emoji", true),
  );
  await updateGuildCooldownSettings(guildId, (settings) => {
    settings.cooldownInstanceTypes = settings.cooldownInstanceTypes.some(
      ({ name }) => name === type.name,
    )
      ? settings.cooldownInstanceTypes.map((existing) =>
          existing.name === type.name ? type : existing,
        )
      : [...settings.cooldownInstanceTypes, type];
  });
};

const setMultiplierInstanceTypes = async (
  guildId: string,
  value: string,
): Promise<void> => {
  const types = splitValues(value);
  await updateGuildCooldownSettings(guildId, (settings) => {
    const configuredNames = new Set(
      settings.cooldownInstanceTypes.map(({ name }) => name),
    );
    if (types.some((type) => !configuredNames.has(type))) {
      throw new Error(
        "Every multiplier type must be a configured instance type.",
      );
    }
    settings.multiplierInstanceTypes = types;
  });
};

const handleSetCooldownOrMultiplier = async (
  interaction: ChatInputCommandInteraction,
  guildId: string,
  subcommand: string,
  value: string,
): Promise<void> => {
  try {
    if (subcommand === "cooldown-instance-types") {
      await setCooldownInstanceType(interaction, guildId);
    } else {
      await setMultiplierInstanceTypes(guildId, value);
    }
  } catch (error) {
    await replyWithError(interaction, error, "Invalid cooldown setting.");
    return;
  }
  await interaction.reply({
    content: "Guild cooldown setting updated.",
    flags: MessageFlags.Ephemeral,
  });
};

/** Parses a single "#channel=@role" (or `:`/`->`) mapping entry. */
const parseRoleRestrictedEntry = (
  channels: Collection<string, NonThreadGuildBasedChannel | null>,
  roles: Collection<string, Role>,
  entry: string,
): { channelId: string; roleId: string } | undefined => {
  const [channelValue, roleValue, ...extra] = entry
    .split(/=|:|->/)
    .map((part) => part.trim());
  const channelId = channelValue
    ? resolveChannel(channels, channelValue, ChannelType.GuildText)
    : undefined;
  const roleId = roleValue ? resolveRole(roles, roleValue) : undefined;
  return extra.length || !channelId || !roleId
    ? undefined
    : { channelId, roleId };
};

const handleSetRoleRestrictedChannels = async (
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  guildId: string,
  value: string,
): Promise<void> => {
  const [channels, roles] = await Promise.all([
    guild.channels.fetch(),
    guild.roles.fetch(),
  ]);
  const mappings: Record<string, string> = {};
  const invalid: string[] = [];
  for (const entry of splitValues(value)) {
    const parsed = parseRoleRestrictedEntry(channels, roles, entry);
    if (parsed) mappings[parsed.channelId] = parsed.roleId;
    else invalid.push(entry);
  }
  if (invalid.length) {
    await interaction.reply({
      content: `Could not resolve: ${invalid.join(", ")}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await updateGuildScheduleSource(guildId, (source) => {
    source.roleRestrictedChannels = mappings;
  });
  await interaction.reply({
    content: "Guild schedule setting updated.",
    flags: MessageFlags.Ephemeral,
  });
};

/** Applies a resolved channel id list to the matching schedule-source field. */
const applyChannelListUpdate = (
  source: GuildSettings["guildScheduleSource"],
  subcommand: string,
  ids: string[],
): void => {
  if (subcommand === "tracked-category") source.categoryIds = ids;
  else if (subcommand === "excluded-channels") source.excludedChannelIds = ids;
  else source.scheduleTextChannelIds = ids;
};

/** Announces newly added schedule channels, if this update added any. */
const announceAddedScheduleChannels = async (
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  source: GuildSettings["guildScheduleSource"],
  previousScheduleTextChannelIds: string[],
): Promise<void> => {
  const addedChannelIds = source.scheduleTextChannelIds.filter(
    (channelId) => !previousScheduleTextChannelIds.includes(channelId),
  );
  if (!addedChannelIds.length) return;

  await publishGuildScheduleAnnouncement(
    guild,
    addedChannelIds,
    source.categoryIds,
    (source.excludedChannelIds ?? []).filter(
      (channelId) => !source.roleRestrictedChannels?.[channelId],
    ),
    source.roleRestrictedChannels,
    getInteractionContext(interaction),
  );
};

const handleSetChannelList = async (
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  guildId: string,
  subcommand: string,
  value: string,
  previousScheduleTextChannelIds: string[],
): Promise<void> => {
  const type =
    subcommand === "tracked-category"
      ? ChannelType.GuildCategory
      : ChannelType.GuildText;
  const channels = await guild.channels.fetch();
  const { ids, invalid } = resolveChannels(channels, value, type);
  if (invalid.length) {
    await interaction.reply({
      content: `Could not resolve: ${invalid.join(", ")}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let updatedSource: GuildSettings["guildScheduleSource"] | undefined;
  await updateGuildScheduleSource(guildId, (source) => {
    applyChannelListUpdate(source, subcommand, ids);
    updatedSource = source;
  });

  if (subcommand === "schedule-channels" && updatedSource) {
    await announceAddedScheduleChannels(
      interaction,
      guild,
      updatedSource,
      previousScheduleTextChannelIds,
    );
  }

  await interaction.reply({
    content: "Guild schedule setting updated.",
    flags: MessageFlags.Ephemeral,
  });
};

/** Administrator-only commands for configuring the current guild's schedule sources. */
export const guildSettingCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("guildsetting")
    .setDescription("Configure this guild's schedule settings")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("show")
        .setDescription(
          "Show this guild's current schedule and cooldown settings",
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("set")
        .setDescription(
          "Replace a schedule setting, or add/update one cooldown instance type",
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("tracked-category")
            .setDescription("Set tracked schedule categories")
            .addStringOption((option) =>
              option
                .setName("categories")
                .setDescription("Category links or #names, separated by commas")
                .setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("excluded-channels")
            .setDescription("Set excluded schedule channels")
            .addStringOption((option) =>
              option
                .setName("channels")
                .setDescription("Channel links or #names, separated by commas")
                .setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("schedule-channels")
            .setDescription("Set schedule announcement channels")
            .addStringOption((option) =>
              option
                .setName("channels")
                .setDescription("Channel links or #names, separated by commas")
                .setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("role-restricted-channels")
            .setDescription("Set channel-to-role restrictions")
            .addStringOption((option) =>
              option
                .setName("mappings")
                .setDescription("#channel=@role mappings, separated by commas")
                .setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("cooldown-instance-types")
            .setDescription("Set one cooldown instance type")
            .addStringOption((option) =>
              option
                .setName("name")
                .setDescription("Instance type name")
                .setRequired(true),
            )
            .addStringOption((option) =>
              option
                .setName("keywords")
                .setDescription("Comma-separated title keywords")
                .setRequired(true),
            )
            .addStringOption((option) =>
              option
                .setName("maxattempts")
                .setDescription("Maximum weekly attempts")
                .setRequired(true),
            )
            .addStringOption((option) =>
              option
                .setName("emoji")
                .setDescription("Display emoji")
                .setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("multiplier-instance-types")
            .setDescription("Set cooldown multiplier instance names")
            .addStringOption((option) =>
              option
                .setName("types")
                .setDescription("Instance names separated by commas")
                .setRequired(true),
            ),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("clear")
        .setDescription("Clear a schedule setting")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("tracked-category")
            .setDescription("Clear tracked schedule categories"),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("excluded-channels")
            .setDescription("Clear excluded schedule channels"),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("schedule-channels")
            .setDescription("Clear schedule announcement channels"),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("role-restricted-channels")
            .setDescription("Clear channel-to-role restrictions"),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("cooldown-instance-types")
            .setDescription("Clear cooldown instance types"),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("multiplier-instance-types")
            .setDescription("Clear cooldown multiplier instance names"),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("remove")
        .setDescription("Remove a single guild setting entry")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("cooldown-instance-type")
            .setDescription("Remove one cooldown instance type by name")
            .addStringOption((option) =>
              option
                .setName("name")
                .setDescription("Instance type name")
                .setRequired(true),
            ),
        ),
    ) as SlashCommandBuilder,
  registerInAllGuilds: true,
  execute: async (interaction) => {
    if (!interaction.guild || !interaction.guildId) {
      await guildOnlyReply(interaction);
      return;
    }
    if (
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      await interaction.reply({
        content:
          "You need the Administrator permission to change guild settings.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guild = interaction.guild;
    const guildId = interaction.guildId;
    const subcommand = interaction.options.getSubcommand();
    const subcommandGroup = interaction.options.getSubcommandGroup();

    if (!subcommandGroup && subcommand === "show") {
      await handleShow(interaction, guild, guildId);
      return;
    }

    if (
      subcommandGroup === "remove" &&
      subcommand === "cooldown-instance-type"
    ) {
      await handleRemoveCooldownInstanceType(interaction, guildId);
      return;
    }

    if (subcommandGroup === "clear") {
      await handleClear(interaction, guildId, subcommand);
      return;
    }

    const value = interaction.options.getString(
      getSetValueOptionName(subcommand),
      true,
    );

    if (
      subcommand === "cooldown-instance-types" ||
      subcommand === "multiplier-instance-types"
    ) {
      await handleSetCooldownOrMultiplier(
        interaction,
        guildId,
        subcommand,
        value,
      );
      return;
    }

    if (subcommand === "role-restricted-channels") {
      await handleSetRoleRestrictedChannels(interaction, guild, guildId, value);
      return;
    }

    const previousScheduleTextChannelIds =
      DISCORD_SETTINGS.guildScheduleSourceByGuild[guildId]
        ?.scheduleTextChannelIds ?? [];
    await handleSetChannelList(
      interaction,
      guild,
      guildId,
      subcommand,
      value,
      previousScheduleTextChannelIds,
    );
  },
};
