export interface SignupSlot {
  number: number;
  role: string;
  signupUserId: string | null;
  signupDisplayName: string | null;
  charNote: string | null;
  isTbc?: boolean;
}

export interface SignupSheet {
  guildId: string;
  channelId: string;
  title: string;
  organizerId?: string | null;
  organizerName: string;
  organizerAvatarUrl: string;
  partySizes: number[];
  slots: SignupSlot[];
  reserves: Array<{
    userId: string;
    displayName: string;
    charNote: string | null;
    isTbc?: boolean;
  }>;
  notes: string | null;
  thumbnailUrl: string | null;
  color: number | null;
  instanceType: string | null;
  timestamp: number | null;
  scheduleTimezone: string | null;
  serverTimezone: string | null;
  messageId?: string | null;
}
