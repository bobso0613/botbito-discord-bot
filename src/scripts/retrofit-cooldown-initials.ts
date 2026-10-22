import { randomUUID } from "node:crypto";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { InstanceType } from "../constants/cooldowns.js";
import { addMissingCooldownInitials } from "../utils/cooldown-initials.js";

/** Keeps the migration's existing programmatic helper export available to callers. */
export { addMissingCooldownInitials } from "../utils/cooldown-initials.js";

/**
 * Plans all guild JSON changes before writing, then backs up and atomically replaces changed files.
 * @param directory Directory containing per-guild settings JSON files.
 * @param dryRun Report changes without creating backups or updating files.
 * @returns Paths and inferred initials for files that need changes; repeated migrations are no-ops.
 */
export const retrofitGuildCooldownInitials = async (
  directory: string,
  dryRun = false,
) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const plans = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const path = resolve(directory, entry.name);
        const source = await readFile(path, "utf8");
        const settings = JSON.parse(source) as {
          cooldownInstanceTypes?: InstanceType[];
        };
        const { types, changes } = addMissingCooldownInitials(
          settings.cooldownInstanceTypes ?? [],
        );
        return { path, source, settings, types, changes };
      }),
  );
  const changed = plans.filter((plan) => plan.changes.length > 0);
  if (!dryRun) {
    await Promise.all(
      changed.map(async (plan) => {
        const backupPath = `${plan.path}.initials.bak`;
        try {
          await writeFile(backupPath, plan.source, {
            encoding: "utf8",
            flag: "wx",
          });
        } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        const temporaryPath = `${plan.path}.${randomUUID()}.tmp`;
        const settings = {
          ...plan.settings,
          cooldownInstanceTypes: plan.types,
        };
        await writeFile(
          temporaryPath,
          `${JSON.stringify(settings, null, 2)}\n`,
          "utf8",
        );
        await rename(temporaryPath, plan.path);
      }),
    );
  }
  return changed.map(({ path, changes }) => ({ path, changes }));
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const directory = fileURLToPath(
    new URL("../../private/guild-settings", import.meta.url),
  );
  const dryRun = process.argv.includes("--dry-run");
  try {
    const results = await retrofitGuildCooldownInitials(directory, dryRun);
    for (const result of results) {
      const details = result.changes
        .map(({ name, initials }) => `${name}=${initials}`)
        .join(", ");
      console.log(
        `${dryRun ? "Would update" : "Updated"} ${result.path}: ${details}`,
      );
    }
    console.log(
      `${dryRun ? "Would update" : "Updated"} ${results.length} guild settings file(s).`,
    );
  } catch (error) {
    console.error("Could not retrofit cooldown initials:", error);
    process.exitCode = 1;
  }
}
