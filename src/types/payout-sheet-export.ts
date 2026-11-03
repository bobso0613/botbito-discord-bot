import type { sheets_v4 } from "googleapis";

/** Absolute, zero-based spreadsheet grid assembled from Sheets API data blocks. */
export type PayoutSheetGrid = sheets_v4.Schema$CellData[][];

/** A request in the validated atomic Sheets write batch. */
export type PayoutSheetRequest = sheets_v4.Schema$Request;

/** Formula source column used when extending a participant's summary row. */
export interface PayoutSheetFormula {
  column: number;
  formula: string;
}

/** Resolved Discord identity used for tag matching and lifetime roster entries. */
export interface PayoutSheetMember {
  userId: string;
  displayName: string;
  discordTag: string;
}

/** Values used in a Ready DM after the recalculated sheets have been read back. */
export interface PayoutFinalizationShareAmount {
  userId: string;
  thisRun: number;
  totalUnclaimed: number;
}

/** Evaluated financial inputs from the finalized run column. */
export interface PayoutFinalizationTotals {
  totalEarned: number;
  reimbursements: number;
}

/** Confirmed sheet/column identity and evaluated balances after share finalization. */
export interface PayoutSheetFinalizationResult {
  sheetName: string;
  columnName: string;
  shareAmounts: PayoutFinalizationShareAmount[];
  /** Ready run inputs from rows 6 and 8 of the exact managed column. */
  payoutTotals?: PayoutFinalizationTotals;
}

/** Participant IDs and identities recorded for one pending roster write. */
export interface PayoutSheetRosterState {
  userIds: string[];
  members?: PayoutSheetMember[];
}

/**
 * Durable input for one Discord post and its managed spreadsheet column.
 * Pending work is retained for retries; successful edits reuse the existing column.
 */
export interface PayoutSheetSnapshot {
  identifier: string;
  title: string;

  vendor: string;
  userIds: string[];
  members?: PayoutSheetMember[];
  syncedParticipantCount?: number;
  syncedMembers?: PayoutSheetMember[];
  /** Legacy single-state input, retained when reading older history. */
  previousPendingRoster?: PayoutSheetRosterState;
  /** Every roster whose atomic write might have committed before confirmation. */
  pendingRosters?: PayoutSheetRosterState[];
  mode: "create" | "vendor" | "roster";
  status: "pending" | "synced";
  /** Only newly managed exports may create a missing column; legacy exports never guess. */
  createIfMissing?: boolean;
  /** Prevents sheet creation until the full Discord roster has been delivered or repaired. */
  deliveryIncomplete?: boolean;
}

/** Completed Discord changes to persist before attempting the linked Sheets update. */
export interface PayoutSheetEdit {
  contents?: readonly string[];
  starterContent?: string;
  vendor?: string;
  userIds?: string[];
}
