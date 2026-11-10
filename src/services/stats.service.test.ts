import { jest } from "@jest/globals";
import type { sheets_v4 } from "googleapis";
import {
  NO_SHARE_COLOR,
  PENDING_SHARE_COLOR,
  READY_SHARE_COLOR,
} from "../constants/payout-sheet-export.js";
import type { InstanceType } from "../constants/cooldowns.js";

const readPayoutSpreadsheet =
  jest.fn<() => Promise<sheets_v4.Schema$Spreadsheet>>();

jest.unstable_mockModule("./google-sheets.service.js", () => ({
  readPayoutSpreadsheet,
}));

const { getPayoutStats } = await import("./stats.service.js");

const textCell = (value: string): sheets_v4.Schema$CellData => ({
  effectiveValue: { stringValue: value },
});

const amountCell = (
  amount: number,
  color: { red: number; green: number; blue: number },
): sheets_v4.Schema$CellData => ({
  effectiveValue: { numberValue: amount },
  effectiveFormat: { backgroundColor: color },
});

const buildSpreadsheet = (): sheets_v4.Schema$Spreadsheet => {
  const rowData = Array.from({ length: 11 }, () => ({
    values: [] as sheets_v4.Schema$CellData[],
  }));
  rowData[4]!.values![5] = textCell("ET+EC 07/17");
  rowData[4]!.values![6] = textCell("Wolfchev 17/09");
  rowData[4]!.values![7] = textCell("ET 18/09");
  rowData[4]!.values![8] = textCell("Mystery Run 19/09");
  rowData[4]!.values![9] = textCell("Unclaimed");
  rowData[9]!.values![2] = textCell("@alice");
  rowData[9]!.values![5] = amountCell(10_000, PENDING_SHARE_COLOR);
  rowData[9]!.values![6] = amountCell(40_000, READY_SHARE_COLOR);
  rowData[9]!.values![8] = amountCell(1_234.9, PENDING_SHARE_COLOR);
  rowData[10]!.values![2] = textCell("@bob");
  rowData[10]!.values![5] = amountCell(20_000, PENDING_SHARE_COLOR);
  rowData[10]!.values![6] = amountCell(5_000, NO_SHARE_COLOR);
  rowData[10]!.values![7] = amountCell(7_000, NO_SHARE_COLOR);
  rowData[10]!.values![9] = amountCell(999_000_000, READY_SHARE_COLOR);
  return {
    sheets: [
      {
        properties: { title: "Guild 2026" },
        data: [{ startRow: 0, startColumn: 0, rowData }],
      },
    ],
  };
};

const instanceTypes: InstanceType[] = [
  {
    name: "Endless Tower",
    initials: "ET",
    keywords: ["ET"],
    maxAttempts: 3,
    emoji: "🪜",
  },
  {
    name: "Endless Cellar",
    initials: "EC",
    keywords: ["EC"],
    maxAttempts: 3,
    emoji: "📉",
  },
  {
    name: "Wolfchev's Laboratory",
    keywords: ["Wolfchev"],
    maxAttempts: 1,
    emoji: "🐺",
  },
];

