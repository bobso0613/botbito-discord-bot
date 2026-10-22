import { createHash } from "node:crypto";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import {
  COOLDOWN_INSTANCE_TYPES,
  type InstanceType,
} from "../constants/cooldowns.js";
import type { SignupSheet } from "../types/signup-sheet.js";
import { getGmtOffset } from "./signup-sheet.js";

/** Identifies expected validation failures that should be shown to the exporter. */
export class ExportValidationError extends Error {}

/**
 * Parses comma-separated absent slot numbers without changing the signup sheet.
 * @param input Optional slot list; empty entries are ignored and duplicates collapse.
 * @param sheet Signup whose original slot numbers are allowed.
 * @param run First/second run label used in validation errors.
 * @returns Unique absent slot numbers.
 * @throws ExportValidationError if any value is not a slot on the sheet.
 */
export const parseExportAbsentSlots = (
  input: string | null,
  sheet: SignupSheet,
  run: string,
): Set<number> => {
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

/** Resolves the run's calendar date using server, schedule, then GMT timezone. */
export const getExportDate = (sheet: SignupSheet): Date => {
  const timezone = sheet.serverTimezone ?? sheet.scheduleTimezone ?? "GMT";
  return new Date((sheet.timestamp! + getGmtOffset(timezone) * 3600) * 1000);
};

/** Resolves selected instance names to guild-specific emojis, retaining unknown names. */
export const getExportInstanceTypes = (
  sheet: SignupSheet,
): Array<Pick<InstanceType, "name" | "emoji"> & { initials: string }> => {
  const names = Array.isArray(sheet.instanceType)
    ? sheet.instanceType
    : [sheet.instanceType];
  const instanceTypes =
    DISCORD_SETTINGS.cooldownInstanceTypesByGuild?.[sheet.guildId] ??
    COOLDOWN_INSTANCE_TYPES;
  return [
    ...new Set(names.filter((name): name is string => Boolean(name))),
  ].map((name) => {
    const type = instanceTypes.find((candidate) => candidate.name === name);
    const fallback =
      type?.keywords[0]?.trim() ||
      name
        .split(/\s+/)
        .map((word) => word[0])
        .join("")
        .toUpperCase();
    return {
      name,
      emoji: type?.emoji ?? "",
      initials: type?.initials?.trim() || fallback,
    };
  });
};

/** Builds the stable full-title/full-date key used for one-export-per-run validation. */
export const getExportRunKey = (
  sheet: SignupSheet,
  instanceName?: string,
): string =>
  JSON.stringify([
    sheet.title.trim().replace(/\s+/g, " ").toLowerCase(),
    getExportDate(sheet).toISOString().slice(0, 10),
    ...(instanceName ? [instanceName] : []),
  ]);

/** Rebuilds a footer from its persisted identity, independently of current signup selections. */
export const buildExportIdentifierFromRunKey = (
  guildId: string,
  runKey: string,
): string => {
  const hash = createHash("sha256")
    .update(JSON.stringify([guildId, runKey]))
    .digest("hex");
  return `-# Export ID: botbito-export:v1:${hash}`;
};

/** Creates a guild-scoped footer marker recoverable from existing forum starter messages. */
export const buildExportIdentifier = (
  sheet: SignupSheet,
  instanceName?: string,
): string =>
  buildExportIdentifierFromRunKey(
    sheet.guildId,
    getExportRunKey(sheet, instanceName),
  );

/** Authorizes the stored organizer only when its Discord avatar identity is consistent. */
export const canExportSheet = (sheet: SignupSheet, userId: string): boolean => {
  if (!sheet.organizerId || sheet.organizerId !== userId) return false;
  try {
    const avatar = new URL(sheet.organizerAvatarUrl);
    if (
      avatar.hostname !== "cdn.discordapp.com" &&
      avatar.hostname !== "media.discordapp.net"
    ) {
      return true;
    }
    const avatarUserId = /^\/avatars\/(\d+)\//.exec(avatar.pathname)?.[1];
    return !avatarUserId || avatarUserId === sheet.organizerId;
  } catch {
    return true;
  }
};
