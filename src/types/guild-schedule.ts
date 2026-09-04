/** An active guild run schedule with the invoking member's signup status. */
export interface GuildSchedule {
  title: string;
  timestamp: string;
  channelName: string;
  channelUrl: string;
  isSignedUp: boolean;
  isReserve: boolean;
}
