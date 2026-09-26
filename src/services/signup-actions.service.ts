import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type ModalSubmitInteraction,
  type User,
} from "discord.js";
import {
  SIGNUP_ADD_BUTTON_ID,
  SIGNUP_CHARNOTE_BUTTON_ID,
  SIGNUP_INFO_BUTTON_ID,
  SIGNUP_REMOVE_BUTTON_ID,
  SIGNUP_REMOVE_CHARNOTE_BUTTON_ID,
  SIGNUP_SWAP_BUTTON_ID,
  SIGNUP_TBC_BUTTON_ID,
  SIGNUP_WHEN_BUTTON_ID,
} from "../constants/signup.js";
import { getSignupSheet, mutateSignupSheet } from "./signup-sheet.service.js";
import {
  buildSignupSheetEmbed,
  formatSignupSchedule,
} from "../templates/signup-sheet.template.js";
import type { SignupSheet } from "../types/signup-sheet.js";
import {
  ExpiringMap,
  formatSlotLabel,
  getInvokingUserSlot,
  mergeActionNotices,
  pickRandomOpenSlot,
  type ActionNotice,
} from "../utils/signup-sheet.js";

export type SignupInteraction =
  | ChatInputCommandInteraction
  | ModalSubmitInteraction
  | ButtonInteraction;

export interface PendingAddConfirmation {
  userId: string;
  displayName: string;
  slotNumbers: number[];
  randomSlotNumber?: number;
  charNote: string | null;
  isTbc: boolean;
}

export interface AddOptions {
  char?: string | null;
  tbc?: boolean;
}

export const formatAddNoticeDetail = (
  charName: string | null | undefined,
  isTbc: boolean,
): string | undefined => {
  const details = [charName?.trim(), isTbc ? "TBC" : null].filter(
    (detail): detail is string => Boolean(detail),
  );
  return details.length ? details.join(", ") : undefined;
};

export const pendingAddConfirmations = new ExpiringMap<
  string,
  PendingAddConfirmation
>();

export const signupSheetKey = (guildId: string, channelId: string): string =>
  `${guildId}:${channelId}`;

export const addConfirmationKey = (
  guildId: string,
  channelId: string,
  userId: string,
): string => `${signupSheetKey(guildId, channelId)}:${userId}`;

