import { describe, expect, it, jest } from "@jest/globals";
import { Collection } from "discord.js";
import {
  createEmptySlots,
  ExpiringMap,
  formatNewRunDate,
  formatSlotLabel,
  getDefaultRoster,
  getGmtOffset,
  getInvokingUserSlot,
  getRosterPrompt,
  isUserInRosterOrOrganizer,
  mergeActionNotices,
  normalizeRosterDisplayName,
  parseNewRunTimestamp,
  parseRoster,
  parseRosterWithPartySizes,
  parseServerTimezone,
  parseTimeShift,
  pickRandomOpenSlot,
  resolveRosterSignupUserIds,
} from "./signup-sheet.js";
import type { SignupSheet, SignupSlot } from "../types/signup-sheet.js";

const buildSlot = (overrides: Partial<SignupSlot> = {}): SignupSlot => ({
  number: 1,
  role: "Tank",
  signupUserId: null,
  signupDisplayName: null,
  charNote: null,
  ...overrides,
});

const buildSheet = (slots: SignupSlot[]): SignupSheet => ({
  guildId: "guild-1",
  channelId: "channel-1",
  title: "Test Run",
  organizerName: "Organizer",
  organizerAvatarUrl: "https://example.com/organizer.png",
  partySizes: [slots.length],
  slots,
  reserves: [],
  notes: null,
  thumbnailUrl: null,
  color: null,
  instanceType: null,
  timestamp: null,
  scheduleTimezone: null,
  serverTimezone: null,
});

