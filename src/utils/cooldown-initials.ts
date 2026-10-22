import type { InstanceType } from "../constants/cooldowns.js";

/**
 * Infers only missing initials from the first nonblank keyword of at most four code points.
 * Returns new entries and a change report without mutating inputs or replacing existing initials.
 */
export const addMissingCooldownInitials = (
  types: readonly InstanceType[],
): {
  types: InstanceType[];
  changes: Array<{ name: string; initials: string }>;
} => {
  const changes: Array<{ name: string; initials: string }> = [];
  const updated = types.map((type) => {
    if (Object.hasOwn(type, "initials")) return type;
    const initials = type.keywords
      .map((keyword) => keyword.trim())
      .find((keyword) => keyword.length > 0 && Array.from(keyword).length <= 4);
    if (!initials) return type;
    changes.push({ name: type.name, initials });
    return { ...type, initials };
  });
  return { types: updated, changes };
};
