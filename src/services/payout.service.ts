import {
  readCombinedPayoutSheetRows,
  type SheetRow,
} from "./google-sheets.service.js";

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

const PAYOUT_HEADERS = ["Pending", "Share Ready", "Distributed"] as const;

const parseZeny = (value: string | undefined): number => {
  if (!value) return 0;

  const amount = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
};

const findGuildStartColumn = (headerRow: SheetRow, guildId: string): number =>
  headerRow.findIndex((value) => value.trim() === guildId);

const findPayoutRow = (
  rows: SheetRow[],
  discordTag: string,
): SheetRow | undefined => {
  const playerTags = new Set([
    discordTag.toLocaleLowerCase(),
    `@${discordTag}`.toLocaleLowerCase(),
  ]);

  const foundRow = rows.find((row) =>
    playerTags.has(row[0]?.trim().toLocaleLowerCase()),
  );
  return foundRow;
};

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
