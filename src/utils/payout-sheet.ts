import type { SheetRow } from "../types/google-sheets.js";

export const parseZeny = (value: string | undefined): number => {
  if (!value) return 0;

  const amount = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
};

export const findGuildStartColumn = (
  headerRow: SheetRow,
  guildId: string,
): number => headerRow.findIndex((value) => value.trim() === guildId);

export const findPayoutRow = (
  rows: SheetRow[],
  discordTag: string,
): SheetRow | undefined => {
  const playerTags = new Set([
    discordTag.toLocaleLowerCase(),
    `@${discordTag}`.toLocaleLowerCase(),
  ]);

  return rows.find((row) => playerTags.has(row[0]?.trim().toLocaleLowerCase()));
};
