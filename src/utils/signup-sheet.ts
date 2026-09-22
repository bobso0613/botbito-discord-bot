import { randomInt } from "node:crypto";
import type { Message, User } from "discord.js";
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
      isTbc: false,
    }),
  );

/** Renders slots as editable `NN: Role - Name (note) ❓` roster text. */
export const getDefaultRoster = (
  slots: SignupSlot[],
  partySizes?: number[],
): string => {
  const partyStartIndexes = new Set<number>();
  if (partySizes) {
    let startIndex = 0;
    for (const partySize of partySizes) {
      partyStartIndexes.add(startIndex);
      startIndex += partySize;
    }
  }

  let partyNumber = 0;
  return slots
    .map((slot, index) => {
      const partyHeader = partyStartIndexes.has(index)
        ? `Party ${++partyNumber}:\n`
        : "";
      const tbcSuffix = slot.isTbc ? " ❓" : "";
      const charNoteSuffix = slot.charNote ? ` (${slot.charNote})` : "";
      const signupContent = slot.signupDisplayName
        ? ` ${slot.signupDisplayName}${charNoteSuffix}${tbcSuffix}`
        : tbcSuffix;
      return `${partyHeader}${String(slot.number).padStart(2, "0")}: ${slot.role} -${signupContent}`;
    })
    .join("\n");
};

/** Builds the prompt message shown when asking the user to send their edited roster text. */
export const getRosterPrompt = (
  slots: SignupSlot[],
  partySizes: number[] = [slots.length],
): string =>
  `Send your completed roster as your next message in this channel. You can use Discord's emoji picker.\nTo change the number of parties, add or remove a \`Party #:\` header and move roster lines under the correct party.\nYou don't need to add reserve slots here; those are set up automatically using \`/add input=reserve\`.\n\n\`\`\`\n${getDefaultRoster(slots, partySizes)}\n\`\`\``;

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
 * or name (e.g. "char-name") don't split early. The `❓` emoji marks a slot as TBC.
 * Returns `null` when the text doesn't have one continuous, correctly numbered line per existing slot.
 */
const parseRosterLine = (
  line: string,
): { role: string; signupValue: string | null } | null => {
  const trimmed = line.trim();
  const separatorIndex = trimmed.indexOf(":");
  if (separatorIndex === -1) return null;

  const numberText = trimmed.slice(0, separatorIndex).trim();
  const remainder = trimmed.slice(separatorIndex + 1).trim();
  if (!numberText || !remainder) return null;

  const separatorIndexInRemainder = remainder.indexOf(" - ");
  const emptySignupSeparator = remainder.endsWith(" -")
    ? remainder.length - 2
    : -1;
  const dashIndex =
    separatorIndexInRemainder === -1
      ? emptySignupSeparator
      : separatorIndexInRemainder;
  const role =
    dashIndex === -1 ? remainder : remainder.slice(0, dashIndex).trim();
  const separatorLength = separatorIndexInRemainder === -1 ? 2 : 3;
  const signupValue =
    dashIndex === -1
      ? null
      : remainder.slice(dashIndex + separatorLength).trim() || null;

  if (!role) return null;
  return {
    role,
    signupValue,
  };
};

const buildRosterUserLookup = (
  existingSlots: SignupSlot[],
): Map<string, string | null> => {
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
  return userIdsByDisplayName;
};

const parseRosterSignupValue = (
  signupValue: string | null,
): { displayName: string | null; charNote: string | null; isTbc: boolean } => {
  let isTbc = false;
  let cleanedValue = signupValue;
  if (cleanedValue?.includes("❓")) {
    isTbc = true;
    cleanedValue = cleanedValue.replaceAll("❓", "").trim() || null;
  }
  const noteStart = cleanedValue?.lastIndexOf(" (");
  const hasNote =
    noteStart !== undefined && noteStart > 0 && cleanedValue?.endsWith(")");
  const displayName = normalizeRosterDisplayName(
    hasNote ? cleanedValue!.slice(0, noteStart) : cleanedValue,
  );
  const charNote = hasNote
    ? cleanedValue!.slice(noteStart + 2, -1).trim() || null
    : null;
  return { displayName, charNote, isTbc };
};

export interface ParsedRoster {
  slots: SignupSlot[];
  partySizes: number[] | null;
}

const parseRosterPartyHeader = (line: string): number | null => {
  const match = /^Party\s+(\d+)\s*:\s*$/i.exec(line.trim());
  return match ? Number(match[1]) : null;
};

const parseRosterSlot = (
  line: string,
  slotIndex: number,
  existingSlots: SignupSlot[],
  userIdsByDisplayName: Map<string, string | null>,
): SignupSlot | null => {
  const parsedLine = parseRosterLine(line);
  const lineNumberMatch = /^\d+/.exec(line.trimStart());
  const lineNumber = lineNumberMatch ? Number(lineNumberMatch[0]) : Number.NaN;
  if (!parsedLine || lineNumber !== slotIndex + 1) return null;

  const { role, signupValue } = parsedLine;
  const parsedSignup = parseRosterSignupValue(signupValue);
  const signupDisplayName = parsedSignup.displayName;
  const existingSlot = existingSlots[slotIndex];
  const existingSlotName = normalizeRosterDisplayName(
    existingSlot?.signupDisplayName ?? null,
  );
  return {
    number: slotIndex + 1,
    role,
    signupUserId:
      existingSlotName === signupDisplayName
        ? existingSlot.signupUserId
        : (userIdsByDisplayName.get(signupDisplayName ?? "") ?? null),
    signupDisplayName,
    charNote: parsedSignup.charNote,
    isTbc: parsedSignup.isTbc,
  };
};

