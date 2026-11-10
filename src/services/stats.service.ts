import type { sheets_v4 } from "googleapis";
import {
  COOLDOWN_INSTANCE_TYPES,
  type InstanceType,
} from "../constants/cooldowns.js";
import {
  NO_SHARE_COLOR,
  PENDING_SHARE_COLOR,
  READY_SHARE_COLOR,
} from "../constants/payout-sheet-export.js";
import type {
  PayoutStats,
  PayoutStatsCategory,
  PayoutStatsOverall,
  PayoutStatsRankedPlayer,
  StatsAmount,
} from "../types/stats.js";
import { parseZeny } from "../utils/payout-sheet.js";
import { parseInstanceTypes } from "../utils/cooldowns.js";
import { readPayoutSpreadsheet } from "./google-sheets.service.js";

/** Inputs for reading amount, participation, and optional Ranking data from one guild sheet. */
export interface PayoutStatsLookup {
  worksheet: string;
  amount: StatsAmount;
  instanceTypes?: readonly InstanceType[];
  discordTag?: string;
  includeRanking?: boolean;
  /** Resolved guild display names keyed by normalized Discord username. */
  displayNameByDiscordTag?: ReadonlyMap<string, string>;
  /** Invoking user used to calculate the Your Rank field in Ranking mode. */
  rankingViewerTag?: string;
}

const getSheetGrid = (
  sheet: sheets_v4.Schema$Sheet,
): sheets_v4.Schema$CellData[][] => {
  const grid: sheets_v4.Schema$CellData[][] = [];
  for (const block of sheet.data ?? []) {
    const startRow = block.startRow ?? 0;
    const startColumn = block.startColumn ?? 0;
    for (const [rowOffset, row] of (block.rowData ?? []).entries()) {
      const target = (grid[startRow + rowOffset] ??= []);
      for (const [columnOffset, cell] of (row.values ?? []).entries()) {
        target[startColumn + columnOffset] = cell;
      }
    }
  }
  return grid;
};

const cellText = (cell?: sheets_v4.Schema$CellData): string =>
  String(
    cell?.effectiveValue?.stringValue ??
      cell?.userEnteredValue?.stringValue ??
      "",
  );

const cellAmount = (cell?: sheets_v4.Schema$CellData): number => {
  const numberValue =
    cell?.effectiveValue?.numberValue ?? cell?.userEnteredValue?.numberValue;
  if (typeof numberValue === "number" && Number.isFinite(numberValue)) {
    return numberValue;
  }
  return parseZeny(cellText(cell));
};

const cellHasColor = (
  cell: sheets_v4.Schema$CellData | undefined,
  expected: { red: number; green: number; blue: number },
): boolean => {
  const color =
    cell?.effectiveFormat?.backgroundColorStyle?.rgbColor ??
    cell?.effectiveFormat?.backgroundColor ??
    cell?.userEnteredFormat?.backgroundColorStyle?.rgbColor ??
    cell?.userEnteredFormat?.backgroundColor;
  return Boolean(
    color &&
    ["red", "green", "blue"].every(
      (component) =>
        Math.abs(
          ((color[component as keyof typeof color] as number) ?? 0) -
            expected[component as keyof typeof expected],
        ) < 0.01,
    ),
  );
};

const amountColor = {
  pending: PENDING_SHARE_COLOR,
  shareReady: READY_SHARE_COLOR,
  distributed: NO_SHARE_COLOR,
} satisfies Record<
  Exclude<StatsAmount, "overall">,
  { red: number; green: number; blue: number }
>;
const participationColors = [
  PENDING_SHARE_COLOR,
  READY_SHARE_COLOR,
  NO_SHARE_COLOR,
];

const getSelectedColors = (
  amount: StatsAmount,
): readonly { red: number; green: number; blue: number }[] =>
  amount === "overall" ? participationColors : [amountColor[amount]];

const normalizeDiscordTag = (discordTag: string): string =>
  discordTag.trim().replace(/^@/, "").toLocaleLowerCase();

const normalizeTargetTag = (discordTag?: string): string | undefined =>
  discordTag ? normalizeDiscordTag(discordTag) : undefined;

