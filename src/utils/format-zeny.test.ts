import { formatZeny } from "./format-zeny.js";

describe("formatZeny", () => {
  it("formats a zeny amount with separators and inline-code Markdown", () => {
    expect(formatZeny(123456789)).toBe("`123,456,789 z`");
  });
});
