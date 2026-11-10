import type { PayoutAmount } from "./payout.js";

export type StatsAmount = PayoutAmount | "overall";
export type StatsView = "Personal" | "Guild" | "Ranking";

export interface PayoutStatsRankedPlayer {
  discordName: string;
  amount: number;
  impactPercent: number;
  rank: number;
}

export interface PayoutStatsCategory {
  name: string;
  emoji: string;
  amount: number;
  joinedRuns: number;
  totalRuns: number;
}

export interface PayoutStatsOverall {
  amount: number;
  joinedRuns: number;
  totalRuns: number;
  personalStanding?: {
    amount: number;
    impactPercent: number;
    rank: number;
    playerCount: number;
  };
}

export interface PayoutStats {
  amount: StatsAmount;
  categories: PayoutStatsCategory[];
  overall: PayoutStatsOverall;
  ranking?: PayoutStatsRankedPlayer[];
}
