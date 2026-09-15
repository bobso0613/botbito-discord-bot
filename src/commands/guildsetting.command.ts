import {
  ApplicationIntegrationType,
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Collection,
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

/** Resolves a channel mention, channel link, or #channel name to an ID of the expected type. */
const resolveChannel = (
  channels: Collection<string, NonThreadGuildBasedChannel | null>,
  value: string,
  type: ChannelType.GuildCategory | ChannelType.GuildText,
): string | undefined => {
  const id =
    value.match(/^<#(\d+)>$/)?.[1] ??
    value.match(/discord\.com\/channels\/\d+\/(\d+)/)?.[1];
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
  const id = value.match(/^<@&(\d+)>$/)?.[1];
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

/** Builds the ephemeral summary shown by `/guildsetting show`. */
const buildGuildSettingsSummary = (guildId: string): string => {
  const source = DISCORD_SETTINGS.guildScheduleSourceByGuild[guildId];
  const cooldownTypes =
    DISCORD_SETTINGS.cooldownInstanceTypesByGuild[guildId] ?? [];
  const multiplierTypes =
    DISCORD_SETTINGS.multiplierInstanceTypesByGuild[guildId] ?? [];
  const roleRestrictedEntries = Object.entries(
    source?.roleRestrictedChannels ?? {},
  );

  return [
    `**Tracked categories:** ${
      source?.categoryIds.length
        ? source.categoryIds.map((id) => `<#${id}>`).join(", ")
        : "none"
    }`,
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

    const subcommand = interaction.options.getSubcommand();
    const subcommandGroup = interaction.options.getSubcommandGroup();

    if (!subcommandGroup && subcommand === "show") {
      await interaction.reply({
        content: buildGuildSettingsSummary(interaction.guildId),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (
      subcommandGroup === "remove" &&
      subcommand === "cooldown-instance-type"
    ) {
      const name = interaction.options.getString("name", true);
      const existingTypes =
        DISCORD_SETTINGS.cooldownInstanceTypesByGuild[interaction.guildId] ??
        [];
      if (!existingTypes.some((type) => type.name === name)) {
        await interaction.reply({
          content: `No instance type named "${name}" exists.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await updateGuildCooldownSettings(interaction.guildId, (settings) => {
        settings.cooldownInstanceTypes = existingTypes.filter(
          (type) => type.name !== name,
        );
        settings.multiplierInstanceTypes =
          settings.multiplierInstanceTypes.filter(
            (multiplierName) => multiplierName !== name,
          );
      });
      await interaction.reply({
        content: `Removed cooldown instance type "${name}".`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const previousScheduleTextChannelIds =
      DISCORD_SETTINGS.guildScheduleSourceByGuild[interaction.guildId]
        ?.scheduleTextChannelIds ?? [];
    let updatedSource: GuildSettings["guildScheduleSource"] | undefined;
    if (subcommandGroup === "clear") {
      if (subcommand === "cooldown-instance-types") {
        await updateGuildCooldownSettings(interaction.guildId, (settings) => {
          settings.cooldownInstanceTypes = [];
        });
      } else if (subcommand === "multiplier-instance-types") {
        await updateGuildCooldownSettings(interaction.guildId, (settings) => {
          settings.multiplierInstanceTypes = [];
        });
      } else
        await updateGuildScheduleSource(interaction.guildId, (source) => {
          if (subcommand === "tracked-category") source.categoryIds = [];
          else if (subcommand === "excluded-channels")
            source.excludedChannelIds = [];
          else if (subcommand === "schedule-channels")
            source.scheduleTextChannelIds = [];
          else source.roleRestrictedChannels = {};
        });
      await interaction.reply({
        content:
          subcommand === "cooldown-instance-types" ||
          subcommand === "multiplier-instance-types"
            ? "Guild cooldown setting cleared."
            : "Guild schedule setting cleared.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const value = interaction.options.getString(
      subcommand === "cooldown-instance-types"
        ? "name"
        : subcommand === "tracked-category"
          ? "categories"
          : subcommand === "role-restricted-channels"
            ? "mappings"
            : subcommand === "multiplier-instance-types"
              ? "types"
              : "channels",
      true,
    );

    if (
      subcommand === "cooldown-instance-types" ||
      subcommand === "multiplier-instance-types"
    ) {
      try {
        if (subcommand === "cooldown-instance-types") {
          const type = parseInstanceType(
            interaction.options.getString("name", true),
            interaction.options.getString("keywords", true),
            interaction.options.getString("maxattempts", true),
            interaction.options.getString("emoji", true),
          );
          const existingTypes =
            DISCORD_SETTINGS.cooldownInstanceTypesByGuild[
              interaction.guildId
            ] ?? [];
          const types = existingTypes.some(({ name }) => name === type.name)
            ? existingTypes.map((existing) =>
                existing.name === type.name ? type : existing,
              )
            : [...existingTypes, type];
          await updateGuildCooldownSettings(interaction.guildId, (settings) => {
            settings.cooldownInstanceTypes = types;
          });
        } else {
          const types = splitValues(value);
          const configuredNames = new Set(
            DISCORD_SETTINGS.cooldownInstanceTypesByGuild[
              interaction.guildId
            ]?.map(({ name }) => name) ?? [],
          );
          if (types.some((type) => !configuredNames.has(type))) {
            throw new Error(
              "Every multiplier type must be a configured instance type.",
            );
          }
          await updateGuildCooldownSettings(interaction.guildId, (settings) => {
            settings.multiplierInstanceTypes = types;
          });
        }
      } catch (error) {
        await interaction.reply({
          content:
            error instanceof Error
              ? error.message
              : "Invalid cooldown setting.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        content: "Guild cooldown setting updated.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === "role-restricted-channels") {
      const [channels, roles] = await Promise.all([
        interaction.guild.channels.fetch(),
        interaction.guild.roles.fetch(),
      ]);
      const mappings: Record<string, string> = {};
      const invalid: string[] = [];
      for (const entry of splitValues(value)) {
        const [channelValue, roleValue, ...extra] =
          entry.split(/\s*(?:=|:|->)\s*/);
        const channelId = channelValue
          ? resolveChannel(channels, channelValue, ChannelType.GuildText)
          : undefined;
        const roleId = roleValue ? resolveRole(roles, roleValue) : undefined;
        if (extra.length || !channelId || !roleId) invalid.push(entry);
        else mappings[channelId] = roleId;
      }
      if (invalid.length) {
        await interaction.reply({
          content: `Could not resolve: ${invalid.join(", ")}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await updateGuildScheduleSource(interaction.guildId, (source) => {
        source.roleRestrictedChannels = mappings;
      });
    } else {
      const type =
        subcommand === "tracked-category"
          ? ChannelType.GuildCategory
          : ChannelType.GuildText;
      const channels = await interaction.guild.channels.fetch();
      const { ids, invalid } = resolveChannels(channels, value, type);
      if (invalid.length) {
        await interaction.reply({
          content: `Could not resolve: ${invalid.join(", ")}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await updateGuildScheduleSource(interaction.guildId, (source) => {
        if (subcommand === "tracked-category") source.categoryIds = ids;
        else if (subcommand === "excluded-channels")
          source.excludedChannelIds = ids;
        else source.scheduleTextChannelIds = ids;
        updatedSource = source;
      });

      if (subcommand === "schedule-channels") {
        const source = updatedSource;
        if (!source) return;
        const addedChannelIds = source.scheduleTextChannelIds.filter(
          (channelId) => !previousScheduleTextChannelIds.includes(channelId),
        );
        if (addedChannelIds.length) {
          await publishGuildScheduleAnnouncement(
            interaction.guild,
            addedChannelIds,
            source.categoryIds,
            (source.excludedChannelIds ?? []).filter(
              (channelId) => !source.roleRestrictedChannels?.[channelId],
            ),
            source.roleRestrictedChannels,
            getInteractionContext(interaction),
          );
        }
      }
    }

    await interaction.reply({
      content: "Guild schedule setting updated.",
      flags: MessageFlags.Ephemeral,
    });
  },
};