/** Builds the rows attached to every published signup sheet embed with action buttons. */
export const buildSignupSheetComponents =
  (): ActionRowBuilder<ButtonBuilder>[] => [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(SIGNUP_ADD_BUTTON_ID)
        .setLabel("Add")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(SIGNUP_REMOVE_BUTTON_ID)
        .setLabel("Remove")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(SIGNUP_TBC_BUTTON_ID)
        .setLabel("TBC")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(SIGNUP_SWAP_BUTTON_ID)
        .setLabel("Swap")
        .setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(SIGNUP_CHARNOTE_BUTTON_ID)
        .setLabel("Char")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(SIGNUP_REMOVE_CHARNOTE_BUTTON_ID)
        .setLabel("Remove Char")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(SIGNUP_WHEN_BUTTON_ID)
        .setLabel("Schedule")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(SIGNUP_INFO_BUTTON_ID)
        .setLabel("Command List")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

/** Fetches this channel's signup sheet, or `null` outside a guild text channel or when none exists. */
export const getSheet = async (
  interaction: SignupInteraction,
): Promise<SignupSheet | null> => {
  if (!interaction.guildId || !interaction.channelId) return null;
  return getSignupSheet(interaction.guildId, interaction.channelId);
};

/** Replies (or edits an existing deferred reply) telling the user this channel has no signup sheet yet. */
export const replyMissing = async (
  interaction: SignupInteraction,
): Promise<void> => {
  const content =
    "There is no signup sheet in this text channel. Use `/newrun` first.";
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(content);
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
};

/** Disables or removes interactive components on a previously published sheet message. */
export const cleanupStaleSheetComponents = async (
  interaction: SignupInteraction,
  messageId: string | null | undefined,
): Promise<void> => {
  if (!messageId) return;
  try {
    const channel =
      interaction.channel ??
      (interaction.channelId && interaction.client?.channels
        ? await interaction.client.channels
            .fetch(interaction.channelId)
            .catch(() => null)
        : null);
    if (
      channel &&
      "messages" in channel &&
      channel.messages &&
      typeof channel.messages.fetch === "function"
    ) {
      const oldMessage = await channel.messages
        .fetch(messageId)
        .catch(() => null);
      if (oldMessage && typeof oldMessage.edit === "function") {
        await oldMessage.edit({ components: [] }).catch(() => null);
      }
    }
  } catch {
    // Ignore cleanup errors on stale messages
  }
};

/** Saves the sheet and replies (or edits a deferred reply) with its embed and command-list button, cleaning up stale message components. */
export const publish = async (
  interaction: SignupInteraction,
  sheet: SignupSheet,
): Promise<void> => {
  const previousMessageId = sheet.messageId;
  const response = {
    embeds: [
      buildSignupSheetEmbed(
        sheet,
        interaction.guild?.name ?? "Direct Message",
        interaction.guild?.iconURL({ extension: "png", size: 512 }) ?? null,
      ),
    ],
    components: buildSignupSheetComponents(),
  };
  let sentMessage: Message | null = null;
  if (interaction.deferred || interaction.replied) {
    if (typeof interaction.editReply === "function") {
      sentMessage = (await interaction.editReply(response)) as Message;
    }
  } else {
    const replyResult = await interaction.reply(response);
    if (replyResult && typeof replyResult === "object" && "id" in replyResult) {
      sentMessage = replyResult as unknown as Message;
    } else if (typeof interaction.fetchReply === "function") {
      sentMessage = await interaction.fetchReply().catch(() => null);
    }
  }
  if (sentMessage?.id) {
    sheet.messageId = sentMessage.id;
    if (interaction.guildId && interaction.channelId) {
      await mutateSignupSheet(
        interaction.guildId,
        interaction.channelId,
        (s) => {
          s.messageId = sentMessage!.id;
          return null;
        },
      );
    }
    if (previousMessageId && previousMessageId !== sentMessage.id) {
      await cleanupStaleSheetComponents(interaction, previousMessageId);
    }
  }
};

/** Publishes the sheet as a new message directly to the channel (e.g. following an ephemeral action), updating messageId and cleaning up stale components. */
export const publishToChannel = async (
  interaction: SignupInteraction,
  sheet: SignupSheet,
): Promise<Message | null> => {
  const previousMessageId = sheet.messageId;
  const response = {
    embeds: [
      buildSignupSheetEmbed(
        sheet,
        interaction.guild?.name ?? "Direct Message",
        interaction.guild?.iconURL({ extension: "png", size: 512 }) ?? null,
      ),
    ],
    components: buildSignupSheetComponents(),
  };
  let sentMessage: Message | null = null;
  const channel =
    interaction.channel ??
    (interaction.channelId && interaction.client?.channels
      ? await interaction.client.channels
          .fetch(interaction.channelId)
          .catch(() => null)
      : null);

  if (
    channel &&
    "send" in channel &&
    typeof (channel as { send?: unknown }).send === "function"
  ) {
    sentMessage = (await (
      channel as { send: (options: unknown) => Promise<Message> }
    )
      .send(response)
      .catch(() => null)) as Message | null;
  } else if (typeof interaction.followUp === "function") {
    sentMessage = (await interaction
      .followUp(response)
      .catch(() => null)) as Message | null;
  }

  if (sentMessage?.id) {
    sheet.messageId = sentMessage.id;
    if (interaction.guildId && interaction.channelId) {
      await mutateSignupSheet(
        interaction.guildId,
        interaction.channelId,
        (s) => {
          s.messageId = sentMessage!.id;
          return null;
        },
      );
    }
    if (previousMessageId && previousMessageId !== sentMessage.id) {
      await cleanupStaleSheetComponents(interaction, previousMessageId);
    }
  }

  return sentMessage;
};

/** Loads the sheet, applies `mutate` atomically in the storage layer, and publishes on success; replies with `mutate`'s returned error otherwise. */
export const update = async (
  interaction: SignupInteraction,
  mutate: (sheet: SignupSheet) => string | null,
): Promise<SignupSheet | null> => {
  if (!interaction.guildId || !interaction.channelId) {
    await replyMissing(interaction);
    return null;
  }
  const { sheet, error } = await mutateSignupSheet(
    interaction.guildId,
    interaction.channelId,
    mutate,
  );
  if (error === "MISSING_SHEET" || !sheet) {
    if (error && error !== "MISSING_SHEET") {
      if (interaction.deferred || interaction.replied)
        await interaction.editReply(error);
      else
        await interaction.reply({
          content: error,
          flags: MessageFlags.Ephemeral,
        });
      return null;
    }
    await replyMissing(interaction);
    return null;
  }
  await publish(interaction, sheet);
  return sheet;
};

export type NoticeAction =
  | "added"
  | "removed"
  | "swapped"
  | "tbc"
  | "untbc"
  | "charnote"
  | "uncharnote";

interface ActionNoticeFormatOptions {
  action: NoticeAction;
  isSelf: boolean;
  target: string;
  labelText: string;
  invokerMention: string;
  runTitle: string;
  detail?: string;
  randomSlotNumber?: number;
}

const formatActionNotice = ({
  action,
  isSelf,
  target,
  labelText,
  invokerMention,
  runTitle,
  detail,
  randomSlotNumber,
}: ActionNoticeFormatOptions): string => {
  const detailSuffix = detail ? ` (${detail})` : "";
  const randomResult = randomSlotNumber
    ? ` random, 🎲rolled ${randomSlotNumber} and got `
    : "";
  const selfText = {
    added: randomSlotNumber
      ? `${target} added${randomResult}**${labelText}**${detailSuffix}.`
      : `${target} added as **${labelText}**${detailSuffix}.`,
    removed: `${target} removed from **${labelText}**.`,
    swapped: randomSlotNumber
      ? `${target} swapped to${randomResult}**${labelText}**${detailSuffix}`
      : `${target} swapped to **${labelText}**.`,
    tbc: `${target} marked as **TBC**.`,
    untbc: `${target} unmarked as **TBC**.`,
    charnote: `${target} put **${detail}** in **${labelText}**.`,
    uncharnote: `${target} removed the char note from **${labelText}**.`,
  } satisfies Record<NoticeAction, string>;
  const otherText = {
    added: randomSlotNumber
      ? `${target}, you got added by ${invokerMention} as${randomResult}**${labelText}**${detailSuffix} on ${runTitle}.`
      : `${target}, you got added by ${invokerMention} as **${labelText}**${detailSuffix} on ${runTitle}.`,
    removed: `${target}, you got removed by ${invokerMention} from **${labelText}** on ${runTitle}.`,
    swapped: randomSlotNumber
      ? `${target}, you got swapped by ${invokerMention} to${randomResult}**${labelText}**${detailSuffix} on ${runTitle}.`
      : `${target}, you got swapped by ${invokerMention} to **${labelText}** on ${runTitle}.`,
    tbc: `${target}, you got marked as **TBC** by ${invokerMention} on ${runTitle}.`,
    untbc: `${target}, you got unmarked as **TBC** by ${invokerMention} on ${runTitle}.`,
    charnote: `${target}, ${invokerMention} put **${detail}** in **${labelText}** for you on ${runTitle}.`,
    uncharnote: `${target}, ${invokerMention} removed your char note from **${labelText}** on ${runTitle}.`,
  } satisfies Record<NoticeAction, string>;
  return (isSelf ? selfText : otherText)[action];
};

/** Posts one public log message per affected user: a plain display-name line for the invoker's own action, or a Discord mention when someone else was affected. */
export const sendActionNotices = async (
  interaction: SignupInteraction,
  action: NoticeAction,
  notices: ActionNotice[],
  runTitle: string,
  detail?: string,
  randomSlotNumber?: number,
): Promise<void> => {
  for (const notice of notices) {
    if (!notice.labels.length) continue;
    const labelText = notice.labels.join(", ");
    const isSelf = notice.userId === interaction.user.id;
    const invokerMention = `<@${interaction.user.id}>`;
    const target = isSelf
      ? `**${interaction.user.displayName}**`
      : `<@${notice.userId}>`;
    await interaction.followUp({
      content: formatActionNotice({
        action,
        isSelf,
        target,
        labelText,
        invokerMention,
        runTitle,
        detail,
        randomSlotNumber,
      }),
    });
  }
};

/** Posts a public signup-sheet action notice after the updated embed is sent. */
export const sendSignupNotice = async (
  interaction: SignupInteraction,
  content: string,
): Promise<void> => {
  await interaction.followUp({ content });
};

/**
 * Resolves a mentioned user or member name string (e.g. `<@123...>`, `@username`, `username`, or user ID)
 * to a Discord User object.
 */
export const resolveTargetUser = async (
  interaction: SignupInteraction,
  mentionText: string,
): Promise<User | null> => {
  const trimmed = mentionText.trim();
  if (!trimmed) return null;

  const mentionMatch = /^<@!?(\d+)>$/.exec(trimmed);
  if (mentionMatch) {
    return await interaction.client.users
      .fetch(mentionMatch[1])
      .catch(() => null);
  }

  if (/^\d{17,20}$/.test(trimmed)) {
    const userById = await interaction.client.users
      .fetch(trimmed)
      .catch(() => null);
    if (userById) return userById;
  }

  const queryName = trimmed.replace(/^@/, "").trim();
  if (!queryName) return null;

  const guild =
    interaction.guild ??
    (interaction.guildId
      ? await interaction.client.guilds
          .fetch(interaction.guildId)
          .catch(() => null)
      : null);

  if (!guild || typeof guild.members?.fetch !== "function") return null;
  const members = await guild.members
    .fetch({ query: queryName, limit: 100 })
    .catch(() => null);
  if (!members || members.size === 0) return null;
  const memberList = Array.from(members.values());
  const normalizedQuery = queryName.toLowerCase();
  const exactMatch = memberList.find((member) =>
    [
      member.displayName,
      member.user.displayName,
      member.user.globalName,
      member.user.username,
      member.nickname,
    ]
      .filter((val): val is string => Boolean(val))
      .some((val) => val.toLowerCase() === normalizedQuery),
  );
  return (
    exactMatch?.user ?? (memberList.length === 1 ? memberList[0]!.user : null)
  );
};

const parseAddInput = (
  rawInput: string,
): { positionInput: string; mentionText: string } => {
  const trimmed = rawInput.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith("reserve")) {
    return {
      positionInput: "reserve",
      mentionText: trimmed.slice("reserve".length).trim(),
    };
  }

  if (lower.startsWith("random")) {
    return {
      positionInput: "random",
      mentionText: trimmed.slice("random".length).trim(),
    };
  }

  const numberMatch = /^\d(?:[\d\s,]*\d)?/.exec(trimmed);
  if (numberMatch?.[0]) {
    return {
      positionInput: numberMatch[0].trim(),
      mentionText: trimmed.slice(numberMatch[0].length).trim(),
    };
  }

  const [first, ...rest] = trimmed.split(/\s+/);
  return {
    positionInput: first?.toLowerCase() ?? "",
    mentionText: rest.join(" ").trim(),
  };
};

