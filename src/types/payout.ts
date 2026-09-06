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

export type PayoutAmount = "shareReady" | "pending" | "distributed";
export type PayoutSort = "name" | "amount";
export type PayoutSortDirection = "asc" | "desc";

export interface PayoutSummary {
  amount: PayoutAmount;
  payouts: ShareReadyPayout[];
  total: number;
  currency: "z";
}
