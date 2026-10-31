import type { Guild } from "discord.js";
import type {
  SignupExportHistoryEntry,
  SignupExportPart,
} from "../types/signup-export.js";
import type {
  PayoutSheetSnapshot,
  PayoutSheetEdit,
} from "../types/payout-sheet-export.js";
import { planPayoutSheetExport } from "../utils/payout-sheet-export.js";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import {
  buildPayoutSheetFailureNotice,
  buildPayoutSheetStarterContent,
  buildPayoutSheetSuccessNotice,
} from "../templates/signup-export.template.js";
import {
  getExportDate,
  getExportInstanceTypes,
} from "../utils/signup-export.js";
import {
  readPayoutSpreadsheet,
  writePayoutSpreadsheet,
} from "./google-sheets.service.js";
import * as historyService from "./signup-export.service.js";

const spreadsheetQueues = new Map<string, Promise<void>>();

/**
 * Captures the exact exported roster, vendor, instance initials, and timezone-aware run date.
 * @param part Confirmed combined or split post, after absent/TBC exclusions.
 * @returns Durable retry input, or undefined when the guild has no configured worksheet.
 */
export const buildPayoutSheetSnapshot = (
  part: SignupExportPart,
): PayoutSheetSnapshot | undefined => {
  if (!DISCORD_SETTINGS.payoutWorksheets?.[part.sheet.guildId])
    return undefined;
  const date = getExportDate(part.sheet);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const initials = getExportInstanceTypes(part.sheet)
    .map((type) => type.initials)
    .join("+");
  return {
    identifier: part.identifier,
    title: `${initials || part.sheet.title} ${day}/${month}`,
    vendor: part.vendor,
    userIds: [...new Set(part.slots.map((slot) => slot.signupUserId!))],
    mode: "create",
    status: "pending",
    createIfMissing: true,
  };
};

/**
 * Serializes Discord export/edit actions and their Sheets attempts across a shared spreadsheet.
 * @param action Operation that must finish before the next operation may start.
 * @returns The action's result; rejection does not prevent subsequent queued actions.
 */
export const queuePayoutSheetOperation = <Result>(
  action: () => Promise<Result>,
): Promise<Result> => {
  const key = process.env.GOOGLE_SHEETS_ID ?? "unconfigured";
  const previous = spreadsheetQueues.get(key) ?? Promise.resolve();
  const operation = previous.then(action);
  spreadsheetQueues.set(
    key,
    operation.then(
      () => undefined,
      () => undefined,
    ),
  );
  return operation;
};

const failureNotice = (error: unknown): string => {
  const code = (error as { code?: string | number })?.code;
  const fallback =
    error instanceof Error
      ? error.message.slice(0, 250)
      : "Unknown synchronization error";
  const detail = code ? `Sheets API error ${code}` : fallback;
  return buildPayoutSheetFailureNotice(detail);
};

const historyFailureNotice = (error: unknown): string => {
  const detail =
    error instanceof Error
      ? error.message.slice(0, 250)
      : "Unknown history error";
  return `Payout export history could not be saved: ${detail}. The Currently Vending list may be stale; contact an administrator.`;
};

const applyExportEdit = (
  entry: SignupExportHistoryEntry,
  edit: PayoutSheetEdit,
): void => {
  if (edit.contents) entry.contents = edit.contents;
  if (edit.starterContent)
    entry.contents = [edit.starterContent, ...(entry.contents?.slice(1) ?? [])];
  const snapshot = entry.sheetsSync;
  if (!snapshot) return;
  if (edit.vendor !== undefined) snapshot.vendor = edit.vendor;
  if (edit.userIds) {
    snapshot.userIds = [...new Set(edit.userIds)];
    snapshot.members = undefined;
    snapshot.deliveryIncomplete = false;
  }
  if (snapshot.status === "synced") {
    snapshot.mode = edit.userIds ? "roster" : "vendor";
  } else if (snapshot.mode === "create" || edit.userIds) {
    snapshot.mode = "roster";
  }
  snapshot.status = "pending";
};