const resolveAddSlotNumbers = (
  positionInput: string,
  sheet: SignupSheet,
  interaction: SignupInteraction,
): number[] | null => {
  const replyError = (message: string): null => {
    if (interaction.deferred || interaction.replied) {
      void interaction.editReply(message);
    } else {
      void interaction.reply({
        content: message,
        flags: MessageFlags.Ephemeral,
      });
    }
    return null;
  };
  if (positionInput === "random") {
    const openSlot = pickRandomOpenSlot(sheet);
    if (!openSlot) return replyError("There are no open slots available.");
    return [openSlot.number];
  }

  const parts = positionInput
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const invalid: string[] = [];
  const numbers: number[] = [];

  for (const part of parts) {
    const number = Number(part);
    if (
      !Number.isInteger(number) ||
      !sheet.slots.some((slot) => slot.number === number)
    ) {
      invalid.push(part);
      continue;
    }
    numbers.push(number);
  }

  if (invalid.length || !numbers.length) {
    const msg = invalid.length
      ? `These slot numbers do not exist: ${invalid.join(", ")}.`
      : "Provide at least one valid slot number.";
    return replyError(msg);
  }

  return [...new Set(numbers)];
};

const parseRemovePositions = (
  input: string,
  slotCount: number,
  reserveCount: number,
): { numbers: Set<number>; reserveIndexes: Set<number>; invalid: string[] } => {
  const parts = input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const invalid: string[] = [];
  const numbers = new Set<number>();
  const reserveIndexes = new Set<number>();

  for (const part of parts) {
    const num = Number(part);
    if (!Number.isInteger(num)) {
      invalid.push(part);
      continue;
    }

    if (num > 0 && num <= slotCount) {
      numbers.add(num);
      continue;
    }

    const reserveIndex = num - slotCount - 1;
    if (
      Number.isInteger(reserveIndex) &&
      reserveIndex >= 0 &&
      reserveIndex < reserveCount
    ) {
      reserveIndexes.add(reserveIndex);
      continue;
    }

    invalid.push(part);
  }

  return { numbers, reserveIndexes, invalid };
};

type PositionSelection = {
  slotNumbers: Set<number>;
  reserveIndexes: Set<number>;
  invalid: string[];
};

