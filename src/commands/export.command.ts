import {
  ApplicationIntegrationType,
  ChannelType,
  escapeMarkdown,
  InteractionContextType,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ForumChannel,
} from "discord.js";
import {
  DISCORD_SETTINGS,
  PAYOUT_GUILD_IDS,
} from "../config/discord-settings.js";
import { getSignupSheet } from "../services/signup-sheet.service.js";
import { exportSignupRun } from "../services/signup-export.service.js";
import { findExistingExport } from "../services/signup-export-forum.service.js";
import type { Command } from "../types/command.js";
import type { SignupSheet, SignupSlot } from "../types/signup-sheet.js";
import {
  buildExportContents,
  buildExportTitle,
} from "../templates/signup-export.template.js";
import {
  buildExportIdentifier,
  canExportSheet,
  ExportValidationError,
  getExportInstanceTypes,
  getExportRunKey,
} from "../utils/signup-export.js";

/** One forum post: the whole run, or one instance type when split. */
interface ExportPart {
  runKey: string;
  identifier: string;
  sheet: SignupSheet;
  slots: SignupSlot[];
  contents: string[] | null;
  vendor: string;
  initials?: string;
}

/** Parses comma-separated slot numbers, rejecting values that are not slots of the sheet. */
const parseAbsentSlots = (
  input: string | null,
  sheet: SignupSheet,
  run: string,
) => {
  const absent = new Set<number>();
  for (const raw of (input ?? "").split(",")) {
    const value = raw.trim();
    if (!value) continue;
    const number = Number(value);
    if (
      !/^\d+$/.test(value) ||
      !sheet.slots.some((slot) => slot.number === number)
    ) {
      throw new ExportValidationError(
        `Invalid ${run} run absent slot "${value}". Use comma-separated slot numbers from the signup, e.g. \`3, 7\`.`,
      );
    }
    absent.add(number);
  }
  return absent;
};

const ORGANIZER_EXPORT_ERROR =
  "Only the run organizer can export this signup sheet. If the organizer details are missing or inconsistent, use `/swaporganizer` to set the correct organizer first.";

/** Rechecks organizer ownership and run identity immediately before forum creation. */
const validateCurrentExport = async (
  sheet: SignupSheet,
  userId: string,
): Promise<void> => {
  const current = await getSignupSheet(sheet.guildId, sheet.channelId);
  if (!current || !canExportSheet(current, userId)) {
    throw new ExportValidationError(ORGANIZER_EXPORT_ERROR);
  }
  if (
    current.timestamp === null ||
    getExportRunKey(current) !== getExportRunKey(sheet)
  ) {
    throw new ExportValidationError(
      "The run title or date changed while exporting. Please run `/export` again.",
    );
  }
};

/** Creates or locates one payout post and returns a public notice for success, duplicates, or partial delivery. */
const sendExport = async (
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  channel: ForumChannel,
  sheet: SignupSheet,
  part: ExportPart,
): Promise<string> => {
  const { slots, runKey, identifier } = part;
  const contents = part.contents!;
  const recipientIds = [...new Set(slots.map((slot) => slot.signupUserId!))];
  const messageOptions = (content: string) => ({
    content,
    allowedMentions: {
      parse: [] as [],
      users: recipientIds.filter((id) => content.includes(`<@${id}>`)),
    },
  });
  let remainingFailed = false;
  let createdThreadId: string | null = null;
  let result;
  try {
    result = await exportSignupRun(
      sheet.guildId,
      runKey,
      async () => {
        await validateCurrentExport(sheet, interaction.user.id);
        const thread = await channel.threads.create({
          name: buildExportTitle(part.sheet, part.initials),
          message: messageOptions(contents[0]!),
        });
        createdThreadId = thread.id;
        try {
          await contents.slice(1).reduce(async (previous, content) => {
            await previous;
            await thread.send(messageOptions(content));
          }, Promise.resolve());
        } catch {
          remainingFailed = true;
        }
        return thread.id;
      },
      () => findExistingExport(channel, identifier),
      contents,
    );
  } catch (error) {
    if (error instanceof ExportValidationError) return error.message;
    if (!createdThreadId) throw error;
    return `Created <#${createdThreadId}>, but could not save the export confirmation. Export is blocked to prevent a duplicate; ask an administrator to check the export history.`;
  }
  if (!result.created) {
    return result.threadId
      ? `This run has already been exported for this date: <#${result.threadId}>.`
      : "An export for this run and date is already pending. Ask an administrator to check the export history if it remains blocked.";
  }
  return remainingFailed
    ? `Created <#${result.threadId}>, but could not send the remaining roster. Check the bot's permissions and complete the roster in that post; exporting again is blocked to prevent duplicates.`
    : `Exported the signup roster to <#${result.threadId}>. Vendor - **${escapeMarkdown(part.vendor.replace(/[\r\n]/g, " "))}**`;
};

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

/** Handles both export entry points with payout-guild, organizer, roster, and forum validation. */
export const executeExport = async (
  interaction: ChatInputCommandInteraction | ButtonInteraction,
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
  if (!interaction.isChatInputCommand()) {
    await interaction.editReply(
      "Use `/export` and enter the vendor to export this signup sheet.",
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
        const notice = await sendExport(interaction, channel, sheet, part);
        return [
          ...done,
          part.initials && split ? `(${part.initials}) ${notice}` : notice,
        ];
      },
      Promise.resolve([]),
    );
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
