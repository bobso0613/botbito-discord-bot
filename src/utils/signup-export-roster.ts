export const payoutRosterContinuationPrefix =
  "**Payout roster continued:**\n";
export const payoutRosterLineContinuationPrefix =
  "**Payout roster continued (same line):**\n";

export const isExportRosterContinuation = (content: string): boolean =>
  content.startsWith(payoutRosterContinuationPrefix) ||
  content.startsWith(payoutRosterLineContinuationPrefix) ||
  /^(?:\*\*Party \d+:\*\*|\d{2,}: .+ - <@!?\d+>)/.test(content);

const getRosterContent = (content: string): string => {
  if (content.startsWith(payoutRosterLineContinuationPrefix)) {
    return content.slice(payoutRosterLineContinuationPrefix.length);
  }
  if (content.startsWith(payoutRosterContinuationPrefix)) {
    return content.slice(payoutRosterContinuationPrefix.length);
  }
  return content;
};

/** Reassembles roster messages while preserving lines split across continuations. */
export const joinExportRosterContents = (
  contents: readonly string[],
): string =>
  contents.reduce((roster, content, index) => {
    const continuesLine =
      index > 0 && content.startsWith(payoutRosterLineContinuationPrefix);
    const separator = index > 0 && !continuesLine ? "\n" : "";
    return `${roster}${separator}${getRosterContent(content)}`;
  }, "");

/** Extracts only participant mentions from numbered roster slots. */
export const getRosterParticipantUserIds = (roster: string): string[] =>
  [
    ...new Set(
      Array.from(
        roster.matchAll(/^\d{2,}: .*? - <@!?(\d+)>/gm),
        (match) => match[1]!,
      ),
    ),
  ];

/** Extracts participant IDs while excluding notes, metadata, and bot confirmations. */
export const getExportRosterUserIds = (
  contents: readonly string[],
): string[] => {
  const rosterContents = contents
    .filter(
      (content, index) => index === 0 || isExportRosterContinuation(content),
    )
    .map((content) => content.split(/^Participants: \*\*\d+\*\*/m)[0] ?? "");
  return getRosterParticipantUserIds(joinExportRosterContents(rosterContents));
};