const parsePositionSelection = (
  input: string,
  sheet: SignupSheet,
): PositionSelection => {
  const slotNumbers = new Set<number>();
  const reserveIndexes = new Set<number>();
  const invalid: string[] = [];
  for (const part of input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const number = Number(part);
    if (!Number.isInteger(number)) {
      invalid.push(part);
      continue;
    }
    if (sheet.slots.some((slot) => slot.number === number)) {
      slotNumbers.add(number);
      continue;
    }
    const reserveIndex = number - sheet.slots.length - 1;
    if (reserveIndex >= 0 && reserveIndex < sheet.reserves.length) {
      reserveIndexes.add(reserveIndex);
      continue;
    }
    invalid.push(part);
  }
  return { slotNumbers, reserveIndexes, invalid };
};

const selectionError = ({
  slotNumbers,
  reserveIndexes,
  invalid,
}: PositionSelection): string | null => {
  if (invalid.length)
    return `These slot numbers do not exist: ${invalid.join(", ")}.`;
  return slotNumbers.size || reserveIndexes.size
    ? null
    : "Provide at least one valid slot number.";
};

const clearUserCharNotes = (
  sheet: SignupSheet,
  userId: string,
  removedEntries: { userId: string; label: string }[],
): string | null => {
  const signedUp =
    sheet.slots.some((slot) => slot.signupUserId === userId) ||
    sheet.reserves.some((reserve) => reserve.userId === userId);
  if (!signedUp) return "You are not signed up or a reserve.";
  for (const slot of sheet.slots) {
    if (slot.signupUserId === userId) {
      if (slot.charNote)
        removedEntries.push({ userId, label: formatSlotLabel(slot) });
      slot.charNote = null;
    }
  }
  for (const reserve of sheet.reserves) {
    if (reserve.userId === userId) {
      if (reserve.charNote) removedEntries.push({ userId, label: "Reserve" });
      reserve.charNote = null;
    }
  }
  return null;
};

const clearSelectedCharNotes = (
  sheet: SignupSheet,
  selection: PositionSelection,
  removedEntries: { userId: string; label: string }[],
): void => {
  for (const slot of sheet.slots) {
    if (!selection.slotNumbers.has(slot.number)) continue;
    if (slot.signupUserId && slot.charNote) {
      removedEntries.push({
        userId: slot.signupUserId,
        label: formatSlotLabel(slot),
      });
    }
    slot.charNote = null;
  }
  for (const index of selection.reserveIndexes) {
    const reserve = sheet.reserves[index];
    if (!reserve) continue;
    if (reserve.charNote)
      removedEntries.push({ userId: reserve.userId, label: "Reserve" });
    reserve.charNote = null;
  }
};

const toggleSelectedTbc = (
  sheet: SignupSheet,
  selection: PositionSelection,
  recordToggle: (userId: string, label: string, isTbc: boolean) => void,
): void => {
  for (const slot of sheet.slots) {
    if (!selection.slotNumbers.has(slot.number)) continue;
    slot.isTbc = !slot.isTbc;
    if (slot.signupUserId)
      recordToggle(slot.signupUserId, formatSlotLabel(slot), slot.isTbc);
  }
  for (const index of selection.reserveIndexes) {
    const reserve = sheet.reserves[index];
    if (!reserve) continue;
    reserve.isTbc = !reserve.isTbc;
    recordToggle(reserve.userId, "Reserve", reserve.isTbc);
  }
};

const clearSelectedTbc = (
  sheet: SignupSheet,
  selection: PositionSelection,
): void => {
  for (const slot of sheet.slots) {
    if (selection.slotNumbers.has(slot.number)) slot.isTbc = false;
  }
  for (const index of selection.reserveIndexes) {
    const reserve = sheet.reserves[index];
    if (reserve) reserve.isTbc = false;
  }
};

const applySelfRemoveFromSheet = (
  sheet: SignupSheet,
  userId: string,
  removedEntries: { userId: string; label: string }[],
): string | null => {
  let removedAny = false;
  for (const slot of sheet.slots) {
    if (slot.signupUserId !== userId) continue;
    removedEntries.push({
      userId: slot.signupUserId,
      label: formatSlotLabel(slot),
    });
    slot.signupUserId = null;
    slot.signupDisplayName = null;
    slot.charNote = null;
    slot.isTbc = false;
    removedAny = true;
  }

  const beforeReserveCount = sheet.reserves.length;
  for (const reserve of sheet.reserves) {
    if (reserve.userId === userId) {
      removedEntries.push({ userId: reserve.userId, label: "Reserve" });
    }
  }
  sheet.reserves = sheet.reserves.filter(
    (reserve) => reserve.userId !== userId,
  );
  if (sheet.reserves.length !== beforeReserveCount) removedAny = true;
  return removedAny ? null : "You are not signed up or a reserve.";
};

const removeUserReserve = (
  sheet: SignupSheet,
  userId: string,
  removedEntries: { userId: string; label: string }[],
): string | null => {
  const before = sheet.reserves.length;
  for (const reserve of sheet.reserves) {
    if (reserve.userId === userId) {
      removedEntries.push({ userId: reserve.userId, label: "Reserve" });
    }
  }
  sheet.reserves = sheet.reserves.filter(
    (reserve) => reserve.userId !== userId,
  );
  return before === sheet.reserves.length ? "You are not a reserve." : null;
};

const applySlotTearDown = (
  sheet: SignupSheet,
  numbers: Set<number>,
  reserveIndexes: Set<number>,
  removedEntries: { userId: string; label: string }[],
): void => {
  for (const slot of sheet.slots) {
    if (!numbers.has(slot.number)) continue;
    if (slot.signupUserId) {
      removedEntries.push({
        userId: slot.signupUserId,
        label: formatSlotLabel(slot),
      });
    }
    slot.signupUserId = null;
    slot.signupDisplayName = null;
    slot.charNote = null;
    slot.isTbc = false;
  }

  for (const index of reserveIndexes) {
    const reserve = sheet.reserves[index];
    if (reserve) {
      removedEntries.push({ userId: reserve.userId, label: "Reserve" });
    }
  }
  sheet.reserves = sheet.reserves.filter(
    (_, index) => !reserveIndexes.has(index),
  );
};