describe("payout statistics service", () => {
  beforeEach(() => {
    readPayoutSpreadsheet.mockResolvedValue(buildSpreadsheet());
  });

  it("matches combined initials and historical titles for one user", async () => {
    await expect(
      getPayoutStats({
        worksheet: "Guild 2026",
        amount: "pending",
        discordTag: "alice",
        instanceTypes,
      }),
    ).resolves.toEqual({
      amount: "pending",
      overall: {
        amount: 11_234.9,
        joinedRuns: 3,
        totalRuns: 4,
        personalStanding: {
          amount: 11_234.9,
          impactPercent: 35.96906024991276,
          rank: 2,
          playerCount: 2,
        },
      },
      categories: [
        {
          name: "Endless Tower",
          emoji: "🪜",
          amount: 10_000,
          joinedRuns: 1,
          totalRuns: 2,
        },
        {
          name: "Endless Cellar",
          emoji: "📉",
          amount: 10_000,
          joinedRuns: 1,
          totalRuns: 1,
        },
        {
          name: "Wolfchev's Laboratory",
          emoji: "🐺",
          amount: 0,
          joinedRuns: 1,
          totalRuns: 1,
        },
        {
          name: "Others",
          emoji: "💀",
          amount: 1_234.9,
          joinedRuns: 1,
          totalRuns: 1,
        },
      ],
    });
    expect(readPayoutSpreadsheet).toHaveBeenCalledWith("Guild 2026");
  });

  it("sums the selected guild-wide amount by each matched title category", async () => {
    await expect(
      getPayoutStats({
        worksheet: "Guild 2026",
        amount: "shareReady",
        instanceTypes,
      }),
    ).resolves.toEqual({
      amount: "shareReady",
      overall: { amount: 40_000, joinedRuns: 4, totalRuns: 4 },
      categories: [
        {
          name: "Endless Tower",
          emoji: "🪜",
          amount: 0,
          joinedRuns: 2,
          totalRuns: 2,
        },
        {
          name: "Endless Cellar",
          emoji: "📉",
          amount: 0,
          joinedRuns: 1,
          totalRuns: 1,
        },
        {
          name: "Wolfchev's Laboratory",
          emoji: "🐺",
          amount: 40_000,
          joinedRuns: 1,
          totalRuns: 1,
        },
        {
          name: "Others",
          emoji: "💀",
          amount: 0,
          joinedRuns: 1,
          totalRuns: 1,
        },
      ],
    });
  });

  it("includes pending, ready, and distributed cells in Overall", async () => {
    await expect(
      getPayoutStats({
        worksheet: "Guild 2026",
        amount: "overall",
        discordTag: "alice",
        instanceTypes,
      }),
    ).resolves.toEqual({
      amount: "overall",
      overall: {
        amount: 51_234.9,
        joinedRuns: 3,
        totalRuns: 4,
        personalStanding: {
          amount: 51_234.9,
          impactPercent: 61.55458827967596,
          rank: 1,
          playerCount: 2,
        },
      },
      categories: [
        {
          name: "Endless Tower",
          emoji: "🪜",
          amount: 10_000,
          joinedRuns: 1,
          totalRuns: 2,
        },
        {
          name: "Endless Cellar",
          emoji: "📉",
          amount: 10_000,
          joinedRuns: 1,
          totalRuns: 1,
        },
        {
          name: "Wolfchev's Laboratory",
          emoji: "🐺",
          amount: 40_000,
          joinedRuns: 1,
          totalRuns: 1,
        },
        {
          name: "Others",
          emoji: "💀",
          amount: 1_234.9,
          joinedRuns: 1,
          totalRuns: 1,
        },
      ],
    });
  });

  it("gives players tied for the highest total the same lowest rank", async () => {
    const spreadsheet = buildSpreadsheet();
    const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
    rows[10]!.values![8] = amountCell(19_234.9, PENDING_SHARE_COLOR);
    readPayoutSpreadsheet.mockResolvedValue(spreadsheet);

    const alice = await getPayoutStats({
      worksheet: "Guild 2026",
      amount: "overall",
      discordTag: "alice",
      instanceTypes,
    });
    const bob = await getPayoutStats({
      worksheet: "Guild 2026",
      amount: "overall",
      discordTag: "bob",
      instanceTypes,
    });

    expect(alice.overall.personalStanding).toMatchObject({
      rank: 1,
      playerCount: 2,
    });
    expect(bob.overall.personalStanding).toMatchObject({
      rank: 1,
      playerCount: 2,
    });
  });

  it("returns only the top ten players in descending amount order", async () => {
    const spreadsheet = buildSpreadsheet();
    const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
    for (let index = 0; index < 11; index += 1) {
      const row = { values: [] as sheets_v4.Schema$CellData[] };
      row.values[2] = textCell(`@player${String(index).padStart(2, "0")}`);
      row.values[5] = amountCell(100_000 - index * 1_000, PENDING_SHARE_COLOR);
      rows.push(row);
    }
    readPayoutSpreadsheet.mockResolvedValue(spreadsheet);

    const stats = await getPayoutStats({
      worksheet: "Guild 2026",
      amount: "overall",
      instanceTypes,
      includeRanking: true,
      rankingViewerTag: "alice",
      displayNameByDiscordTag: new Map([["player00", "Player Zero"]]),
    });

    expect(stats.ranking).toHaveLength(10);
    expect(stats.ranking?.[0]).toMatchObject({
      discordName: "Player Zero",
      amount: 100_000,
      rank: 1,
    });
    expect(stats.ranking?.at(-1)).toMatchObject({
      discordName: "player09",
      amount: 91_000,
      rank: 10,
    });
    expect(stats.overall.personalStanding).toMatchObject({
      amount: 51_234.9,
      rank: 12,
      playerCount: 13,
    });
  });

  it("omits players with zero selected amount from Ranking", async () => {
    const spreadsheet = buildSpreadsheet();
    const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
    const zeroRow = { values: [] as sheets_v4.Schema$CellData[] };
    zeroRow.values[2] = textCell("@zero-player");
    rows.push(zeroRow);
    readPayoutSpreadsheet.mockResolvedValue(spreadsheet);

    const stats = await getPayoutStats({
      worksheet: "Guild 2026",
      amount: "shareReady",
      instanceTypes,
      includeRanking: true,
    });

    expect(
      stats.ranking?.some((player) => player.discordName === "zero-player"),
    ).toBe(false);
  });

  it.each([
    [
      "missing",
      (spreadsheet: sheets_v4.Schema$Spreadsheet) => {
        spreadsheet.sheets = [];
      },
    ],
    [
      "duplicate",
      (spreadsheet: sheets_v4.Schema$Spreadsheet) => {
        spreadsheet.sheets!.push(structuredClone(spreadsheet.sheets![0]!));
      },
    ],
    [
      "empty grid",
      (spreadsheet: sheets_v4.Schema$Spreadsheet) => {
        spreadsheet.sheets![0]!.data = undefined;
      },
    ],
  ])("rejects a %s payout worksheet", async (_name, mutate) => {
    const spreadsheet = buildSpreadsheet();
    (mutate as (sheet: sheets_v4.Schema$Spreadsheet) => void)(spreadsheet);
    readPayoutSpreadsheet.mockResolvedValue(spreadsheet);

    await expect(
      getPayoutStats({
        worksheet: "Guild 2026",
        amount: "pending",
        instanceTypes,
      }),
    ).rejects.toThrow(
      _name === "empty grid"
        ? "run-title row is not configured correctly"
        : "configured payout worksheet could not be found",
    );
  });

  it.each([
    [
      "missing",
      (headers: sheets_v4.Schema$CellData[]) => {
        delete headers[9];
      },
    ],
    [
      "duplicate",
      (headers: sheets_v4.Schema$CellData[]) => {
        headers[10] = textCell("Unclaimed");
      },
    ],
    [
      "before the run area",
      (headers: sheets_v4.Schema$CellData[]) => {
        delete headers[9];
        headers[5] = textCell("Unclaimed");
      },
    ],
  ])("rejects a %s Unclaimed boundary", async (_name, mutate) => {
    const spreadsheet = buildSpreadsheet();
    const headers = spreadsheet.sheets![0]!.data![0]!.rowData![4]!.values!;
    (mutate as (cells: sheets_v4.Schema$CellData[]) => void)(headers);
    readPayoutSpreadsheet.mockResolvedValue(spreadsheet);

    await expect(
      getPayoutStats({
        worksheet: "Guild 2026",
        amount: "pending",
        instanceTypes,
      }),
    ).rejects.toThrow("run-title row is not configured correctly");
  });

  it("reads sparse grid blocks and user-entered payout values", async () => {
    const spreadsheet: sheets_v4.Schema$Spreadsheet = {
      sheets: [
        {
          properties: { title: "Guild 2026" },
          data: [
            {
              startRow: 4,
              startColumn: 5,
              rowData: [
                {
                  values: [textCell("Unknown run"), textCell("Unclaimed")],
                },
              ],
            },
            {
              startRow: 9,
              startColumn: 2,
              rowData: [
                {
                  values: [
                    { userEnteredValue: { stringValue: "@alice" } },
                    {},
                    {},
                    {
                      userEnteredValue: { stringValue: "2,500" },
                      userEnteredFormat: {
                        backgroundColor: PENDING_SHARE_COLOR,
                      },
                    },
                  ],
                },
                {
                  values: [
                    { userEnteredValue: { stringValue: "@bob" } },
                    {},
                    {},
                    {
                      userEnteredValue: { numberValue: 3_000 },
                      userEnteredFormat: {
                        backgroundColor: PENDING_SHARE_COLOR,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    readPayoutSpreadsheet.mockResolvedValue(spreadsheet);

    await expect(
      getPayoutStats({ worksheet: "Guild 2026", amount: "pending" }),
    ).resolves.toMatchObject({
      overall: { amount: 5_500, joinedRuns: 1, totalRuns: 1 },
      categories: [
        {
          name: "Others",
          emoji: "💀",
          amount: 5_500,
          joinedRuns: 1,
          totalRuns: 1,
        },
      ],
    });
  });

  it("returns zero standing and an empty ranking when no run cells are populated", async () => {
    const spreadsheet = buildSpreadsheet();
    const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
    rows[4]!.values![5] = {};
    for (const column of [5, 6, 7, 8]) {
      rows[9]!.values![column] = {};
      rows[10]!.values![column] = {};
    }
    readPayoutSpreadsheet.mockResolvedValue(spreadsheet);

    await expect(
      getPayoutStats({
        worksheet: "Guild 2026",
        amount: "pending",
        discordTag: "@missing-player",
        includeRanking: true,
      }),
    ).resolves.toMatchObject({
      overall: {
        amount: 0,
        joinedRuns: 0,
        totalRuns: 3,
        personalStanding: {
          amount: 0,
          impactPercent: 0,
          rank: 1,
          playerCount: 3,
        },
      },
      ranking: [],
    });
  });

  it("uses a configured Others category when no run type matches", async () => {
    const configuredOthers: InstanceType = {
      name: "Others",
      keywords: [],
      emoji: "📦",
    };

    await expect(
      getPayoutStats({
        worksheet: "Guild 2026",
        amount: "pending",
        instanceTypes: [...instanceTypes, configuredOthers],
      }),
    ).resolves.toMatchObject({
      categories: expect.arrayContaining([
        expect.objectContaining({ name: "Others", emoji: "📦" }),
      ]),
    });
  });

  it("sorts equal Ranking amounts by Discord tag and shares their rank", async () => {
    const spreadsheet = buildSpreadsheet();
    const rows = spreadsheet.sheets![0]!.data![0]!.rowData!;
    rows[9]!.values![5] = amountCell(10_000, PENDING_SHARE_COLOR);
    rows[10]!.values![5] = amountCell(10_000, PENDING_SHARE_COLOR);
    for (const column of [6, 7, 8]) {
      rows[9]!.values![column] = {};
      rows[10]!.values![column] = {};
    }
    readPayoutSpreadsheet.mockResolvedValue(spreadsheet);

    const stats = await getPayoutStats({
      worksheet: "Guild 2026",
      amount: "pending",
      includeRanking: true,
    });

    expect(stats.ranking?.slice(0, 2)).toMatchObject([
      { discordName: "alice", amount: 10_000, rank: 1 },
      { discordName: "bob", amount: 10_000, rank: 1 },
    ]);
  });

  it("handles grid blocks without row or cell arrays", async () => {
    readPayoutSpreadsheet.mockResolvedValue({
      sheets: [
        {
          properties: { title: "Guild 2026" },
          data: [{}, { rowData: [{}] }],
        },
      ],
    });

    await expect(
      getPayoutStats({ worksheet: "Guild 2026", amount: "pending" }),
    ).rejects.toThrow("run-title row is not configured correctly");
  });
});
