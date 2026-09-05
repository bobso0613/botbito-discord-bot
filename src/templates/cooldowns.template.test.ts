import { describe, expect, it } from "@jest/globals";
import { COOLDOWN_INSTANCE_TYPES } from "../constants/cooldowns.js";
import { formatCooldownEntry } from "./cooldowns.template.js";

describe("Cooldowns Template", () => {
  describe("formatCooldownEntry", () => {
    it("should format Endless Tower correctly", () => {
      const et = COOLDOWN_INSTANCE_TYPES.find(
        (t) => t.name === "Endless Tower",
      );
      const result = formatCooldownEntry(et ?? null, 2);
      expect(result).toBe("🪜 Endless Tower - **2** out of **3**");
    });

    it("should format Eternal Bastion correctly", () => {
      const eb = COOLDOWN_INSTANCE_TYPES.find(
        (t) => t.name === "Eternal Bastion",
      );
      const result = formatCooldownEntry(eb ?? null, 1);
      expect(result).toBe("🔥 Eternal Bastion - **1** out of **2**");
    });

    it("should format Others correctly", () => {
      const others = COOLDOWN_INSTANCE_TYPES.find((t) => t.name === "Others");
      const result = formatCooldownEntry(others ?? null, 5);
      expect(result).toBe("💀 Others - **5**");
    });

    it("should handle null instance type as Others", () => {
      const result = formatCooldownEntry(null, 3);
      expect(result).toBe("💀 Others - **3**");
    });

    it("should use bold for all numbers", () => {
      const et = COOLDOWN_INSTANCE_TYPES.find(
        (t) => t.name === "Endless Tower",
      );
      const result = formatCooldownEntry(et ?? null, 3);
      expect(result).toContain("**3**");
      expect(result).toContain("**3**"); // appears twice
    });

    it("should include emoji for all instance types", () => {
      for (const instanceType of COOLDOWN_INSTANCE_TYPES.slice(0, -1)) {
        // exclude Others
        const result = formatCooldownEntry(instanceType, 1);
        expect(result).toContain(instanceType.emoji);
      }
    });
  });
});