const parsePositionValue = (
  rawPos: number | string | null | undefined,
): number | null => {
  if (typeof rawPos === "number") return rawPos;
  if (rawPos) return Number(rawPos);
  return null;
};

const resolvePositionTarget = (
  sheet: SignupSheet,
  position: number,
):
  | {
      signupUserId: string | null;
      signupDisplayName: string | null;
      charNote: string | null;
      isTbc?: boolean;
      number: number;
      role: string;
    }
  | {
      userId: string;
      displayName: string;
      charNote: string | null;
      isTbc?: boolean;
    }
  | null => {
  const slot = sheet.slots.find((candidate) => candidate.number === position);
  if (slot) return slot;

  const reserveIndex = position - sheet.slots.length - 1;
  const reserve = sheet.reserves[reserveIndex];
  return reserve ?? null;
};

const applyUserCharNote = (
  sheet: SignupSheet,
  userId: string,
  note: string,
): {
  noticeUserId: string | null;
  noticeLabel: string | null;
  error: string | null;
} => {
  const slot = getInvokingUserSlot(sheet, userId);
  if (slot) {
    slot.charNote = note;
    return {
      noticeUserId: userId,
      noticeLabel: formatSlotLabel(slot),
      error: null,
    };
  }

  const reserve = sheet.reserves.find((entry) => entry.userId === userId);
  if (reserve) {
    reserve.charNote = note;
    return {
      noticeUserId: userId,
      noticeLabel: "Reserve",
      error: null,
    };
  }

  return {
    noticeUserId: null,
    noticeLabel: null,
    error:
      "You must be signed up in a party slot or reserve when no position is provided.",
  };
};

type SwapEntry = { userId: string; label: string };

const moveSlotToReserve = (
  sheet: SignupSheet,
  slot: SignupSheet["slots"][number],
  swapEntries: SwapEntry[],
): void => {
  const userId = slot.signupUserId!;
  sheet.reserves.push({
    userId,
    displayName: slot.signupDisplayName ?? "Unknown user",
    charNote: slot.charNote,
    isTbc: slot.isTbc,
  });
  slot.signupUserId = null;
  slot.signupDisplayName = null;
  slot.charNote = null;
  slot.isTbc = false;
  swapEntries.push({ userId, label: "Reserve" });
};

const swapWithReserve = (
  sheet: SignupSheet,
  slot: SignupSheet["slots"][number],
  reserveIndex: number,
  swapEntries: SwapEntry[],
): void => {
  const reserve = sheet.reserves[reserveIndex]!;
  const previousSignup = slot.signupUserId
    ? {
        userId: slot.signupUserId,
        displayName: slot.signupDisplayName ?? "Unknown user",
        charNote: slot.charNote,
        isTbc: slot.isTbc,
      }
    : null;
  slot.signupUserId = reserve.userId;
  slot.signupDisplayName = reserve.displayName;
  slot.charNote = reserve.charNote;
  slot.isTbc = reserve.isTbc;
  if (previousSignup) sheet.reserves[reserveIndex] = previousSignup;
  else sheet.reserves.splice(reserveIndex, 1);
  swapEntries.push({ userId: reserve.userId, label: formatSlotLabel(slot) });
  if (previousSignup)
    swapEntries.push({ userId: previousSignup.userId, label: "Reserve" });
};

const swapSlots = (
  first: SignupSheet["slots"][number],
  second: SignupSheet["slots"][number],
  swapEntries: SwapEntry[],
): void => {
  const firstUserId = first.signupUserId;
  const secondUserId = second.signupUserId;
  [first.signupUserId, second.signupUserId] = [
    second.signupUserId,
    first.signupUserId,
  ];
  [first.signupDisplayName, second.signupDisplayName] = [
    second.signupDisplayName,
    first.signupDisplayName,
  ];
  [first.charNote, second.charNote] = [second.charNote, first.charNote];
  [first.isTbc, second.isTbc] = [second.isTbc, first.isTbc];
  if (firstUserId)
    swapEntries.push({ userId: firstUserId, label: formatSlotLabel(second) });
  if (secondUserId)
    swapEntries.push({ userId: secondUserId, label: formatSlotLabel(first) });
};

const joinSlotAsInvoker = (
  sheet: SignupSheet,
  interaction: SignupInteraction,
  first: SignupSheet["slots"][number],
  swapEntries: SwapEntry[],
): string | null => {
  const userSlots = sheet.slots.filter(
    (slot) => slot.signupUserId === interaction.user.id,
  );
  const reserveIndex = sheet.reserves.findIndex(
    (reserve) => reserve.userId === interaction.user.id,
  );
  if (userSlots.length + (reserveIndex === -1 ? 0 : 1) > 1) {
    return "You have multiple signups. Specify the second slot or reserve to swap.";
  }
  const currentSlot = userSlots[0];
  const currentReserve =
    reserveIndex === -1 ? null : sheet.reserves[reserveIndex]!;
  const previousUserId = first.signupUserId;
  const previousSignup = previousUserId
    ? {
        userId: previousUserId,
        displayName: first.signupDisplayName ?? "Unknown user",
        charNote: first.charNote,
        isTbc: first.isTbc,
      }
    : null;
  const currentCharNote =
    currentSlot?.charNote ?? currentReserve?.charNote ?? null;
  const currentIsTbc = currentSlot?.isTbc ?? currentReserve?.isTbc ?? false;
  if (currentSlot && currentSlot !== first) {
    currentSlot.signupUserId = null;
    currentSlot.signupDisplayName = null;
    currentSlot.charNote = null;
    currentSlot.isTbc = false;
  }
  if (reserveIndex !== -1) sheet.reserves.splice(reserveIndex, 1);
  first.signupUserId = interaction.user.id;
  first.signupDisplayName = interaction.user.displayName;
  first.charNote = currentCharNote;
  first.isTbc = currentIsTbc;
  swapEntries.push({
    userId: interaction.user.id,
    label: formatSlotLabel(first),
  });
  if (previousSignup && previousSignup.userId !== interaction.user.id) {
    if (currentSlot && currentSlot !== first) {
      Object.assign(currentSlot, {
        signupUserId: previousSignup.userId,
        signupDisplayName: previousSignup.displayName,
        charNote: previousSignup.charNote,
        isTbc: previousSignup.isTbc,
      });
      swapEntries.push({
        userId: previousSignup.userId,
        label: formatSlotLabel(currentSlot),
      });
    } else {
      sheet.reserves.push(previousSignup);
      swapEntries.push({ userId: previousSignup.userId, label: "Reserve" });
    }
  }
  return null;
};

