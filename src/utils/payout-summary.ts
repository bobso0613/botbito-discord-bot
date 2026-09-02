import type {
  PayoutSort,
  PayoutSortDirection,
  ShareReadyPayout,
} from "../types/payout.js";

export const sortShareReadyPayouts = (
  payouts: ShareReadyPayout[],
  sortBy: PayoutSort = "amount",
  direction: PayoutSortDirection = "desc",
): ShareReadyPayout[] =>
  [...payouts].sort((left, right) => {
    const primaryComparison =
      sortBy === "name"
        ? left.displayName.localeCompare(right.displayName)
        : left.amount - right.amount;
    const directedComparison =
      direction === "asc" ? primaryComparison : -primaryComparison;

    return (
      directedComparison || left.displayName.localeCompare(right.displayName)
    );
  });
