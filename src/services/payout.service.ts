import { PAYOUT_HEADERS } from "../constants/index.js";
import type {
  PayoutDetails,
  PayoutLookup,
  PayoutSummary,
} from "../types/payout.js";
import {
  findGuildStartColumn,
  findPayoutRow,
  parseZeny,
} from "../utils/payout-sheet.js";
import { readCombinedPayoutSheetRows } from "./google-sheets.service.js";

export type {
  PayoutDetails,
  PayoutLookup,
  PayoutSummary,
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
 * Lists all non-zero Share Ready payouts for a guild and calculates their total.
 * @param guildId - The Discord guild ID that identifies the payout column group.
 */
export const getPayoutSummary = async (
  guildId: string,
): Promise<PayoutSummary> => {
  const rows = await readCombinedPayoutSheetRows();
  const [guildRow = [], statusRow = [], ...playerRows] = rows;
  const guildStartColumn = findGuildStartColumn(guildRow, guildId);
  const shareReadyColumn = statusRow.findIndex(
    (value, index) =>
      index >= guildStartColumn && value.trim() === "Share Ready",
  );
  const shareReadyPayouts =
    shareReadyColumn === -1
      ? []
      : playerRows
          .map((row) => ({
            displayName: row[0]?.trim(),
            discordTag: row[0]?.trim(),
            amount: parseZeny(row[shareReadyColumn]),
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

  return {
    shareReadyPayouts,
    totalShareReady: shareReadyPayouts.reduce(
      (total, payout) => total + payout.amount,
      0,
    ),
    currency: "z",
  };
};
