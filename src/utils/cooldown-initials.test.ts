import { describe, expect, test } from "@jest/globals";
import type { InstanceType } from "../constants/cooldowns.js";
import { addMissingCooldownInitials } from "./cooldown-initials.js";

const buildType = (keywords: string[], initials?: string): InstanceType => ({
  name: "Test Instance",
  keywords,
  maxAttempts: 1,
  emoji: "x",
  ...(initials !== undefined ? { initials } : {}),
});

describe("cooldown initials inference", () => {
  test.each([
    { keywords: ["ET", "Endless Tower"], expected: "ET" },
    { keywords: ["Endless Tower", " ET ", "TWR"], expected: "ET" },
    { keywords: ["Test"], expected: "Test" },
    { keywords: ["", "  ", "HTF"], expected: "HTF" },
    { keywords: ["Wolfchev", "Wolfchev's Laboratory"], expected: undefined },
    { keywords: [], expected: undefined },
    { keywords: ["\u{1F525}".repeat(4)], expected: "\u{1F525}".repeat(4) },
    { keywords: ["\u{1F525}".repeat(5)], expected: undefined },
  ])(
    "uses the first qualifying keyword from $keywords",
    ({ keywords, expected }) => {
      const type = buildType(keywords);
      const original = structuredClone(type);
      const result = addMissingCooldownInitials([type]);
      expect(result.types[0]?.initials).toBe(expected);
      expect(result.changes).toEqual(
        expected === undefined
          ? []
          : [{ name: "Test Instance", initials: expected }],
      );
      expect(type).toEqual(original);
      if (expected === undefined)
        expect(result.types[0]).not.toHaveProperty("initials");
    },
  );

  test.each(["CUSTOM", ""])("preserves existing initials '%s'", (initials) => {
    const result = addMissingCooldownInitials([buildType(["ET"], initials)]);
    expect(result.types[0]?.initials).toBe(initials);
    expect(result.changes).toEqual([]);
  });

  test("handles empty input", () => {
    expect(addMissingCooldownInitials([])).toEqual({ types: [], changes: [] });
  });

  test("preserves metadata and is idempotent for previously inferred entries", () => {
    const original = buildType(["Long Name", "EC"]);
    const first = addMissingCooldownInitials([original]);
    expect(first.types).toEqual([{ ...original, initials: "EC" }]);
    expect(addMissingCooldownInitials(first.types)).toEqual({
      types: first.types,
      changes: [],
    });
  });
});