const executeReserveFirstSwap = (
  sheet: SignupSheet,
  interaction: SignupInteraction,
  secondValue: string | undefined,
  swapEntries: SwapEntry[],
): string | null => {
  if (secondValue) return "Use `/swap first:reserve` without a second slot.";
  const userSlots = sheet.slots.filter(
    (slot) => slot.signupUserId === interaction.user.id,
  );
  if (userSlots.length > 1) {
    return "You have multiple slot signups. Specify which slot to move to reserves, e.g. `/swap first:1 second:reserve`.";
  }
  const currentSlot = userSlots[0];
  if (!currentSlot)
    return "You must be signed up in a party slot to move to reserves.";
  if (
    sheet.reserves.some((reserve) => reserve.userId === interaction.user.id)
  ) {
    return "You are already a reserve.";
  }
  moveSlotToReserve(sheet, currentSlot, swapEntries);
  return null;
};

const executeTargetSlotSwap = (
  sheet: SignupSheet,
  interaction: SignupInteraction,
  first: SignupSheet["slots"][number],
  secondValue: string | undefined,
  swapEntries: SwapEntry[],
  onRandomSlot?: (slotNumber: number) => void,
): string | null => {
  if (!secondValue)
    return joinSlotAsInvoker(sheet, interaction, first, swapEntries);
  if (secondValue === "reserve") {
    if (!first.signupUserId)
      return "That party slot does not have a signup to move to reserves.";
    if (
      sheet.reserves.some((reserve) => reserve.userId === first.signupUserId)
    ) {
      return "That user is already a reserve.";
    }
    moveSlotToReserve(sheet, first, swapEntries);
    return null;
  }
  if (secondValue === "random") {
    const second = pickRandomOpenSlot(sheet);
    if (!second) return "There are no open slots available.";
    onRandomSlot?.(second.number);
    swapSlots(first, second, swapEntries);
    return null;
  }
  const second = sheet.slots.find(
    (slot) => slot.number === Number(secondValue),
  );
  if (second) {
    swapSlots(first, second, swapEntries);
    return null;
  }
  const reserveIndex = Number(secondValue) - sheet.slots.length - 1;
  if (reserveIndex >= 0 && reserveIndex < sheet.reserves.length) {
    swapWithReserve(sheet, first, reserveIndex, swapEntries);
    return null;
  }
  return "One of those slots does not exist.";
};

const executeSwapMutation = (
  sheet: SignupSheet,
  interaction: SignupInteraction,
  firstValue: string,
  secondValue: string | undefined,
  swapEntries: SwapEntry[],
  onRandomSlot?: (slotNumber: number) => void,
): string | null => {
  if (firstValue === "reserve") {
    return executeReserveFirstSwap(
      sheet,
      interaction,
      secondValue,
      swapEntries,
    );
  }
  const first =
    firstValue === "random"
      ? pickRandomOpenSlot(sheet)
      : sheet.slots.find((slot) => slot.number === Number(firstValue));
  if (!first)
    return firstValue === "random"
      ? "There are no open slots available."
      : "One of those slots does not exist.";
  if (firstValue === "random") onRandomSlot?.(first.number);
  return executeTargetSlotSwap(
    sheet,
    interaction,
    first,
    secondValue,
    swapEntries,
    onRandomSlot,
  );
};

const replyAddInputError = async (
  interaction: SignupInteraction,
  content: string,
): Promise<void> => {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(content);
    return;
  }
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
};

const resolveAddTarget = async (
  interaction: SignupInteraction,
  mentionText: string,
): Promise<User | null> => {
  if (!mentionText) return interaction.user;
  return resolveTargetUser(interaction, mentionText);
};

const addUserToReserve = async (
  interaction: SignupInteraction,
  targetUser: User,
  options: AddOptions,
): Promise<void> => {
  const sheetAfterUpdate = await update(interaction, (sheet) => {
    if (sheet.reserves.some((reserve) => reserve.userId === targetUser.id)) {
      return "That user is already a reserve.";
    }
    sheet.reserves.push({
      userId: targetUser.id,
      displayName: targetUser.displayName,
      charNote: options.char?.trim() || null,
      isTbc: options.tbc ?? false,
    });
    return null;
  });
  if (sheetAfterUpdate) {
    await sendActionNotices(
      interaction,
      "added",
      [{ userId: targetUser.id, labels: ["Reserve"] }],
      sheetAfterUpdate.title,
      formatAddNoticeDetail(options.char, options.tbc ?? false),
    );
  }
};