const getWorksheetGrid = (
  spreadsheet: sheets_v4.Schema$Spreadsheet,
  worksheet: string,
): sheets_v4.Schema$CellData[][] => {
  const matchingSheets = (spreadsheet.sheets ?? []).filter(
    (sheet) => sheet.properties?.title === worksheet,
  );
  if (matchingSheets.length !== 1) {
    throw new Error("The configured payout worksheet could not be found.");
  }
  return getSheetGrid(matchingSheets[0]!);
};

const getRunBoundary = (titleRow: sheets_v4.Schema$CellData[]): number => {
  const matches = titleRow.flatMap((cell, index) =>
    cellText(cell).trim().toLocaleLowerCase() === "unclaimed" ? [index] : [],
  );
  if (matches.length !== 1 || matches[0]! <= 5) {
    throw new Error(
      "The payout worksheet's run-title row is not configured correctly.",
    );
  }
  return matches[0]!;
};

const getInstanceTypesForTitle = (
  title: string,
  configuredTypes: readonly InstanceType[],
  matchingTypes: readonly InstanceType[],
): readonly InstanceType[] => {
  const matches = parseInstanceTypes(title, matchingTypes);
  if (matches.length) return matches;
  const others = configuredTypes.find((type) => type.name === "Others");
  return others ? [others] : [{ name: "Others", emoji: "💀" } as InstanceType];
};

interface ParticipantRunStats {
  amount: number;
  joined: boolean;
}

const getRunStatsByParticipant = (
  grid: sheets_v4.Schema$CellData[][],
  column: number,
  selectedColors: readonly { red: number; green: number; blue: number }[],
): Map<string, ParticipantRunStats> => {
  const statsByParticipant = new Map<string, ParticipantRunStats>();
  for (const row of grid.slice(9)) {
    const discordTag = normalizeDiscordTag(cellText(row?.[2]));
    if (!discordTag) continue;
    const stats = statsByParticipant.get(discordTag) ?? {
      amount: 0,
      joined: false,
    };
    const cell = row?.[column];
    if (selectedColors.some((color) => cellHasColor(cell, color))) {
      stats.amount += cellAmount(cell);
    }
    if (participationColors.some((color) => cellHasColor(cell, color))) {
      stats.joined = true;
    }
    statsByParticipant.set(discordTag, stats);
  }
  return statsByParticipant;
};

const aggregateRunStats = (
  statsByParticipant: ReadonlyMap<string, ParticipantRunStats>,
  targetTag?: string,
): ParticipantRunStats => {
  if (targetTag) {
    return statsByParticipant.get(targetTag) ?? { amount: 0, joined: false };
  }
  return [...statsByParticipant.values()].reduce<ParticipantRunStats>(
    (total, stats) => ({
      amount: total.amount + stats.amount,
      joined: total.joined || stats.joined,
    }),
    { amount: 0, joined: false },
  );
};

const addRunAmounts = (
  categories: Map<string, PayoutStatsCategory>,
  types: readonly InstanceType[],
  amount: number,
  joined: boolean,
): void => {
  for (const type of types) {
    const category = categories.get(type.name) ?? {
      name: type.name,
      emoji: type.emoji,
      amount: 0,
      joinedRuns: 0,
      totalRuns: 0,
    };
    category.amount += amount;
    category.totalRuns += 1;
    if (joined) category.joinedRuns += 1;
    categories.set(type.name, category);
  }
};

const getPlayerAmountTotals = (
  grid: sheets_v4.Schema$CellData[][],
): Map<string, number> => {
  const playerAmounts = new Map<string, number>();
  for (const row of grid.slice(9)) {
    const discordTag = normalizeDiscordTag(cellText(row?.[2]));
    if (discordTag) playerAmounts.set(discordTag, 0);
  }
  return playerAmounts;
};

