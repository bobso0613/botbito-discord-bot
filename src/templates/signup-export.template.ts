import { escapeMarkdown } from "discord.js";
import { MAX_DISCORD_MESSAGE_LENGTH } from "../constants/signup.js";
import type { SignupSheet, SignupSlot } from "../types/signup-sheet.js";
import {
  ExportValidationError,
  getExportDate,
  getExportInstanceTypes,
} from "../utils/signup-export.js";

/**
 * Builds a forum title of at most 100 characters, preserving DD/MM and Unicode instance emojis.
 * Custom Discord emoji markup is omitted because forum titles do not render it.
 * @param sheet Signup with a non-null timestamp and optional instance selections.
 * @param initials Optional split-instance label displayed before the run title.
 * @returns Sanitized, potentially truncated title using the run's configured calendar date.
 * @throws ExportValidationError when metadata leaves no room for the run title.
 */
export const buildExportTitle = (
  sheet: SignupSheet,
  initials?: string,
): string => {
  const date = getExportDate(sheet);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const suffix = ` - ${day}/${month}`;
  const prefix = initials
    ? `\u23f3(${initials.replace(/[\r\n]/g, " ")}) `
    : "\u23f3";
  const emojis = [
    ...new Set(
      getExportInstanceTypes(sheet)
        .map((type) => type.emoji.replace(/<a?:\w+:\d+>/g, "").trim())
        .filter(Boolean),
    ),
  ].join(" ");
  const instanceSuffix = emojis ? ` [${emojis}]` : "";
  const titleLimit =
    100 - prefix.length - suffix.length - instanceSuffix.length;
  if (titleLimit < 1) {
    throw new ExportValidationError(
      "The instance-type emojis exceed Discord's thread title limit. Select fewer types or shorter emojis.",
    );
  }
  const title = sheet.title.replace(/[\r\n]/g, " ").slice(0, titleLimit);
  return `${prefix}${title}${suffix}${instanceSuffix}`;
};

/** Formats a confirmed slot with its consecutive export position and actual member mention. */
const formatExportSlot = (slot: SignupSlot, position: number): string => {
  const character = escapeMarkdown(
    slot.charNote?.replace(/[\r\n]/g, " ") ?? "",
  );
  const note = character ? ` (${character})` : "";
  const number = String(position).padStart(2, "0");
  return `${number}: ${slot.role} - <@${slot.signupUserId}>${note}`;
};

/** Groups selected slots under their original party headings without changing the sheet. */
const buildExportRosterLines = (
  sheet: SignupSheet,
  slots: readonly SignupSlot[],
): string[] => {
  const selected = new Set(slots.map((slot) => slot.number));
  let offset = 0;
  let position = 0;
  return sheet.partySizes.flatMap((size, index) => {
    const partySlots = sheet.slots
      .slice(offset, offset + size)
      .filter((slot) => selected.has(slot.number));
    offset += size;
    const lines = partySlots.map((slot) => {
      position += 1;
      return formatExportSlot(slot, position);
    });
    return partySlots.length ? [`**Party ${index + 1}:**`, ...lines] : [];
  });
};

/**
 * Builds 2,000-character roster messages with consecutive numbering and original party headings.
 * Metadata and the final identifier stay in the starter message for duplicate recovery.
 * @param sheet Original or per-instance signup with a scheduled timestamp.
 * @param slots Confirmed, non-TBC slots after absent-slot exclusions.
 * @param identifier Stable footer identifying this run's combined or split coverage.
 * @param vendor Optional vendor names; custom emojis remain available in message metadata.
 * @returns Roster messages, or null when a single roster line or metadata cannot fit.
 */
export const buildExportContents = (
  sheet: SignupSheet,
  slots: readonly SignupSlot[],
  identifier: string,
  vendor?: string,
): string[] | null => {
  const people = new Set(slots.map((slot) => slot.signupUserId)).size;
  const instanceTypes = getExportInstanceTypes(sheet).map((type) => {
    const name = escapeMarkdown(type.name.replace(/[\r\n]/g, " "));
    return `${type.emoji} **${name}**`.trim();
  });
  const instanceDetails = instanceTypes.length
    ? `Instance Types: ${instanceTypes.join(", ")}`
    : null;
  const schedule = `*Your Time: <t:${sheet.timestamp}:F>* (*<t:${sheet.timestamp}:R>*)`;
  const vendorDetails = vendor
    ? `Vendor: **${escapeMarkdown(vendor.replace(/[\r\n]/g, " "))}**`
    : null;
  const footer = [
    `Participants: **${people}**\n`,
    vendorDetails,
    instanceDetails,
    schedule,
    identifier,
  ]
    .filter(Boolean)
    .join("\n");
  if (footer.length > MAX_DISCORD_MESSAGE_LENGTH) return null;
  const contents: string[] = [""];
  for (const line of buildExportRosterLines(sheet, slots)) {
    if (line.length > MAX_DISCORD_MESSAGE_LENGTH) return null;
    const previous = contents.at(-1)!;
    const limit =
      MAX_DISCORD_MESSAGE_LENGTH -
      (contents.length === 1 ? footer.length + 2 : 0);
    const candidate = previous ? `${previous}\n${line}` : line;
    if (candidate.length <= limit) {
      contents[contents.length - 1] = candidate;
    } else {
      contents.push(line);
    }
  }
  contents[0] = contents[0] ? `${contents[0]}\n\n${footer}` : footer;
  return contents;
};
