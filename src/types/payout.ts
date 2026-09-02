export interface PayoutDetails {
  pending: number;
  shareReady: number;
  distributed: number;
  currency: "z";
}

export interface PayoutLookup {
  guildId: string;
  discordTag: string;
}

export interface ShareReadyPayout {
  displayName: string;
  discordTag: string;
  amount: number;
}

export interface PayoutSummary {
  shareReadyPayouts: ShareReadyPayout[];
  totalShareReady: number;
  currency: "z";
}