const updatePayoutSheetStarter = async (
  guild: Guild,
  worksheet: string,
  entry: SignupExportHistoryEntry,
  save: () => Promise<void>,
  notice: string,
): Promise<string> => {
  try {
    if (!entry.threadId || !entry.sheetsSync)
      throw new Error("The payout thread reference is missing");
    const thread = await guild.channels.fetch(entry.threadId);
    if (!thread?.isThread())
      throw new Error("The payout thread is unavailable");
    const starter = await thread.fetchStarterMessage();
    if (!starter) throw new Error("The payout starter post is unavailable");
    const content = buildPayoutSheetStarterContent(
      starter.content,
      worksheet,
      entry.sheetsSync.title,
    );
    if (content !== starter.content) {
      await starter.edit({ content, allowedMentions: { parse: [] } });
    }
    if (entry.contents?.[0] !== content) {
      entry.contents = [content, ...(entry.contents?.slice(1) ?? [])];
      await save();
    }
    return notice;
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message.slice(0, 250)
        : "Unknown Discord error";
    return `${notice}\nThe payout thread's first post could not be updated: ${detail}. Retry the same export to add the Sheets destination.`;
  }
};

const synchronizeEntry = async (
  guild: Guild,
  worksheet: string,
  entry: SignupExportHistoryEntry,
  save: () => Promise<void>,
  edit?: PayoutSheetEdit,
): Promise<string> => {
  if (edit) {
    applyExportEdit(entry, edit);
    await save();
  }
  const snapshot = entry.sheetsSync;
  if (!snapshot)
    throw new Error("This older export has no managed Sheets record");
  if (snapshot.deliveryIncomplete)
    throw new Error(
      "Discord roster delivery was incomplete; repair the roster before syncing",
    );
  if (snapshot.status === "synced")
    return updatePayoutSheetStarter(
      guild,
      worksheet,
      entry,
      save,
      "Google Sheets is already synchronized.",
    );
  if (!snapshot.members && snapshot.mode !== "vendor") {
    snapshot.members = await Promise.all(
      snapshot.userIds.map(async (userId) => {
        const member = await guild.members.fetch({
          user: userId,
          force: true,
        });
        return {
          userId,
          displayName: member.displayName,
          discordTag: member.user.username,
        };
      }),
    );
    await save();
  }
  const spreadsheet = await readPayoutSpreadsheet(worksheet);
  const requests = planPayoutSheetExport(spreadsheet, worksheet, snapshot);
  if (requests.length) await writePayoutSpreadsheet(requests);
  snapshot.status = "synced";
  snapshot.createIfMissing = false;
  await save();
  return updatePayoutSheetStarter(
    guild,
    worksheet,
    entry,
    save,
    buildPayoutSheetSuccessNotice(worksheet, snapshot.title),
  );
};

/**
 * Attempts a bounded Sheets sync after Discord succeeds, returning a public notice instead of throwing.
 * Unmapped guilds are skipped. Older exports never acquire columns by guessing title/date matches.
 * Callers serialize their Discord mutation and this attempt through queuePayoutSheetOperation.
 * @param guild Guild used to resolve current participant usernames and display names.
 * @param threadId Confirmed Discord export thread.
 * @param edit Optional authoritative metadata/roster from a completed Discord edit.
 * @returns Success with a default-formula reminder, a manual-update warning, or empty text for unmapped guilds.
 */
export const syncPayoutExport = async (
  guild: Guild,
  threadId: string,
  edit?: PayoutSheetEdit,
): Promise<string> => {
  const worksheet = DISCORD_SETTINGS.payoutWorksheets?.[guild.id];
  if (!worksheet) {
    if (!edit) return "";
    try {
      await historyService.withSignupExportHistory(
        guild.id,
        threadId,
        async (entry, save) => {
          applyExportEdit(entry, edit);
          await save();
          return "";
        },
      );
      return "";
    } catch (error) {
      return historyFailureNotice(error);
    }
  }
  try {
    return await historyService.withSignupExportHistory(
      guild.id,
      threadId,
      (entry, save) => synchronizeEntry(guild, worksheet, entry, save, edit),
    );
  } catch (error) {
    return failureNotice(error);
  }
};
