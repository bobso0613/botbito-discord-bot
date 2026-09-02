import { sortShareReadyPayouts } from "./payout-summary.js";

const payouts = [
  { displayName: "Charlie", discordTag: "@charlie", amount: 200 },
  { displayName: "Alice", discordTag: "@alice", amount: 500 },
  { displayName: "Bob", discordTag: "@bob", amount: 500 },
];

describe("sortShareReadyPayouts", () => {
  it("sorts by amount descending and name ascending by default", () => {
    expect(sortShareReadyPayouts(payouts)).toEqual([
      payouts[1],
      payouts[2],
      payouts[0],
    ]);
  });

  it("sorts by amount ascending when requested", () => {
    expect(sortShareReadyPayouts(payouts, "amount", "asc")).toEqual([
      payouts[0],
      payouts[1],
      payouts[2],
    ]);
  });

  it("sorts by name in both directions when requested", () => {
    expect(sortShareReadyPayouts(payouts, "name", "asc")).toEqual([
      payouts[1],
      payouts[2],
      payouts[0],
    ]);
    expect(sortShareReadyPayouts(payouts, "name", "desc")).toEqual([
      payouts[0],
      payouts[2],
      payouts[1],
    ]);
  });

  it("does not mutate the original payout list", () => {
    const original = [...payouts];

    sortShareReadyPayouts(payouts);

    expect(payouts).toEqual(original);
  });
});
