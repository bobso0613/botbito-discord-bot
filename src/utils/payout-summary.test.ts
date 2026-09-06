import { sortPayouts } from "./payout-summary.js";

const payouts = [
  { displayName: "Charlie", discordTag: "@charlie", amount: 200 },
  { displayName: "Alice", discordTag: "@alice", amount: 500 },
  { displayName: "Bob", discordTag: "@bob", amount: 500 },
];

describe("sortPayouts", () => {
  it("sorts by amount descending and name ascending by default", () => {
    expect(sortPayouts(payouts)).toEqual([payouts[1], payouts[2], payouts[0]]);
  });

  it("sorts by amount ascending when requested", () => {
    expect(sortPayouts(payouts, "amount", "asc")).toEqual([
      payouts[0],
      payouts[1],
      payouts[2],
    ]);
  });

  it("sorts by name in both directions when requested", () => {
    expect(sortPayouts(payouts, "name", "asc")).toEqual([
      payouts[1],
      payouts[2],
      payouts[0],
    ]);
    expect(sortPayouts(payouts, "name", "desc")).toEqual([
      payouts[0],
      payouts[2],
      payouts[1],
    ]);
  });

  it("does not mutate the original payout list", () => {
    const original = [...payouts];

    sortPayouts(payouts);

    expect(payouts).toEqual(original);
  });
});
