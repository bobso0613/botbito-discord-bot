import type { SignupSheet, SignupSlot } from "./signup-sheet.js";
import type {
  PayoutFinalizationShareAmount,
  PayoutFinalizationTotals,
  PayoutSheetSnapshot,
} from "./payout-sheet-export.js";

/** Terminal distribution outcome selected for one exported payout thread. */
export type ShareFinalizationStatus = "ready" | "done-no-share" | "cancelled";

/** Durable progress for completing one selected share status across Sheets and Discord. */
export interface SignupExportFinalization {
  /** Status chosen by the organizer; it cannot change after persistence. */
  status: ShareFinalizationStatus;
  /** Sheets write state, including ambiguous/interrupted outcomes that require manual review. */
  sheets: "pending" | "in-progress" | "confirmed" | "manual";
  /** Saved repair details, including any temporary recalculation column left behind. */
  sheetsNotice?: string;
  /** Whether the pending hourglass title was replaced successfully. */
  titleUpdated?: boolean;
  /** Per-participant DM state, including notification and negative-balance skips. */
  dmDeliveries?: Record<
    string,
    "attempting" | "sent" | "failed" | "skipped" | "skipped-negative-balance"
  >;
  /** Recalculated per-run and total unclaimed amounts retained for interrupted DM recovery. */
  shareAmounts?: Record<string, Omit<PayoutFinalizationShareAmount, "userId">>;
  /** Verified run inputs retained for public reporting after interruption. */
  payoutTotals?: PayoutFinalizationTotals;
  /** Confirmed sheet and column labels used in status messages and DM recovery. */
  sheetName?: string;
  columnName?: string;
  /** Public result chunks and their individual delivery state. */
  publicMessages?: Array<{
    content: string;
    status: "pending" | "attempting" | "sent" | "failed";
    messageId?: string;
  }>;
  /** Separate payout summary chunks, published only after the thread is locked. */
  summaryMessages?: NonNullable<SignupExportFinalization["publicMessages"]>;
  /** Whether the payout thread was locked. */
  locked?: boolean;
  /** True only when the title, public report, thread lock, and required summary are confirmed. */
  completed?: boolean;
}

export interface SignupExportHistoryEntry {
  threadId: string | null;
  /** Organizer identity captured for this export; old history may omit these fields. */
  organizerId?: string;
  organizerName?: string;
  organizerAvatarUrl?: string;
  contents?: readonly string[];
  participantUserIds?: string[];
  sheetsSync?: PayoutSheetSnapshot;
  /** Optional for compatibility with history written before share-status finalization. */
  shareFinalization?: SignupExportFinalization;
}

/** Persisted guild export coverage; a null ID reserves a potentially interrupted post. */
export type ExportHistory = Record<string, SignupExportHistoryEntry>;

/** Result of creating a post, finding existing coverage, or retaining a reservation. */
export interface SignupExportResult {
  created: boolean;
  threadId: string | null;
}

/** Existing forum post and its original bot-authored roster messages, oldest first. */
export interface RecoveredSignupExport {
  threadId: string;
  contents: readonly string[];
}

/** Looks up a coverage key or known thread; null confirms absence, while read failures must reject. */
export type FindExistingThread = (
  key: string,
  threadId?: string,
) => Promise<string | RecoveredSignupExport | null>;

/** Prepared combined or per-instance post; null contents indicate an oversized roster. */
export interface SignupExportPart {
  runKey: string;
  identifier: string;
  sheet: SignupSheet;
  slots: SignupSlot[];
  contents: string[] | null;
  vendor: string;
  initials?: string;
}
