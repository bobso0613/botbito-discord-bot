/** An active guild run schedule with the invoking member's signup status. */
export interface GuildSchedule {
  /** Schedule embed title. */
  title: string;
  /** Discord absolute timestamp mention for the scheduled run time. */
  timestamp: string;
  /** Signup channel display name. */
  channelName: string;
  /** Direct URL to the signup channel. */
  channelUrl: string;
  /** Whether the invoking member is listed as signed up. */
  isSignedUp: boolean;
  /** Whether the invoking member is listed as reserve. */
  isReserve: boolean;
  /** Optional character or signup note found beside the member entry. */
  charNote?: string;
  /** Guild name shown in cross-guild personal schedule output. */
  guildName?: string;
  /** Configured custom guild emoji shown in cross-guild personal schedule output. */
  guildIcon?: string;
}

/** Inclusive start and exclusive end bounds for schedule timestamps. */
export interface GuildScheduleTimeWindow {
  /** Earliest schedule time to include. */
  start: Date;
  /** First schedule time after the window to exclude. */
  end: Date;
}

/** Supported grouping modes for the personal schedule DM embed. */
export type MyScheduleGrouping = "date" | "guild";
