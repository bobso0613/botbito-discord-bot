import type { Message } from "discord.js";
import type { SignupSheet, SignupSlot } from "../types/signup-sheet.js";

/**
 * Parses a server timezone string such as `GMT`, `GMT+8`, or `GMT-5`.
 * Returns `null` for a blank value (no timezone), the normalized string for a
 * valid timezone, or `undefined` when the value is present but invalid.
 */
export const parseServerTimezone = (
  value: string,
): string | null | undefined => {
  const timezone = value.trim().toUpperCase();
  if (!timezone) return null;
  if (timezone === "GMT") return "GMT";
  const match = /^GMT([+-])(\d{1,2})$/.exec(timezone);
  if (!match) return undefined;
  const offset = Number(match[2]) * (match[1] === "+" ? 1 : -1);
  if (offset < -12 || offset > 14) return undefined;
  return `GMT${offset >= 0 ? "+" : ""}${offset}`;
};

/** Returns the hour offset from GMT for a normalized timezone string (e.g. `GMT+8`). */
export const getGmtOffset = (timezone: string): number =>
  timezone === "GMT" ? 0 : Number(timezone.slice(3));

/**
 * Parses a `DD/MM HH:MM GMT+#` run date/time into a Unix timestamp and its
 * originating timezone. Rolls over to next year when the parsed date/time has
 * already passed. Returns `null` for an invalid or malformed value.
 */
export const parseNewRunTimestamp = (
  value: string,
): { timestamp: number; scheduleTimezone: string } | null => {
  const match =
    /^(\d{2})\/(\d{2})\s+([01]\d|2[0-3]):([0-5]\d)\s+(GMT(?:[+-]\d{1,2})?)$/i.exec(
      value.trim(),
    );
  const scheduleTimezone = match ? parseServerTimezone(match[5]) : undefined;
  if (!match || !scheduleTimezone) return null;
  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const hour = Number(match[3]);
  const minute = Number(match[4]);
  const offset = getGmtOffset(scheduleTimezone);
  const now = new Date(Date.now() + offset * 3600 * 1000);
  let year = now.getUTCFullYear();
  const timestampForYear = (candidateYear: number): number =>
    Math.floor(
      (Date.UTC(candidateYear, month, day, hour, minute) -
        offset * 3600 * 1000) /
        1000,
    );
  let timestamp = timestampForYear(year);
  const intendedDate = new Date(Date.UTC(year, month, day));
  if (intendedDate.getUTCMonth() !== month || intendedDate.getUTCDate() !== day)
    return null;
  if (timestamp * 1000 < Date.now()) {
    year += 1;
    timestamp = timestampForYear(year);
  }
  return { timestamp, scheduleTimezone };
};

/** Formats a Unix timestamp back into the `DD/MM HH:MM GMT+#` input format, or `""` when unset. */
export const formatNewRunDate = (
  timestamp: number | null,
  timezone: string,
): string => {
  if (timestamp === null) return "";
  const date = new Date((timestamp + getGmtOffset(timezone) * 3600) * 1000);
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(
    date.getUTCMonth() + 1,
  ).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes(),
  ).padStart(2, "0")} ${timezone}`;
};

/** Builds the empty slot list for a set of party sizes, numbered continuously across parties. */
export const createEmptySlots = (partySizes: number[]): SignupSlot[] =>
  Array.from(
    { length: partySizes.reduce((total, size) => total + size, 0) },
    (_, index) => ({
      number: index + 1,
      role: "role",
      signupUserId: null,
      signupDisplayName: null,
      charNote: null,
    }),
  );

/** Renders slots as editable `NN: Role - Name (note)` roster text for the roster-edit prompt. */
export const getDefaultRoster = (slots: SignupSlot[]): string =>
  slots
    .map(
      (slot) =>
        `${String(slot.number).padStart(2, "0")}: ${slot.role} -${
          slot.signupDisplayName
            ? ` ${slot.signupDisplayName}${
                slot.charNote ? ` (${slot.charNote})` : ""
              }`
            : ""
        }`,
    )
    .join("\n");

/** Builds the prompt message shown when asking the user to send their edited roster text. */
export const getRosterPrompt = (slots: SignupSlot[]): string =>
  `Send your completed roster as your next message in this channel. You can use Discord's emoji picker.\nYou don't need to add reserve slots here; those are set up automatically using \`/add input=reserve\`.\n\n\`\`\`\n${getDefaultRoster(slots)}\n\`\`\``;

/** Strips optional bold markdown from a roster display name, returning `null` for blank input. */
export const normalizeRosterDisplayName = (
  value: string | null,
): string | null => {
  if (!value) return null;
  const normalized = value
    .trim()
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .trim();
  return normalized || null;
};

/**
 * Parses roster text back into slots. The role/name separator is a dash
 * preceded by a space (" -"), so mid-word dashes in the role (e.g. "Ka-Buff")
 * or name (e.g. "char-name") don't split early. Returns `null` when the text
 * doesn't have one continuous, correctly numbered line per existing slot.
 */
