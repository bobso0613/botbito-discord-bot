import type { SignupSheet, SignupSlot } from "./signup-sheet.js";

/** Persisted guild export coverage; a null ID reserves a potentially interrupted post. */
export type ExportHistory = Record<
  string,
  { threadId: string | null; contents?: readonly string[] }
>;

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
