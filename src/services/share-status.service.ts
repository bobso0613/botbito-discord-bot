import {
  PermissionFlagsBits,
  escapeMarkdown,
  type ChatInputCommandInteraction,
  type ThreadChannel,
} from "discord.js";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import type {
  ShareFinalizationStatus,
  SignupExportFinalization,
  SignupExportHistoryEntry,
} from "../types/signup-export.js";
import type { PayoutSheetMember } from "../types/payout-sheet-export.js";
import {
  canEditShare,
  getSharePost,
} from "../commands/payout-thread.command.js";
import {
  finalizePayoutExport,
  queuePayoutSheetOperation,
} from "./payout-sheet-export.service.js";
import { withSignupExportHistory } from "./signup-export.service.js";
import { buildReadyShareStatusEmbed } from "../templates/payout.template.js";
import type { InteractionContext } from "../types/interaction-context.js";

/** User-facing terminal outcomes supported for payout-share finalization. */
export const shareStatusChoices = [
  { name: "Ready for distribution", value: "ready" },
  { name: "Done (no share)", value: "done-no-share" },
  { name: "Cancelled", value: "cancelled" },
] as const;

const statusLabel = (status: ShareFinalizationStatus): string =>
  shareStatusChoices.find((choice) => choice.value === status)!.name;

const safeError = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 250);

/** Verifies the bot can rename and reply to the payout thread before Sheets is mutated. */
const requireBotPermissions = (
  interaction: ChatInputCommandInteraction,
  thread: ThreadChannel,
): void => {
  const permissions = interaction.guild?.members.me?.permissionsIn(thread.id);
  if (
    !permissions?.has(PermissionFlagsBits.ManageThreads) ||
    !permissions.has(PermissionFlagsBits.SendMessagesInThreads)
  ) {
    throw new Error(
      "The bot needs Manage Threads and Send Messages in Threads in the payout forum before this status can be set.",
    );
  }
};

/** Gets the exported run name and its original calendar date from the title or snapshot. */
const getRunLabel = (
  thread: ThreadChannel,
  snapshotTitle: string,
): { runName: string; date: string } => {
  const title = thread.name.replace(/^[⏳✅❌]\s*/u, "");
  const match = /^(.*) - (\d{2}\/\d{2})(?:\s+.*)?$/.exec(title);
  if (match) return { runName: match[1]!, date: match[2]! };
  const saved = /^(.*)\s+(\d{2}\/\d{2})$/.exec(snapshotTitle);
  return saved
    ? { runName: saved[1]!, date: saved[2]! }
    : { runName: snapshotTitle, date: "the exported date" };
};

/** Builds the Ready notification text using the exported date and actual thread URL. */
const makeDirectMessage = (
  interaction: ChatInputCommandInteraction,
  thread: ThreadChannel,
  snapshotTitle: string,
  displayName: string,
): string => {
  const { runName, date } = getRunLabel(thread, snapshotTitle);
  const invokerName = escapeMarkdown(
    interaction.user.globalName ?? interaction.user.username,
  );
  return [
    `**💰Share Status - ${escapeMarkdown(runName)} - ${date}** - ${escapeMarkdown(displayName)}`,
    `${invokerName} has set ${thread.url} status to **Ready for Distribution**.`,
    "Your shares have been added to your total claimable amount.",
  ].join("\n");
};

