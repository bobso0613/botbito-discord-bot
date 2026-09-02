import { jest } from "@jest/globals";
import type { SheetRow } from "../types/google-sheets.js";

const readCombinedPayoutSheetRows = jest.fn<() => Promise<SheetRow[]>>();

jest.unstable_mockModule("./google-sheets.service.js", () => ({
  readCombinedPayoutSheetRows,
}));

const { getPayoutDetails, getPayoutSummary } =
  await import("./payout.service.js");

const sheetRows = [
  ["Discord Tag", "guild-a", "", "", "", "guild-b"],
  ["", "Pending", "Share Ready", "Distributed", "", "Share Ready"],
  ["@alice", "100", "200", "300", "", "400"],
  ["@bob", "0", "500", "0", "", "0"],
];

describe("payout service", () => {
  beforeEach(() => {
    readCombinedPayoutSheetRows.mockResolvedValue(sheetRows);
  });

  it("returns one user's payout amounts from the calling guild's columns", async () => {
    await expect(
      getPayoutDetails({ guildId: "guild-a", discordTag: "alice" }),
    ).resolves.toEqual({
      pending: 100,
      shareReady: 200,
      distributed: 300,
      currency: "z",
    });
  });

  it("returns zero balances when the guild or player is not in the sheet", async () => {
    await expect(
      getPayoutDetails({ guildId: "missing", discordTag: "missing" }),
    ).resolves.toEqual({
      pending: 0,
      shareReady: 0,
      distributed: 0,
      currency: "z",
    });
  });

  it("returns non-zero Share Ready payouts and their total for a guild", async () => {
    await expect(getPayoutSummary("guild-a")).resolves.toEqual({
      shareReadyPayouts: [
        { displayName: "@bob", discordTag: "@bob", amount: 500 },
        { displayName: "@alice", discordTag: "@alice", amount: 200 },
      ],
      totalShareReady: 700,
      currency: "z",
    });
  });

  it("sorts payouts by name in ascending order when requested", async () => {
    await expect(getPayoutSummary("guild-a", "name", "asc")).resolves.toEqual(
      expect.objectContaining({
        shareReadyPayouts: [
          { displayName: "@alice", discordTag: "@alice", amount: 200 },
          { displayName: "@bob", discordTag: "@bob", amount: 500 },
        ],
      }),
    );
  });
});
