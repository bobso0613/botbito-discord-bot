import {
  ApplicationIntegrationType,
  ChannelType,
  InteractionContextType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  DISCORD_SETTINGS,
  PAYOUT_GUILD_IDS,
} from "../config/discord-settings.js";
import { getSignupSheet } from "../services/signup-sheet.service.js";
import { sendExport } from "../services/signup-export-forum.service.js";
import { ORGANIZER_EXPORT_ERROR } from "../constants/signup.js";
import type { Command } from "../types/command.js";
import type { SignupSheet } from "../types/signup-sheet.js";
import type { SignupExportPart as ExportPart } from "../types/signup-export.js";
import { buildExportContents } from "../templates/signup-export.template.js";
import {
  buildExportIdentifier,
  canExportSheet,
  ExportValidationError,
  getExportInstanceTypes,
  getExportRunKey,
  parseExportAbsentSlots as parseAbsentSlots,
} from "../utils/signup-export.js";

/** Validates `/export` options and builds the forum posts, or returns a user-facing error. */
const prepareParts = (
  interaction: ChatInputCommandInteraction,
  sheet: SignupSheet,
): { parts: ExportPart[]; split: boolean } | string => {
  const vendor = interaction.options.getString("vendor")?.trim();
  if (!vendor) return "Enter the vendor name, or `none`.";
  const secondVendor =
    interaction.options.getString("second-vendor-name")?.trim() || vendor;
  const filled = sheet.slots.filter((slot) => slot.signupUserId && !slot.isTbc);
  if (!filled.length) {
    return "There are no filled, non-TBC signup slots to export.";
  }
  const types = getExportInstanceTypes(sheet);
  const split =
    Boolean(interaction.options.getBoolean("split")) && types.length > 1;
  let absentByRun: Set<number>[];
  try {
    absentByRun = [
      parseAbsentSlots(
        interaction.options.getString("first-run-absent-slots"),
        sheet,
        "first",
      ),
      parseAbsentSlots(
        interaction.options.getString("second-run-absent-slots"),
        sheet,
        "second",
      ),
    ];
  } catch (error) {
    if (error instanceof ExportValidationError) return error.message;
    throw error;
  }
  const parts: ExportPart[] = (split ? types : [undefined]).map(
    (type, index) => {
      const partSheet = type ? { ...sheet, instanceType: [type.name] } : sheet;
      const excluded = split
        ? [absentByRun[index] ?? new Set<number>()]
        : absentByRun;
      const slots = filled.filter(
        (slot) => !excluded.some((absent) => absent.has(slot.number)),
      );
      const identifier = buildExportIdentifier(sheet, type?.name);
      const partVendor = split && index > 0 ? secondVendor : vendor;
      return {
        runKey: getExportRunKey(sheet, type?.name),
        identifier,
        sheet: partSheet,
        slots,
        vendor: partVendor,
        initials: type?.initials,
        contents: buildExportContents(partSheet, slots, identifier, partVendor),
      };
    },
  );
  if (parts.some((part) => !part.slots.length)) {
    return "There are no signup slots left to export after removing the absent slots.";
  }
  if (parts.some((part) => !part.contents)) {
    return "The export exceeds Discord's message limit. Shorten roles, character notes, or instance-type names before exporting.";
  }
  return { parts, split };
};

/**
 * Handles the organizer-only slash command and reports each combined or split result publicly.
 * @param interaction Export invocation with vendor, split, and optional absent-slot values.
 * @returns Resolves after validation and the public success, duplicate, or failure reply.
 */
export const executeExport = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  await interaction.deferReply();
  const { guildId, channelId, guild } = interaction;
  if (!guildId || !guild || !PAYOUT_GUILD_IDS.includes(guildId)) {
    await interaction.editReply(
      "Export is only available in payout-enabled servers.",
    );
    return;
  }
  const sheet = await getSignupSheet(guildId, channelId);
  if (!sheet) {
    await interaction.editReply(
      "There is no signup sheet in this channel. Use `/newrun` first.",
    );
    return;
  }
  if (!canExportSheet(sheet, interaction.user.id)) {
    await interaction.editReply(ORGANIZER_EXPORT_ERROR);
    return;
  }
  const payoutChannelId =
    DISCORD_SETTINGS.payoutSheetChannelIdByGuild?.[guildId];
  if (!payoutChannelId) {
    await interaction.editReply(
      "Ask an administrator to configure `/guildsetting set payout-channel-id` first.",
    );
    return;
  }
  if (sheet.timestamp === null) {
    await interaction.editReply(
      "Set the run date with `/sdt` before exporting.",
    );
    return;
  }
  const prepared = prepareParts(interaction, sheet);
  if (typeof prepared === "string") {
    await interaction.editReply(prepared);
    return;
  }
  const { parts, split } = prepared;
  try {
    const channel = await guild.channels.fetch(payoutChannelId);
    if (channel?.type !== ChannelType.GuildForum) {
      await interaction.editReply(
        "The configured payout channel must be a forum channel. Ask an administrator to update it.",
      );
      return;
    }
    const notices = await parts.reduce<Promise<string[]>>(
      async (previous, part) => {
        const done = await previous;
        let notice: string;
        try {
          notice = await sendExport(interaction.user.id, channel, sheet, part);
        } catch {
          notice =
            "Could not create the payout forum post. Check the bot's channel permissions and any required forum tags.";
        }
        return [
          ...done,
          part.initials && split ? `(${part.initials}) ${notice}` : notice,
        ];
      },
      Promise.resolve([]),
    );
    if (interaction.options.getBoolean("split") && !split) {
      notices.push(
        "Split was not applied because this signup has fewer than two instance types.",
      );
    }
    await interaction.editReply(notices.join("\n"));
  } catch {
    await interaction.editReply(
      "Could not create the payout forum post. Check the bot's channel permissions and any required forum tags.",
    );
  }
};

/** Organizer-only slash command registered in payout-enabled guilds. */
export const exportCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("export")
    .setDescription(
      "Export filled signup slots to the payout forum (organizer only)",
    )
    .addStringOption((option) =>
      option
        .setName("vendor")
        .setDescription("Vendor name(s), or none")
        .setMaxLength(100)
        .setRequired(true),
    )
    .addBooleanOption((option) =>
      option
        .setName("split")
        .setDescription("Create one post per instance type"),
    )
    .addStringOption((option) =>
      option
        .setName("second-vendor-name")
        .setDescription(
          "Vendor name(s) for the second split run; defaults to vendor",
        )
        .setMaxLength(100),
    )
    .addStringOption((option) =>
      option
        .setName("first-run-absent-slots")
        .setDescription(
          "Comma-separated slot numbers absent from the first run only",
        ),
    )
    .addStringOption((option) =>
      option
        .setName("second-run-absent-slots")
        .setDescription(
          "Comma-separated slot numbers absent from the second run only",
        ),
    )
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild) as SlashCommandBuilder,
  guildIds: PAYOUT_GUILD_IDS,
  execute: executeExport,
};
