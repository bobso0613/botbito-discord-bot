import { PAYOUT_HEADERS } from "../constants/index.js";
import type {
  PayoutAmount,
  PayoutDetails,
  PayoutLookup,
  PayoutSort,
  PayoutSortDirection,
  PayoutSummary,
} from "../types/payout.js";
import {
  findGuildStartColumn,
  findPayoutRow,
  parseZeny,
} from "../utils/payout-sheet.js";
import { sortPayouts } from "../utils/payout-summary.js";
import { readCombinedPayoutSheetRows } from "./google-sheets.service.js";

export type {
  PayoutAmount,
  PayoutDetails,
  PayoutLookup,
  PayoutSummary,
  PayoutSort,
  PayoutSortDirection,
  ShareReadyPayout,
} from "../types/payout.js";

/**
 * Gets a member's payout balances for the guild where they invoked the command.
 * @param lookup - The calling guild and Discord tag used to find the sheet row.
 */
export const getPayoutDetails = async (
  lookup: PayoutLookup,
): Promise<PayoutDetails> => {
  const rows = await readCombinedPayoutSheetRows();
  const [guildRow = [], statusRow = [], ...playerRows] = rows;
  const guildStartColumn = findGuildStartColumn(guildRow, lookup.guildId);
  const payoutRow = findPayoutRow(playerRows, lookup.discordTag);

  const payoutValues = PAYOUT_HEADERS.map((header) => {
    if (guildStartColumn === -1 || !payoutRow) return 0;

    const statusColumn = statusRow.findIndex(
      (value, index) => index >= guildStartColumn && value.trim() === header,
    );
    return parseZeny(payoutRow[statusColumn]);
  });

  return {
    pending: payoutValues[0],
    shareReady: payoutValues[1],
    distributed: payoutValues[2],
    currency: "z",
  };
};

/**
 * Lists all non-zero payouts for a guild for the selected amount and calculates their total.
 * @param guildId - The Discord guild ID that identifies the payout column group.
 * @param amount - The payout amount to list.
 * @param sortBy - The field used to sort payouts.
 * @param direction - The sort direction.
 */
export const getPayoutSummary = async (
  guildId: string,
  amount: PayoutAmount = "shareReady",
  sortBy: PayoutSort = "amount",
  direction: PayoutSortDirection = "desc",
): Promise<PayoutSummary> => {
  const rows = await readCombinedPayoutSheetRows();
  const [guildRow = [], statusRow = [], ...playerRows] = rows;
  const guildStartColumn = findGuildStartColumn(guildRow, guildId);
  const payoutColumn = statusRow.findIndex(
    (value, index) =>
      index >= guildStartColumn &&
      value.trim() ===
        (
          {
            pending: "Pending",
            shareReady: "Share Ready",
            distributed: "Distributed",
          } satisfies Record<PayoutAmount, string>
        )[amount],
  );
  const payouts =
    payoutColumn === -1
      ? []
      : playerRows
          .map((row) => ({
            displayName: row[0]?.trim(),
            discordTag: row[0]?.trim(),
            amount: parseZeny(row[payoutColumn]),
          }))
          .filter(
            (
              payout,
            ): payout is {
              displayName: string;
              discordTag: string;
              amount: number;
            } => Boolean(payout.discordTag) && payout.amount !== 0,
          );

  const sortedPayouts = sortPayouts(payouts, sortBy, direction);

  return {
    amount,
    payouts: sortedPayouts,
    total: payouts.reduce((total, payout) => total + payout.amount, 0),
    currency: "z",
  };
};