const addUserToOpenSlots = async (
  interaction: SignupInteraction,
  targetUser: User,
  slotNumbers: number[],
  options: AddOptions,
  randomSlotNumber?: number,
): Promise<boolean> => {
  const appliedLabels: string[] = [];
  const sheetAfterUpdate = await update(interaction, (sheet) => {
    const raceOccupied = slotNumbers.filter(
      (number) =>
        sheet.slots.find((slot) => slot.number === number)?.signupUserId,
    );
    if (raceOccupied.length) {
      const plural = raceOccupied.length > 1;
      return `Slot${plural ? "s" : ""} ${raceOccupied.join(", ")} ${plural ? "were" : "was"} just signed up by someone else. Try again.`;
    }
    for (const number of slotNumbers) {
      const slot = sheet.slots.find(
        (candidate) => candidate.number === number,
      )!;
      slot.signupUserId = targetUser.id;
      slot.signupDisplayName = targetUser.displayName;
      slot.charNote = options.char?.trim() || null;
      slot.isTbc = options.tbc ?? false;
      appliedLabels.push(formatSlotLabel(slot));
    }
    return null;
  });
  if (!sheetAfterUpdate) return false;
  await sendActionNotices(
    interaction,
    "added",
    [{ userId: targetUser.id, labels: appliedLabels }],
    sheetAfterUpdate.title,
    formatAddNoticeDetail(options.char, options.tbc ?? false),
    randomSlotNumber,
  );
  return true;
};

const requestAddConfirmation = async (
  interaction: SignupInteraction,
  targetUser: User,
  slotNumbers: number[],
  occupiedSlotNumbers: number[],
  options: AddOptions,
  randomSlotNumber?: number,
): Promise<void> => {
  if (!interaction.guildId || !interaction.channelId) return;
  pendingAddConfirmations.set(
    addConfirmationKey(
      interaction.guildId,
      interaction.channelId,
      interaction.user.id,
    ),
    {
      userId: targetUser.id,
      displayName: targetUser.displayName,
      slotNumbers,
      randomSlotNumber,
      charNote: options.char?.trim() || null,
      isTbc: options.tbc ?? false,
    },
  );
  const plural = occupiedSlotNumbers.length > 1;
  const confirmContent = `Slot${plural ? "s" : ""} ${occupiedSlotNumbers.join(", ")} already ${plural ? "have" : "has"} a signup. Replace with **${targetUser.displayName}**?`;
  const confirmComponents = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("signup-add-confirm")
        .setLabel("Yes")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("signup-add-cancel")
        .setLabel("No")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({
      content: confirmContent,
      components: confirmComponents,
    });
    return;
  }
  await interaction.reply({
    content: confirmContent,
    components: confirmComponents,
    flags: MessageFlags.Ephemeral,
  });
};

/**
 * Adds the invoking user, or a resolved mentioned user, to one or more slots.
 *
 * Input supports comma-separated slot numbers, `random`, and `reserve`; `random`
 * selects an open slot and includes the rolled slot number in the public notice.
 * Occupied slots require confirmation before replacement, and open-slot adds
 * are rechecked against the freshly loaded sheet before they are saved.
 */
export const executeAdd = async (
  interaction: SignupInteraction,
  rawInput: string,
  options: AddOptions = {},
): Promise<void> => {
  const sheet = await getSheet(interaction);
  if (!sheet) return replyMissing(interaction);
  const { positionInput, mentionText } = parseAddInput(rawInput);
  if (!positionInput) {
    await replyAddInputError(
      interaction,
      "Provide a slot number, `random`, comma-separated slot numbers, or `reserve` to add a user.",
    );
    return;
  }
  const targetUser = await resolveAddTarget(interaction, mentionText);
  if (!targetUser) {
    await replyAddInputError(
      interaction,
      "Provide a valid user mention after the slot, e.g. `2 @user`.",
    );
    return;
  }
  if (positionInput === "reserve") {
    await addUserToReserve(interaction, targetUser, options);
    return;
  }
  const slotNumbers = resolveAddSlotNumbers(positionInput, sheet, interaction);
  if (!slotNumbers) return;
  const randomSlotNumber =
    positionInput === "random" ? slotNumbers[0] : undefined;
  const occupiedSlotNumbers = slotNumbers.filter(
    (num) => sheet.slots.find((slot) => slot.number === num)?.signupUserId,
  );
  if (!occupiedSlotNumbers.length) {
    await addUserToOpenSlots(
      interaction,
      targetUser,
      slotNumbers,
      options,
      randomSlotNumber,
    );
    return;
  }
  await requestAddConfirmation(
    interaction,
    targetUser,
    slotNumbers,
    occupiedSlotNumbers,
    options,
    randomSlotNumber,
  );
};

/** Removes signups and/or reserve positions from the sheet. */
export const executeRemove = async (
  i: SignupInteraction,
  positionInput?: string | null,
): Promise<void> => {
  const removedEntries: { userId: string; label: string }[] = [];
  const sheetAfterUpdate = await update(i, (s) => {
    const position = positionInput?.toLowerCase().trim();
    if (!position) {
      return applySelfRemoveFromSheet(s, i.user.id, removedEntries);
    }
    if (position === "reserve") {
      return removeUserReserve(s, i.user.id, removedEntries);
    }
    const { numbers, reserveIndexes, invalid } = parseRemovePositions(
      position,
      s.slots.length,
      s.reserves.length,
    );
    if (invalid.length) {
      return `These positions do not exist: ${invalid.join(", ")}.`;
    }
    applySlotTearDown(s, numbers, reserveIndexes, removedEntries);
    return null;
  });
  if (sheetAfterUpdate)
    await sendActionNotices(
      i,
      "removed",
      mergeActionNotices(removedEntries),
      sheetAfterUpdate.title,
    );
};

/**
 * Swaps signup positions or joins an open position as the invoking user.
 *
 * The first value may be a slot number, `random`, or `reserve`. A second
 * value can identify another party slot, `random` open slot, or reserve
 * position; omitting it joins the first slot as the invoking user. Users with
 * multiple signups must provide the second value to keep the operation
 * unambiguous.
 */
export const executeSwap = async (
  i: SignupInteraction,
  firstValueInput: string,
  secondValueInput?: string | null,
): Promise<void> => {
  const swapEntries: { userId: string; label: string }[] = [];
  let randomSlotNumber: number | undefined;
  const sheetAfterUpdate = await update(i, (s) => {
    const firstValue = firstValueInput.toLowerCase().trim();
    const secondValue = secondValueInput?.toLowerCase().trim() || undefined;
    const swapResult = executeSwapMutation(
      s,
      i,
      firstValue,
      secondValue,
      swapEntries,
      (slotNumber) => {
        randomSlotNumber = slotNumber;
      },
    );
    return swapResult;
  });
  if (sheetAfterUpdate)
    await sendActionNotices(
      i,
      "swapped",
      mergeActionNotices(swapEntries),
      sheetAfterUpdate.title,
      undefined,
      randomSlotNumber,
    );
};