type RosterStructure = {
  slotLines: string[];
  partySizes: number[] | null;
};

const parseRosterStructure = (roster: string): RosterStructure | null => {
  const slotLines: string[] = [];
  const partySizes: number[] = [];
  let currentPartySize = 0;
  let hasPartyHeaders = false;
  let expectedPartyNumber = 1;

  for (const line of roster.split("\n").filter(Boolean)) {
    const partyNumber = parseRosterPartyHeader(line);
    if (partyNumber === null) {
      slotLines.push(line);
      currentPartySize += 1;
      continue;
    }
    if (partyNumber !== expectedPartyNumber) return null;
    if (hasPartyHeaders && currentPartySize === 0) return null;
    if (hasPartyHeaders) partySizes.push(currentPartySize);
    hasPartyHeaders = true;
    currentPartySize = 0;
    expectedPartyNumber += 1;
  }

  if (hasPartyHeaders) {
    if (currentPartySize === 0) return null;
    partySizes.push(currentPartySize);
  }
  return {
    slotLines,
    partySizes: hasPartyHeaders ? partySizes : null,
  };
};

export const parseRosterWithPartySizes = (
  roster: string,
  existingSlots: SignupSlot[],
): ParsedRoster | null => {
  const structure = parseRosterStructure(roster);
  if (!structure) return null;
  if (
    !structure.slotLines.length ||
    (!structure.partySizes &&
      structure.slotLines.length !== existingSlots.length)
  )
    return null;

  const userIdsByDisplayName = buildRosterUserLookup(existingSlots);
  const slots = structure.slotLines.map((line, index) =>
    parseRosterSlot(line, index, existingSlots, userIdsByDisplayName),
  );
  if (slots.includes(null)) return null;
  return { slots: slots as SignupSlot[], partySizes: structure.partySizes };
};

export const parseRoster = (
  roster: string,
  existingSlots: SignupSlot[],
): SignupSlot[] | null =>
  parseRosterWithPartySizes(roster, existingSlots)?.slots ?? null;

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
  const randomIndex = randomInt(0, openSlots.length);
  return openSlots[randomIndex]!;
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
  const trimmed = value.trim();
  const tokens = trimmed.split(/\s+/);
  if (tokens.length !== 2) return null;

  const [rawAmountToken, rawUnitToken] = tokens;
  const rawAmount = rawAmountToken.toLowerCase();
  const normalizedUnit = rawUnitToken.toLowerCase();
  const allowedUnits = new Set([
    "minute",
    "minutes",
    "mins",
    "min",
    "hour",
    "hours",
    "day",
    "days",
    "week",
    "weeks",
    "month",
    "months",
  ]);

  if (!allowedUnits.has(normalizedUnit.replace(/s$/, ""))) return null;

  let amount: number;
  if (rawAmount === "next") amount = 1;
  else if (rawAmount === "last") amount = -1;
  else if (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(rawAmount))
    amount = Number(rawAmount);
  else return null;

  if (!Number.isFinite(amount) || Math.round(amount * 2) !== amount * 2) {
    return null;
  }

  const unitKey = normalizedUnit.replace(/s$/, "");
  const normalizedUnitKey = unitKey === "min" ? "minute" : unitKey;
  return timeDelta(amount, normalizedUnitKey);
};

/**
 * Checks if a user is the organizer or currently in the party roster / reserves.
 */
export const isUserInRosterOrOrganizer = (
  sheet: SignupSheet,
  user: Pick<User, "id"> &
    Partial<Pick<User, "displayName" | "globalName" | "username">>,
): boolean => {
  if (sheet.organizerId && sheet.organizerId === user.id) {
    return true;
  }
  const names = new Set(
    [user.displayName, user.globalName, user.username]
      .filter((value): value is string => Boolean(value))
      .map((value) => normalizeRosterDisplayName(value) ?? value),
  );
  if (sheet.organizerName && names.has(sheet.organizerName)) {
    return true;
  }
  const inSlots = sheet.slots.some(
    (slot) =>
      slot.signupUserId === user.id ||
      (slot.signupDisplayName &&
        names.has(normalizeRosterDisplayName(slot.signupDisplayName) ?? "")),
  );
  if (inSlots) return true;
  const inReserves = sheet.reserves.some(
    (reserve) =>
      reserve.userId === user.id ||
      (reserve.displayName &&
        names.has(normalizeRosterDisplayName(reserve.displayName) ?? "")),
  );
  return inReserves;
};

/**
 * In-memory map where entries automatically expire after a TTL duration (default 15 minutes).
 */
export class ExpiringMap<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();
  private readonly defaultTtlMs: number;

  constructor(defaultTtlMs = 15 * 60 * 1000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs = this.defaultTtlMs): this {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    return this;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    this.pruneExpired();
    return this.entries.size;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (now > entry.expiresAt) {
        this.entries.delete(key);
      }
    }
  }
}
