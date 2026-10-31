export const isExportRosterContinuation = (content: string): boolean =>
  content.startsWith("**Payout roster continued:**\n") ||
  /^(?:\*\*Party \d+:\*\*|\d{2,}: .+ - <@!?\d+>)/.test(content);

/** Extracts roster mentions only, excluding starter metadata and bot confirmations. */
export const getExportRosterUserIds = (
  contents: readonly string[],
): string[] => {
  const roster = contents
    .filter(
      (content, index) => index === 0 || isExportRosterContinuation(content),
    )
    .map((content) => content.split(/^Participants: \*\*\d+\*\*/m)[0] ?? "")
    .join("\n");
  return [
    ...new Set(
      Array.from(roster.matchAll(/<@!?(\d+)>/g), (match) => match[1]!),
    ),
  ];
};