/** Sets character notes for a given party slot, reserve slot, or the invoking user. */
export const executeCharNote = async (
  i: SignupInteraction,
  note: string,
  positionValue?: number | string | null,
): Promise<void> => {
  let noticeUserId: string | null = null;
  let noticeLabel: string | null = null;
  const sheetAfterUpdate = await update(i, (s) => {
    const rawPos =
      typeof positionValue === "string" ? positionValue.trim() : positionValue;
    const position = parsePositionValue(rawPos);
    if (rawPos && (position === null || !Number.isInteger(position))) {
      return "That slot does not exist.";
    }
    if (position !== null) {
      const target = resolvePositionTarget(s, position);
      if (!target) return "That slot does not exist.";
      target.charNote = note.trim();
      if ("signupUserId" in target) {
        if (target.signupUserId) {
          noticeUserId = target.signupUserId;
          noticeLabel = formatSlotLabel(target);
        }
      } else {
        noticeUserId = target.userId;
        noticeLabel = "Reserve";
      }
      return null;
    }

    const result = applyUserCharNote(s, i.user.id, note.trim());
    if (result.error) return result.error;

    noticeUserId = result.noticeUserId;
    noticeLabel = result.noticeLabel;
    return null;
  });
  if (sheetAfterUpdate && noticeUserId && noticeLabel)
    await sendActionNotices(
      i,
      "charnote",
      [{ userId: noticeUserId, labels: [noticeLabel] }],
      sheetAfterUpdate.title,
      note.trim(),
    );
};

/** Removes character notes from slots or reserves. */
export const executeRemoveCharNote = async (
  i: SignupInteraction,
  inputValue?: string | null,
): Promise<void> => {
  const removedEntries: { userId: string; label: string }[] = [];
  const sheetAfterUpdate = await update(i, (s) => {
    const input = inputValue?.trim();
    if (!input) return clearUserCharNotes(s, i.user.id, removedEntries);
    const selection = parsePositionSelection(input, s);
    const error = selectionError(selection);
    if (error) return error;
    clearSelectedCharNotes(s, selection, removedEntries);
    return null;
  });
  if (sheetAfterUpdate)
    await sendActionNotices(
      i,
      "uncharnote",
      mergeActionNotices(removedEntries),
      sheetAfterUpdate.title,
    );
};

/** Toggles or sets TBC status on slots or reserves. */
export const executeTbc = async (
  i: SignupInteraction,
  inputValue?: string | null,
): Promise<void> => {
  const tbcOnEntries: { userId: string; label: string }[] = [];
  const tbcOffEntries: { userId: string; label: string }[] = [];
  const recordToggle = (userId: string, label: string, isTbc: boolean) => {
    (isTbc ? tbcOnEntries : tbcOffEntries).push({ userId, label });
  };
  const sheetAfterUpdate = await update(i, (s) => {
    const input = inputValue?.trim();
    if (!input) {
      const userSlots = s.slots.filter(
        (slot) => slot.signupUserId === i.user.id,
      );
      const userReserves = s.reserves.filter(
        (reserve) => reserve.userId === i.user.id,
      );
      if (!userSlots.length && !userReserves.length) {
        return "You are not signed up or a reserve.";
      }
      for (const slot of userSlots) {
        slot.isTbc = !slot.isTbc;
        recordToggle(i.user.id, formatSlotLabel(slot), slot.isTbc);
      }
      for (const reserve of userReserves) {
        reserve.isTbc = !reserve.isTbc;
        recordToggle(i.user.id, "Reserve", reserve.isTbc);
      }
      return null;
    }
    const selection = parsePositionSelection(input, s);
    const error = selectionError(selection);
    if (error) return error;
    toggleSelectedTbc(s, selection, recordToggle);
    return null;
  });
  if (sheetAfterUpdate) {
    if (tbcOnEntries.length)
      await sendActionNotices(
        i,
        "tbc",
        mergeActionNotices(tbcOnEntries),
        sheetAfterUpdate.title,
      );
    if (tbcOffEntries.length)
      await sendActionNotices(
        i,
        "untbc",
        mergeActionNotices(tbcOffEntries),
        sheetAfterUpdate.title,
      );
  }
};

/** Removes TBC markings from slots or reserves. */
export const executeRemoveTbc = async (
  i: SignupInteraction,
  inputValue?: string | null,
): Promise<void> => {
  await update(i, (s) => {
    const input = inputValue?.trim();
    if (!input) {
      const userSlots = s.slots.filter(
        (slot) => slot.signupUserId === i.user.id,
      );
      const userReserves = s.reserves.filter(
        (reserve) => reserve.userId === i.user.id,
      );
      if (!userSlots.length && !userReserves.length) {
        return "You are not signed up or a reserve.";
      }
      for (const slot of userSlots) {
        slot.isTbc = false;
      }
      for (const reserve of userReserves) {
        reserve.isTbc = false;
      }
      return null;
    }
    const selection = parsePositionSelection(input, s);
    const error = selectionError(selection);
    if (error) return error;
    clearSelectedTbc(s, selection);
    return null;
  });
};

/** Shows the run's schedule to the invoking user. */
export const executeWhen = async (i: SignupInteraction): Promise<void> => {
  const s = await getSheet(i);
  if (!s) {
    await replyMissing(i);
    return;
  }
  if (i.deferred || i.replied) {
    await i.editReply(formatSignupSchedule(s));
  } else {
    await i.reply({
      content: formatSignupSchedule(s),
      flags: MessageFlags.Ephemeral,
    });
  }
};