export const parseRoster = (
  roster: string,
  existingSlots: SignupSlot[],
): SignupSlot[] | null => {
  const rosterLines = roster.split("\n").filter(Boolean);
  if (rosterLines.length !== existingSlots.length) return null;
  const userIdsByDisplayName = new Map<string, string | null>();
  for (const slot of existingSlots) {
    const displayName = normalizeRosterDisplayName(slot.signupDisplayName);
    if (!displayName || !slot.signupUserId) continue;
    const existingUserId = userIdsByDisplayName.get(displayName);
    userIdsByDisplayName.set(
      displayName,
      existingUserId === undefined || existingUserId === slot.signupUserId
        ? slot.signupUserId
        : null,
    );
  }
  const slots: SignupSlot[] = [];
  for (const [index, line] of rosterLines.entries()) {
    const match = /^(\d+)\s*:\s*(.+?)(?:\s-(?:\s(.*))?)?$/.exec(line.trim());
    if (!match || Number(match[1]) !== index + 1 || !match[2]?.trim())
      return null;
    const signupValue = match[3]?.trim() || null;
    const signupMatch = signupValue
      ? /^(.*?)(?:\s+\((.*)\))?$/.exec(signupValue)
      : null;
    const signupDisplayName =
      normalizeRosterDisplayName(signupMatch?.[1] ?? null) ?? null;
    const existingSlot = existingSlots[index];
    const existingSlotName = normalizeRosterDisplayName(
      existingSlot?.signupDisplayName ?? null,
    );
    slots.push({
      number: index + 1,
      role: match[2].trim(),
      signupUserId:
        existingSlotName === signupDisplayName
          ? existingSlot.signupUserId
          : (userIdsByDisplayName.get(signupDisplayName ?? "") ?? null),
      signupDisplayName,
      charNote: signupMatch?.[2]?.trim() || null,
    });
  }
  return slots;
};

/**
 * Resolves unmatched roster display names to guild member Discord IDs by
 * searching the message's guild. Leaves a slot's `signupUserId` as `null`
 * when a name matches zero or more than one member.
 */
export const resolveRosterSignupUserIds = async (
  slots: SignupSlot[],
  message: Message,
): Promise<void> => {
  if (!message.guild) return;
  const unresolvedNames = [
    ...new Set(
      slots.flatMap((slot) =>
        slot.signupUserId || !slot.signupDisplayName
          ? []
          : [slot.signupDisplayName],
      ),
    ),
  ];
  const resolvedIds = new Map<string, string | null>();
  await Promise.all(
    unresolvedNames.map(async (name) => {
      const members = await message.guild!.members.fetch({
        query: name,
        limit: 10,
      });
      const matches = members.filter((member) =>
        [
          member.displayName,
          member.user.displayName,
          member.user.globalName,
          member.user.username,
        ]
          .filter((value): value is string => Boolean(value))
          .some((value) => normalizeRosterDisplayName(value) === name),
      );
      resolvedIds.set(name, matches.size === 1 ? matches.first()!.id : null);
    }),
  );
  for (const slot of slots) {
    if (!slot.signupUserId && slot.signupDisplayName)
      slot.signupUserId = resolvedIds.get(slot.signupDisplayName) ?? null;
  }
};

/** Finds the slot a given user is currently signed up in, if any. */
export const getInvokingUserSlot = (
  sheet: SignupSheet,
  userId: string,
): SignupSlot | undefined =>
  sheet.slots.find((slot) => slot.signupUserId === userId);

/** Formats a slot as a `NN: Role` label for confirmation and notice messages. */
export const formatSlotLabel = (
  slot: Pick<SignupSlot, "number" | "role">,
): string => `${String(slot.number).padStart(2, "0")}: ${slot.role}`;

/** Picks a random open (unsigned) slot from the sheet, or `null` when none are open. */
export const pickRandomOpenSlot = (sheet: SignupSheet): SignupSlot | null => {
  const openSlots = sheet.slots.filter((slot) => !slot.signupUserId);
  if (!openSlots.length) return null;
  return openSlots[Math.floor(Math.random() * openSlots.length)]!;
};

export interface ActionNoticeEntry {
  userId: string;
  label: string;
}

export interface ActionNotice {
  userId: string;
  labels: string[];
}

/** Groups per-slot notice entries by user so each affected user gets one combined notice. */
export const mergeActionNotices = (
  entries: ActionNoticeEntry[],
): ActionNotice[] => {
  const labelsByUserId = new Map<string, string[]>();
  for (const entry of entries)
    labelsByUserId.set(entry.userId, [
      ...(labelsByUserId.get(entry.userId) ?? []),
      entry.label,
    ]);
  return [...labelsByUserId.entries()].map(([userId, labels]) => ({
    userId,
    labels,
  }));
};

const timeDelta = (amount: number, unit: string): number | null => {
  const multiplier: Record<string, number> = {
    minute: 60,
    hour: 3600,
    day: 86400,
    week: 604800,
    month: 2592000,
  };
  return multiplier[unit] ? amount * multiplier[unit] : null;
};

/**
 * Parses a relative time shift such as `next week`, `last hour`, or `1.5 days`
 * into a signed number of seconds. Returns `null` for an invalid value.
 */
export const parseTimeShift = (value: string): number | null => {
  const match =
    /^(next|last|-?(?:\d+(?:\.[05])?|\.5))\s+(minutes?|mins?|hours?|days?|weeks?|months?)$/i.exec(
      value.trim(),
    );
  if (!match) return null;
  const amount =
    match[1].toLowerCase() === "next"
      ? 1
      : match[1].toLowerCase() === "last"
        ? -1
        : Number(match[1]);
  if (!Number.isFinite(amount) || Math.round(amount * 2) !== amount * 2)
    return null;
  const normalizedUnit = match[2].toLowerCase().replace(/s$/, "");
  return timeDelta(
    amount,
    normalizedUnit === "min" ? "minute" : normalizedUnit,
  );
};