const getPersonalStanding = (
  playerAmounts: ReadonlyMap<string, number>,
  targetTag?: string,
): NonNullable<PayoutStatsOverall["personalStanding"]> | undefined => {
  if (!targetTag) return undefined;
  const personalAmount = playerAmounts.get(targetTag) ?? 0;
  const guildAmount = [...playerAmounts.values()].reduce(
    (total, amount) => total + amount,
    0,
  );
  return {
    amount: personalAmount,
    impactPercent: guildAmount === 0 ? 0 : (personalAmount / guildAmount) * 100,
    rank:
      1 +
      [...playerAmounts.values()].filter((amount) => amount > personalAmount)
        .length,
    playerCount: playerAmounts.size + (playerAmounts.has(targetTag) ? 0 : 1),
  };
};

const getRankedPlayers = (
  playerAmounts: ReadonlyMap<string, number>,
  displayNameByDiscordTag?: ReadonlyMap<string, string>,
): PayoutStatsRankedPlayer[] => {
  const players = [...playerAmounts].map(([discordTag, amount]) => ({
    discordTag,
    amount,
  }));
  const guildAmount = players.reduce(
    (total, player) => total + player.amount,
    0,
  );
  players.sort(
    (left, right) =>
      right.amount - left.amount ||
      left.discordTag.localeCompare(right.discordTag),
  );

  let rank = 0;
  return players.slice(0, 10).map((player, index) => {
    if (index === 0 || player.amount !== players[index - 1]!.amount) {
      rank = index + 1;
    }
    return {
      discordName:
        displayNameByDiscordTag?.get(player.discordTag) ?? player.discordTag,
      amount: player.amount,
      impactPercent:
        guildAmount === 0 ? 0 : (player.amount / guildAmount) * 100,
      rank,
    };
  });
};

/** Reads color-coded share amounts and optional top-ten rankings from the configured guild worksheet. */
export const getPayoutStats = async (
  lookup: PayoutStatsLookup,
): Promise<PayoutStats> => {
  const spreadsheet = await readPayoutSpreadsheet(lookup.worksheet);
  const grid = getWorksheetGrid(spreadsheet, lookup.worksheet);
  const titleRow = grid[4] ?? [];
  const boundaryColumn = getRunBoundary(titleRow);
  const configuredTypes = lookup.instanceTypes ?? COOLDOWN_INSTANCE_TYPES;
  const matchingTypes = configuredTypes.map((type) => ({
    ...type,
    keywords: [...type.keywords, ...(type.initials ? [type.initials] : [])],
  }));
  const categories = new Map<string, PayoutStatsCategory>();
  const overall: PayoutStatsOverall = {
    amount: 0,
    joinedRuns: 0,
    totalRuns: 0,
  };
  const playerAmounts = getPlayerAmountTotals(grid);
  const selectedColors = getSelectedColors(lookup.amount);
  const targetTag = normalizeTargetTag(lookup.discordTag);

  for (let column = 5; column < boundaryColumn; column += 1) {
    const title = cellText(titleRow[column]).trim();
    if (!title) continue;
    const runTypes = getInstanceTypesForTitle(
      title,
      configuredTypes,
      matchingTypes,
    );
    const runStatsByParticipant = getRunStatsByParticipant(
      grid,
      column,
      selectedColors,
    );
    for (const [discordTag, runStats] of runStatsByParticipant) {
      playerAmounts.set(
        discordTag,
        (playerAmounts.get(discordTag) ?? 0) + runStats.amount,
      );
    }
    const runStats = aggregateRunStats(runStatsByParticipant, targetTag);
    overall.amount += runStats.amount;
    overall.totalRuns += 1;
    if (runStats.joined) overall.joinedRuns += 1;
    addRunAmounts(categories, runTypes, runStats.amount, runStats.joined);
  }

  const standingTag =
    targetTag ??
    (lookup.includeRanking
      ? normalizeTargetTag(lookup.rankingViewerTag)
      : undefined);
  overall.personalStanding = getPersonalStanding(playerAmounts, standingTag);

  return {
    amount: lookup.amount,
    categories: [...categories.values()],
    overall,
    ...(lookup.includeRanking
      ? {
          ranking: getRankedPlayers(
            playerAmounts,
            lookup.displayNameByDiscordTag,
          ),
        }
      : {}),
  };
};
