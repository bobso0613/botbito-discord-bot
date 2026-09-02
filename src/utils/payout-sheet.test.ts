import {
  findGuildStartColumn,
  findPayoutRow,
  parseZeny,
} from "./payout-sheet.js";

describe("payout sheet utilities", () => {
  it("parses formatted zeny amounts and treats blank or invalid values as zero", () => {
    expect(parseZeny("33,305,920")).toBe(33305920);
    expect(parseZeny("-3,929,494 z")).toBe(-3929494);
    expect(parseZeny("")).toBe(0);
    expect(parseZeny(undefined)).toBe(0);
    expect(parseZeny("not an amount")).toBe(0);
  });

  it("finds a guild column after trimming header values", () => {
    expect(findGuildStartColumn(["", " 123 ", "456"], "123")).toBe(1);
    expect(findGuildStartColumn(["", "123"], "999")).toBe(-1);
  });

  it("matches the first-column Discord tag case-insensitively with an optional at sign", () => {
    const rows = [
      ["@BotBito", "100"],
      ["@someone", "200"],
    ];

    expect(findPayoutRow(rows, "botbito")).toEqual(["@BotBito", "100"]);
    expect(findPayoutRow(rows, "@SOMEONE")).toEqual(["@someone", "200"]);
    expect(findPayoutRow(rows, "missing")).toBeUndefined();
  });
});