describe("signup-sheet utils", () => {
  describe("parseServerTimezone", () => {
    it("returns null for a blank value", () => {
      expect(parseServerTimezone("  ")).toBeNull();
    });

    it("returns GMT for a bare GMT value", () => {
      expect(parseServerTimezone("gmt")).toBe("GMT");
    });

    it("normalizes a positive offset", () => {
      expect(parseServerTimezone("gmt+8")).toBe("GMT+8");
    });

    it("normalizes a negative offset", () => {
      expect(parseServerTimezone("GMT-5")).toBe("GMT-5");
    });

    it("returns undefined for an out-of-range offset", () => {
      expect(parseServerTimezone("GMT+15")).toBeUndefined();
    });

    it("returns undefined for an invalid format", () => {
      expect(parseServerTimezone("not-a-timezone")).toBeUndefined();
    });
  });

  describe("getGmtOffset", () => {
    it("returns 0 for GMT", () => {
      expect(getGmtOffset("GMT")).toBe(0);
    });

    it("returns the numeric offset for GMT+n/GMT-n", () => {
      expect(getGmtOffset("GMT+8")).toBe(8);
      expect(getGmtOffset("GMT-5")).toBe(-5);
    });
  });

  describe("parseNewRunTimestamp", () => {
    it("returns null for a malformed value", () => {
      expect(parseNewRunTimestamp("not a date")).toBeNull();
    });

    it("returns null for an invalid calendar date", () => {
      expect(parseNewRunTimestamp("31/02 20:00 GMT+8")).toBeNull();
    });

    it("parses a valid date/time and timezone", () => {
      const result = parseNewRunTimestamp("25/12 20:00 GMT+8");
      expect(result).not.toBeNull();
      expect(result?.scheduleTimezone).toBe("GMT+8");
      expect(Number.isInteger(result?.timestamp)).toBe(true);
    });
  });

  describe("formatNewRunDate", () => {
    it("returns an empty string for a null timestamp", () => {
      expect(formatNewRunDate(null, "GMT")).toBe("");
    });

    it("round-trips through parseNewRunTimestamp", () => {
      const parsed = parseNewRunTimestamp("25/12 20:00 GMT+8");
      expect(parsed).not.toBeNull();
      expect(
        formatNewRunDate(parsed!.timestamp, parsed!.scheduleTimezone),
      ).toBe("25/12 20:00 GMT+8");
    });
  });

  describe("createEmptySlots", () => {
    it("numbers slots continuously across party sizes", () => {
      const slots = createEmptySlots([2, 1]);
      expect(slots.map((slot) => slot.number)).toEqual([1, 2, 3]);
      expect(slots.every((slot) => slot.signupUserId === null)).toBe(true);
    });
  });

  describe("getDefaultRoster / parseRoster round-trip", () => {
    it("renders and parses party headers with their size breakdown", () => {
      const slots = [
        buildSlot({ number: 1, role: "Tank" }),
        buildSlot({ number: 2, role: "Healer" }),
        buildSlot({ number: 3, role: "DPS" }),
      ];
      const rosterText = getDefaultRoster(slots, [2, 1]);

      expect(rosterText).toContain("Party 1:\n01: Tank -");
      expect(rosterText).toContain("Party 2:\n03: DPS -");
      const parsed = parseRosterWithPartySizes(rosterText, slots);

      expect(parsed?.partySizes).toEqual([2, 1]);
      expect(parsed?.slots).toHaveLength(3);
    });

    it("accepts a changed party breakdown from roster headers", () => {
      const slots = [
        buildSlot({ number: 1, role: "Tank" }),
        buildSlot({ number: 2, role: "Healer" }),
        buildSlot({ number: 3, role: "DPS" }),
      ];
      const parsed = parseRosterWithPartySizes(
        "Party 1:\n01: Tank -\nParty 2:\n02: Healer -\n03: DPS -",
        slots,
      );

      expect(parsed?.partySizes).toEqual([1, 2]);
    });

    it("keeps empty roster slots from gaining an extra dash", () => {
      const slots = [buildSlot({ number: 1, role: "Tank" })];
      const rosterText = getDefaultRoster(slots);
      const parsed = parseRoster(rosterText, slots);

      expect(parsed?.[0]).toMatchObject({
        role: "Tank",
        signupDisplayName: null,
      });
      expect(getDefaultRoster(parsed!)).toBe("01: Tank -");
    });

    it("parses back the roster text it generated, including signups and notes", () => {
      const slots = [
        buildSlot({ number: 1, role: "High Wizard", isTbc: true }),
        buildSlot({
          number: 2,
          role: "SL (Link + Ka-Buff)",
          signupUserId: "user-1",
          signupDisplayName: "charName",
          charNote: "alt",
          isTbc: true,
        }),
      ];
      const rosterText = getDefaultRoster(slots);
      expect(rosterText).toContain("01: High Wizard - ❓");
      expect(rosterText).toContain(
        "02: SL (Link + Ka-Buff) - charName (alt) ❓",
      );
      const parsed = parseRoster(rosterText, slots);
      expect(parsed).not.toBeNull();
      expect(parsed?.[0]).toMatchObject({
        role: "High Wizard",
        signupUserId: null,
        isTbc: true,
      });
      expect(parsed?.[1]).toMatchObject({
        role: "SL (Link + Ka-Buff)",
        signupDisplayName: "charName",
        signupUserId: "user-1",
        charNote: "alt",
        isTbc: true,
      });
    });

    it("parses TBC emoji on user with no note", () => {
      const slots = [buildSlot({ number: 1, role: "Tank" })];
      const parsed = parseRoster("01: Tank - Alice ❓", slots);
      expect(parsed?.[0]).toMatchObject({
        role: "Tank",
        signupDisplayName: "Alice",
        charNote: null,
        isTbc: true,
      });
    });

    it("returns null when the line count doesn't match the slot count", () => {
      expect(
        parseRoster("01: Tank -", [buildSlot(), buildSlot({ number: 2 })]),
      ).toBeNull();
    });

    it("keeps mid-word dashes in the char name intact", () => {
      const slots = [buildSlot({ number: 1, role: "Melee" })];
      const parsed = parseRoster("01: Melee - charName-with-dash", slots);
      expect(parsed?.[0]?.signupDisplayName).toBe("charName-with-dash");
    });
  });

  describe("getRosterPrompt", () => {
    it("includes the default roster text and the reserve hint", () => {
      const prompt = getRosterPrompt([buildSlot()], [1]);
      expect(prompt).toContain("01: Tank -");
      expect(prompt).toContain("Party 1:");
      expect(prompt).toContain("To change the number of parties");
      expect(prompt).toContain("/add input=reserve");
    });
  });

  describe("normalizeRosterDisplayName", () => {
    it("strips surrounding bold markdown", () => {
      expect(normalizeRosterDisplayName("**Alice**")).toBe("Alice");
    });

    it("returns null for blank input", () => {
      expect(normalizeRosterDisplayName("   ")).toBeNull();
      expect(normalizeRosterDisplayName(null)).toBeNull();
    });
  });

  describe("resolveRosterSignupUserIds", () => {
    it("resolves a single unambiguous member match", async () => {
      const slots = [
        buildSlot({ signupDisplayName: "Alice", signupUserId: null }),
      ];
      const fetch = jest
        .fn<() => Promise<Collection<string, unknown>>>()
        .mockResolvedValue(
          new Collection([
            [
              "member-1",
              {
                id: "member-1",
                displayName: "Alice",
                user: {
                  username: "alice",
                  displayName: "Alice",
                  globalName: null,
                },
              },
            ],
          ]),
        );
      const message = {
        guild: { members: { fetch } },
      } as never;

      await resolveRosterSignupUserIds(slots, message);

      expect(slots[0]?.signupUserId).toBe("member-1");
    });

    it("leaves signupUserId null when there is no guild", async () => {
      const slots = [buildSlot({ signupDisplayName: "Alice" })];
      await resolveRosterSignupUserIds(slots, { guild: null } as never);
      expect(slots[0]?.signupUserId).toBeNull();
    });
  });

  describe("getInvokingUserSlot", () => {
    it("finds the slot the given user is signed up in", () => {
      const sheet = buildSheet([
        buildSlot({ number: 1, signupUserId: "user-1" }),
        buildSlot({ number: 2 }),
      ]);
      expect(getInvokingUserSlot(sheet, "user-1")?.number).toBe(1);
      expect(getInvokingUserSlot(sheet, "user-2")).toBeUndefined();
    });
  });

  describe("formatSlotLabel", () => {
    it("pads the slot number and appends the role", () => {
      expect(formatSlotLabel({ number: 5, role: "Tank" })).toBe("05: Tank");
    });
  });

  describe("pickRandomOpenSlot", () => {
    it("does not rely on Math.random for slot selection", () => {
      const originalRandom = Math.random;
      const restore = () => {
        Math.random = originalRandom;
      };
      Math.random = () => {
        throw new Error("Math.random should not be used");
      };

      try {
        const sheet = buildSheet([
          buildSlot({ number: 1, signupUserId: null }),
          buildSlot({ number: 2, signupUserId: null }),
        ]);
        expect(pickRandomOpenSlot(sheet)).not.toBeNull();
      } finally {
        restore();
      }
    });
  });

  describe("pickRandomOpenSlot", () => {
    it("returns null when every slot is occupied", () => {
      const sheet = buildSheet([buildSlot({ signupUserId: "user-1" })]);
      expect(pickRandomOpenSlot(sheet)).toBeNull();
    });

    it("only picks from open slots", () => {
      const sheet = buildSheet([
        buildSlot({ number: 1, signupUserId: "user-1" }),
        buildSlot({ number: 2 }),
      ]);
      expect(pickRandomOpenSlot(sheet)?.number).toBe(2);
    });
  });

  describe("mergeActionNotices", () => {
    it("groups labels by user", () => {
      const merged = mergeActionNotices([
        { userId: "user-1", label: "01: Tank" },
        { userId: "user-2", label: "02: DPS" },
        { userId: "user-1", label: "Reserve" },
      ]);
      expect(merged).toEqual([
        { userId: "user-1", labels: ["01: Tank", "Reserve"] },
        { userId: "user-2", labels: ["02: DPS"] },
      ]);
    });
  });

  describe("parseTimeShift", () => {
    it("returns null for an invalid value", () => {
      expect(parseTimeShift("not a shift")).toBeNull();
    });

    it("parses next/last keywords", () => {
      expect(parseTimeShift("next week")).toBe(604800);
      expect(parseTimeShift("last hour")).toBe(-3600);
    });

    it("parses fractional amounts in 0.5 increments", () => {
      expect(parseTimeShift("1.5 days")).toBe(1.5 * 86400);
    });
  });

  describe("isUserInRosterOrOrganizer", () => {
    it("returns true when the user matches the organizerId", () => {
      const sheet = buildSheet([]);
      sheet.organizerId = "organizer-123";
      sheet.organizerName = "Alice";
      expect(
        isUserInRosterOrOrganizer(sheet, {
          id: "organizer-123",
          displayName: "DifferentName",
        }),
      ).toBe(true);
    });

    it("returns true when the user matches the organizerName", () => {
      const sheet = buildSheet([]);
      sheet.organizerName = "Alice";
      expect(
        isUserInRosterOrOrganizer(sheet, {
          id: "user-9",
          displayName: "Alice",
        }),
      ).toBe(true);
    });

    it("returns true when the user is signed up in a party slot", () => {
      const sheet = buildSheet([
        buildSlot({ signupUserId: "user-1", signupDisplayName: "Bob" }),
      ]);
      expect(
        isUserInRosterOrOrganizer(sheet, {
          id: "user-1",
          displayName: "Invoker",
        }),
      ).toBe(true);
    });

    it("returns true when the user is in reserves", () => {
      const sheet = buildSheet([]);
      sheet.reserves = [
        { userId: "user-3", displayName: "Charlie", charNote: null },
      ];
      expect(
        isUserInRosterOrOrganizer(sheet, {
          id: "user-3",
          displayName: "Invoker",
        }),
      ).toBe(true);
    });

    it("returns false when the user is not organizer, slot, or reserve", () => {
      const sheet = buildSheet([
        buildSlot({ signupUserId: "user-1", signupDisplayName: "Bob" }),
      ]);
      sheet.organizerName = "Alice";
      expect(
        isUserInRosterOrOrganizer(sheet, {
          id: "user-99",
          displayName: "Stranger",
        }),
      ).toBe(false);
    });
  });

  describe("ExpiringMap", () => {
    it("stores and retrieves non-expired entries", () => {
      const map = new ExpiringMap<string, string>(5000);
      map.set("key-1", "val-1");
      expect(map.get("key-1")).toBe("val-1");
      expect(map.has("key-1")).toBe(true);
      expect(map.size).toBe(1);
    });

    it("expires entries after ttl", () => {
      const map = new ExpiringMap<string, string>(-100);
      map.set("key-1", "val-1");
      expect(map.get("key-1")).toBeUndefined();
      expect(map.has("key-1")).toBe(false);
      expect(map.size).toBe(0);
    });

    it("handles null values correctly", () => {
      const map = new ExpiringMap<string, string | null>(5000);
      map.set("key-null", null);
      expect(map.get("key-null")).toBeNull();
      expect(map.has("key-null")).toBe(true);
    });

    it("deletes and clears entries", () => {
      const map = new ExpiringMap<string, string>(5000);
      map.set("a", "1");
      map.set("b", "2");
      map.delete("a");
      expect(map.has("a")).toBe(false);
      expect(map.has("b")).toBe(true);
      map.clear();
      expect(map.size).toBe(0);
    });
  });
});