/** Splits a public status report into chunks small enough for Discord messages. */
const splitReport = (content: string): string[] => {
  const chunks: string[] = [];
  let chunk = "";
  for (const rawLine of content.split("\n")) {
    let remaining = rawLine;
    while (remaining.length > 1_900) {
      if (chunk) chunks.push(chunk);
      chunks.push(remaining.slice(0, 1_900));
      remaining = remaining.slice(1_900);
      chunk = "";
    }
    const candidate = chunk ? `${chunk}\n${remaining}` : remaining;
    if (candidate.length > 1_900) {
      chunks.push(chunk);
      chunk = remaining;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
};

/** Sends Ready notifications serially, persisting an attempt/result for each participant. */
const deliverReadyMessages = async (
  interaction: ChatInputCommandInteraction,
  thread: ThreadChannel,
  state: SignupExportFinalization,
  participantIds: readonly string[],
  snapshotTitle: string,
  members: readonly PayoutSheetMember[],
  save: () => Promise<void>,
): Promise<void> => {
  const dmDeliveries = (state.dmDeliveries ??= {});
  const memberById = new Map(members.map((member) => [member.userId, member]));
  const shareAmounts = state.shareAmounts ?? {};
  await [...new Set(participantIds)].reduce(async (previous, userId) => {
    await previous;
    if (dmDeliveries[userId]) return;
    dmDeliveries[userId] = "attempting";
    await save();
    try {
      const participant = memberById.get(userId);
      const amounts = shareAmounts[userId];
      if (!participant || !amounts) {
        throw new Error("Saved participant payout amounts are unavailable.");
      }
      const user = await interaction.client.users.fetch(userId);
      const guild = interaction.guild!;
      const embedContext: InteractionContext = {
        userId,
        username: user.username,
        discordTag: participant.discordTag,
        displayName: participant.displayName,
        userAvatarUrl: user.displayAvatarURL(),
        guildId: guild.id,
        guildName: guild.name,
        guildIconUrl: guild.iconURL(),
      };
      const embed = buildReadyShareStatusEmbed(
        embedContext,
        amounts.thisRun,
        amounts.totalUnclaimed,
      );
      await user.send({
        content: makeDirectMessage(
          interaction,
          thread,
          snapshotTitle,
          participant.displayName,
        ),
        embeds: [embed],
        allowedMentions: {
          parse: [],
          users: [DISCORD_SETTINGS.payoutToPingId],
        },
      });
      dmDeliveries[userId] = "sent";
    } catch {
      dmDeliveries[userId] = "failed";
    }
    await save();
  }, Promise.resolve());
};

/** Publishes report chunks once, using the public interaction response for the first chunk. */
const publishReport = async (
  interaction: ChatInputCommandInteraction,
  thread: ThreadChannel,
  state: SignupExportFinalization,
  content: string,
  save: () => Promise<void>,
): Promise<string | null> => {
  state.publicMessages ??= splitReport(content).map((chunk) => ({
    content: chunk,
    status: "pending",
  }));
  await save();
  let editedInteractionReply = false;
  for (const [index, report] of state.publicMessages.entries()) {
    if (report.status === "sent") continue;
    if (report.status !== "pending") {
      return "A public status report may have been partially delivered; inspect the thread before retrying this same status.";
    }
    report.status = "attempting";
    await save();
    try {
      const message =
        index === 0
          ? await interaction.editReply({
              content: report.content,
              allowedMentions: { parse: [] },
            })
          : await thread.send({
              content: report.content,
              allowedMentions: { parse: [] },
            });
      if (index === 0) editedInteractionReply = true;
      report.status = "sent";
      report.messageId = message.id;
      await save();
    } catch (error) {
      report.status = "failed";
      await save();
      return `The public status report could not be confirmed: ${safeError(error)}. Check the thread and publish the result manually.`;
    }
  }
  if (!editedInteractionReply && state.publicMessages[0]?.status === "sent") {
    await interaction.editReply({
      content:
        "This status report was already published. The selected status is unchanged; no notifications were repeated.",
      allowedMentions: { parse: [] },
    });
  }
  return null;
};

/** Builds truthful status and partial-failure text from confirmed sheet and Discord outcomes. */
const buildResultReport = (
  status: ShareFinalizationStatus,
  sheets: SignupExportFinalization["sheets"],
  sheetName: string | undefined,
  columnName: string | undefined,
  titleFailed: boolean,
  dmDeliveries: SignupExportFinalization["dmDeliveries"],
  interruptedDms: readonly string[],
): string => {
  const statusEmoji = status === "cancelled" ? "❌" : "✅";
  const lines = [`**Share status:** ${statusEmoji} ${statusLabel(status)}`];
  const sheetTarget =
    sheetName && columnName
      ? `**${escapeMarkdown(sheetName)} (${escapeMarkdown(columnName)})**`
      : "Google Sheets";
  if (status === "ready" && sheets === "confirmed") {
    lines.push(
      `${sheetTarget} updated successfully. DMs sent to participants.`,
    );
  } else if (status === "ready") {
    lines.push(
      "Google Sheets was not confirmed updated. No participant DMs were sent. The organizer must correct this exact run column manually, then notify participants. Do not retry this status command as a Sheets repair.",
    );
  } else if (status === "done-no-share") {
    lines.push(
      sheets === "confirmed"
        ? `${sheetTarget} updated successfully. Note: No share; no DMs were sent. The organizer must manually adjust amounts and formulas. These amounts may appear claimable until corrected; financial values were not changed.`
        : "Google Sheets was not confirmed updated. This run has no share: the organizer must manually correct the run's amounts, formulas, and status. These amounts may appear claimable until corrected; financial values were not changed automatically.",
    );
  } else {
    lines.push(
      sheets === "confirmed"
        ? `${sheetTarget} removed in the sheet successfully.`
        : "Google Sheets did not confirm removal. The organizer must manually remove the exact column identified by this run's Export ID; no removal is claimed.",
    );
  }
  if (titleFailed) {
    lines.push(
      "The thread title could not be updated. Ask a server manager to replace its leading status icon manually.",
    );
  }
  const failed = Object.entries(dmDeliveries ?? {})
    .filter(([, result]) => result === "failed")
    .map(([userId]) => `<@${userId}>: DM failed.`);
  lines.push(
    ...interruptedDms.map(
      (userId) =>
        `<@${userId}>: DM outcome is uncertain; check before notifying again.`,
    ),
    ...failed,
  );
  return lines.join("\n");
};

/** Validates the managed export, starter ID, roster delivery, and latest Sheets sync. */
const validateFinalizationEntry = (
  entry: SignupExportHistoryEntry,
  guildId: string,
  starterContent: string,
): string => {
  const snapshot = entry.sheetsSync;
  if (!snapshot) {
    throw new Error(
      "This legacy or unmanaged export cannot be finalized automatically. Update Google Sheets and notify participants manually.",
    );
  }
  const worksheet = DISCORD_SETTINGS.payoutWorksheets?.[guildId];
  if (!worksheet) {
    throw new Error(
      "This export has no configured payout worksheet. Update Google Sheets and notify participants manually.",
    );
  }
  const savedIdentifier = starterContent.trimEnd().split("\n").at(-1);
  if (savedIdentifier !== snapshot.identifier) {
    throw new Error(
      "The starter post Export ID does not match saved Sheets history; no changes were made.",
    );
  }
  if (snapshot.deliveryIncomplete) {
    throw new Error(
      "The exported roster was not fully delivered. Repair it with `/changeshareparticipants` and successfully sync with `/export` first.",
    );
  }
  if (snapshot.status !== "synced") {
    throw new Error(
      "This managed export has not successfully synchronized. Run `/export` and wait for a confirmed Sheets sync before setting its status.",
    );
  }
  return worksheet;
};

/** Reuses a saved status or persists a new selection only for a pending hourglass thread. */
const getOrStartFinalization = async (
  entry: SignupExportHistoryEntry,
  thread: ThreadChannel,
  status: ShareFinalizationStatus,
  save: () => Promise<void>,
): Promise<SignupExportFinalization> => {
  const state = entry.shareFinalization;
  if (state?.completed) {
    throw new Error(
      `This run has already been finalized as ${statusLabel(state.status)}; status and notifications cannot be repeated.`,
    );
  }
  if (state && state.status !== status) {
    throw new Error(
      `Finalization already selected ${statusLabel(state.status)}. Resume only that status; it cannot be changed.`,
    );
  }
  if (state) return state;
  if (!thread.name.startsWith("⏳")) {
    throw new Error(
      "A new status can only be set on a pending thread whose title starts with the hourglass icon.",
    );
  }
  const initialState: SignupExportFinalization = {
    status,
    sheets: "pending",
  };
  entry.shareFinalization = initialState;
  await save();
  return initialState;
};

/** Runs the Sheets finalization once and saves its confirmed column labels and evaluated amounts. */
const finalizeSheets = async (
  state: SignupExportFinalization,
  worksheet: string,
  guildId: string,
  threadId: string,
  snapshot: NonNullable<SignupExportHistoryEntry["sheetsSync"]>,
  status: ShareFinalizationStatus,
  save: () => Promise<void>,
): Promise<string | null> => {
  if (state.sheets === "in-progress") {
    state.sheets = "manual";
    await save();
    return "A previous Sheets operation was interrupted and will not be repeated; inspect and correct the run manually.";
  }
  if (state.sheets === "manual") {
    return "Google Sheets was not confirmed; manual correction is required and this command will not repeat the Sheets operation.";
  }
  if (state.sheets !== "pending") return null;

  state.sheets = "in-progress";
  await save();
  try {
    const result = await finalizePayoutExport(
      worksheet,
      guildId,
      threadId,
      snapshot,
      status,
    );
    state.sheetName = result.sheetName;
    state.columnName = result.columnName;
    if (status === "ready") {
      state.shareAmounts = Object.fromEntries(
        result.shareAmounts.map(({ userId, ...share }) => [userId, share]),
      );
    }
    state.sheets = "confirmed";
    await save();
    return null;
  } catch (error) {
    state.sheets = "manual";
    const notice = `Google Sheets was not confirmed (${safeError(error)}); manual correction is required.`;
    await save();
    return notice;
  }
};

/** Replaces only the leading pending title icon and persists confirmation. */
const updateThreadTitle = async (
  thread: ThreadChannel,
  state: SignupExportFinalization,
  status: ShareFinalizationStatus,
  save: () => Promise<void>,
): Promise<boolean> => {
  if (state.titleUpdated) return false;
  try {
    const titleIcon = status === "cancelled" ? "❌" : "✅";
    const desiredTitle = thread.name.startsWith("⏳")
      ? `${titleIcon}${thread.name.slice("⏳".length)}`
      : thread.name;
    if (desiredTitle !== thread.name) await thread.setName(desiredTitle);
    state.titleUpdated = true;
    await save();
    return false;
  } catch {
    return true;
  }
};

/** Returns participants whose DM attempt was interrupted before a result was saved. */
const getInterruptedDmIds = (
  deliveries: SignupExportFinalization["dmDeliveries"],
): string[] =>
  Object.entries(deliveries ?? {})
    .filter(([, result]) => result === "attempting")
    .map(([userId]) => userId);

const lockThread = async (
  thread: ThreadChannel,
  state: SignupExportFinalization,
  save: () => Promise<void>,
): Promise<string | null> => {
  if (state.locked) return null;
  try {
    await thread.setLocked(true);
    state.locked = true;
    await save();
    return null;
  } catch (error) {
    return `The result was published, but the thread could not be locked (${safeError(error)}). Ask a server manager to lock it.`;
  }
};
/** Locks the thread and returns actionable text when Discord rejects the operation. */

const finalizeStatus = async (
  interaction: ChatInputCommandInteraction,
  status: ShareFinalizationStatus,
): Promise<void> => {
  const guildId = interaction.guildId!;
  const { thread, starter } = await getSharePost(
    interaction.guildId,
    interaction.guild,
    interaction.channel,
    interaction.client.user?.id ?? null,
  );
  requireBotPermissions(interaction, thread);
  /** Runs authorization, Sheets finalization, participant delivery, reporting, and locking. */

  return withSignupExportHistory(guildId, thread.id, async (entry, save) => {
    if (
      !canEditShare(
        entry.organizerId ?? null,
        interaction.user.id,
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ??
          false,
      )
    ) {
      throw new Error(
        "Only the original organizer or a member with Manage Server permission can set this payout status.",
      );
    }
    const worksheet = validateFinalizationEntry(
      entry,
      guildId,
      starter.content,
    );
    const snapshot = entry.sheetsSync!;
    const state = await getOrStartFinalization(entry, thread, status, save);
    await finalizeSheets(
      state,
      worksheet,
      guildId,
      thread.id,
      snapshot,
      status,
      save,
    );
    const titleFailed = await updateThreadTitle(thread, state, status, save);

    if (status === "ready" && state.sheets === "confirmed") {
      await deliverReadyMessages(
        interaction,
        thread,
        state,
        entry.participantUserIds ?? snapshot.userIds,
        snapshot.title,
        snapshot.members ?? snapshot.syncedMembers ?? [],
        save,
      );
    }
    const report = buildResultReport(
      status,
      state.sheets,
      state.sheetName,
      state.columnName,
      titleFailed,
      state.dmDeliveries,
      getInterruptedDmIds(state.dmDeliveries),
    );
    const publicFailure = await publishReport(
      interaction,
      thread,
      state,
      report,
      save,
    );
    const lockFailure = await lockThread(thread, state, save);
    if (publicFailure || lockFailure) {
      await thread.send({
        content: [publicFailure, lockFailure].filter(Boolean).join("\n"),
        allowedMentions: { parse: [] },
      });
    }
    const reportComplete =
      state.publicMessages?.length &&
      state.publicMessages.every((message) => message.status === "sent");
    state.completed = Boolean(
      state.titleUpdated && reportComplete && state.locked,
    );
    await save();
  });
};

/** Serializes and completes a payout status lifecycle.
 * @param interaction Authorized guild interaction in the payout thread.
 * @param status Immutable terminal outcome selected by the organizer.
 * @returns Completion summary with any manual-action or partial-failure guidance.
 */
export const finalizeShareStatus = (
  interaction: ChatInputCommandInteraction,
  status: ShareFinalizationStatus,
): Promise<void> =>
  queuePayoutSheetOperation(() => finalizeStatus(interaction, status));
