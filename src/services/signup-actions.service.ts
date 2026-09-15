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
}

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

/** Reports each affected slot/reserve change as an ephemeral note to the invoker (if it was their own signup) or a public mention to whoever else was affected. */
export const sendActionNotices = async (
  interaction: SignupInteraction,
  action: "added" | "removed" | "swapped",
  notices: ActionNotice[],
  runTitle: string,
): Promise<void> => {
  const preposition = action === "removed" ? "from" : "to";
  for (const notice of notices) {
    if (!notice.labels.length) continue;
    const labelText = notice.labels.join(", ");
    if (notice.userId === interaction.user.id) {
      await interaction.followUp({
        content: `You ${action} yourself ${preposition} ${labelText}.`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.followUp({
        content: `<@${notice.userId}>, you got ${action} by <@${interaction.user.id}> ${preposition} ${labelText} on ${runTitle}.`,
      });
    }
  }
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

  if (guild && typeof guild.members?.fetch === "function") {
    const members = await guild.members
      .fetch({ query: queryName, limit: 100 })
      .catch(() => null);

    if (members && members.size > 0) {
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
      if (exactMatch) return exactMatch.user;

      if (memberList.length === 1) {
        return memberList[0]!.user;
      }
    }
  }

  return null;
};

/** Signs up a user for one or more slots, random open slot, or reserves. */
export const executeAdd = async (
  interaction: SignupInteraction,
  rawInput: string,
): Promise<void> => {
  const sheet = await getSheet(interaction);
  if (!sheet) {
    await replyMissing(interaction);
    return;
  }
  const trimmed = rawInput.trim();
  const lower = trimmed.toLowerCase();
  let positionInput = "";
  let mentionText = "";

  if (lower.startsWith("reserve")) {
    positionInput = "reserve";
    mentionText = trimmed.slice("reserve".length).trim();
  } else if (lower.startsWith("random")) {
    positionInput = "random";
    mentionText = trimmed.slice("random".length).trim();
  } else {
    const numMatch = /^([\d\s,]+)(.*)$/.exec(trimmed);
    if (numMatch && numMatch[1].trim()) {
      positionInput = numMatch[1].trim();
      mentionText = numMatch[2].trim();
    } else {
      const [first, ...rest] = trimmed.split(/\s+/);
      positionInput = first?.toLowerCase() ?? "";
      mentionText = rest.join(" ").trim();
    }
  }

  if (!positionInput) {
    const msg =
      "Provide a slot number, `random`, comma-separated slot numbers, or `reserve` to add a user.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg);
    } else {
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  let targetUser = interaction.user;
  if (mentionText) {
    const resolvedUser = await resolveTargetUser(interaction, mentionText);
    if (!resolvedUser) {
      const msg =
        "Provide a valid user mention after the slot, e.g. `2 @user`.";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg);
      } else {
        await interaction.reply({
          content: msg,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }
    targetUser = resolvedUser;
  }
  if (positionInput === "reserve") {
    const sheetAfterUpdate = await update(interaction, (s) => {
      if (s.reserves.some((r) => r.userId === targetUser.id))
        return "That user is already a reserve.";
      s.reserves.push({
        userId: targetUser.id,
        displayName: targetUser.displayName,
        charNote: null,
        isTbc: false,
      });
      return null;
    });
    if (sheetAfterUpdate)
      await sendActionNotices(
        interaction,
        "added",
        [{ userId: targetUser.id, labels: ["Reserve"] }],
        sheetAfterUpdate.title,
      );
    return;
  }
  let slotNumbers: number[];
  if (positionInput === "random") {
    const openSlot = pickRandomOpenSlot(sheet);
    if (!openSlot) {
      const msg = "There are no open slots available.";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg);
      } else {
        await interaction.reply({
          content: msg,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }
    slotNumbers = [openSlot.number];
  } else {
    const parts = positionInput
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const invalid: string[] = [];
    const numbers: number[] = [];
    for (const part of parts) {
      const num = Number(part);
      if (
        !Number.isInteger(num) ||
        !sheet.slots.some((slot) => slot.number === num)
      ) {
        invalid.push(part);
        continue;
      }
      numbers.push(num);
    }
    if (invalid.length || !numbers.length) {
      const msg = invalid.length
        ? `These slot numbers do not exist: ${invalid.join(", ")}.`
        : "Provide at least one valid slot number.";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg);
      } else {
        await interaction.reply({
          content: msg,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }
    slotNumbers = [...new Set(numbers)];
  }
  const occupiedSlotNumbers = slotNumbers.filter(
    (num) => sheet.slots.find((slot) => slot.number === num)?.signupUserId,
  );
  if (!occupiedSlotNumbers.length) {
    const appliedLabels: string[] = [];
    const sheetAfterUpdate = await update(interaction, (s) => {
      // Re-check against the freshly loaded sheet so a concurrent signup can't be silently overwritten.
      const raceOccupied = slotNumbers.filter(
        (num) => s.slots.find((slot) => slot.number === num)?.signupUserId,
      );
      if (raceOccupied.length) {
        const plural = raceOccupied.length > 1;
        return `Slot${plural ? "s" : ""} ${raceOccupied.join(", ")} ${plural ? "were" : "was"} just signed up by someone else. Try again.`;
      }
      for (const num of slotNumbers) {
        const slot = s.slots.find((candidate) => candidate.number === num)!;
        slot.signupUserId = targetUser.id;
        slot.signupDisplayName = targetUser.displayName;
        slot.charNote = null;
        slot.isTbc = false;
        appliedLabels.push(formatSlotLabel(slot));
      }
      return null;
    });
    if (sheetAfterUpdate)
      await sendActionNotices(
        interaction,
        "added",
        [{ userId: targetUser.id, labels: appliedLabels }],
        sheetAfterUpdate.title,
      );
    return;
  }
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
  } else {
    await interaction.reply({
      content: confirmContent,
      components: confirmComponents,
      flags: MessageFlags.Ephemeral,
    });
  }
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
      let removedAny = false;
      for (const slot of s.slots) {
        if (slot.signupUserId === i.user.id) {
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
      }
      const beforeReserveCount = s.reserves.length;
      for (const reserve of s.reserves)
        if (reserve.userId === i.user.id)
          removedEntries.push({ userId: reserve.userId, label: "Reserve" });
      s.reserves = s.reserves.filter((r) => r.userId !== i.user.id);
      if (s.reserves.length !== beforeReserveCount) removedAny = true;
      return removedAny ? null : "You are not signed up or a reserve.";
    }
    if (position === "reserve") {
      const before = s.reserves.length;
      for (const reserve of s.reserves)
        if (reserve.userId === i.user.id)
          removedEntries.push({ userId: reserve.userId, label: "Reserve" });
      s.reserves = s.reserves.filter((r) => r.userId !== i.user.id);
      return before === s.reserves.length ? "You are not a reserve." : null;
    }
    const parts = position
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const invalid: string[] = [];
    const slotNumbersToRemove = new Set<number>();
    const reserveIndexesToRemove = new Set<number>();
    for (const part of parts) {
      const num = Number(part);
      if (!Number.isInteger(num)) {
        invalid.push(part);
        continue;
      }
      if (s.slots.some((slot) => slot.number === num)) {
        slotNumbersToRemove.add(num);
        continue;
      }
      const reserveIndex = num - s.slots.length - 1;
      if (
        Number.isInteger(reserveIndex) &&
        reserveIndex >= 0 &&
        reserveIndex < s.reserves.length
      ) {
        reserveIndexesToRemove.add(reserveIndex);
        continue;
      }
      invalid.push(part);
    }
    if (invalid.length)
      return `These positions do not exist: ${invalid.join(", ")}.`;
    for (const slot of s.slots) {
      if (slotNumbersToRemove.has(slot.number)) {
        if (slot.signupUserId)
          removedEntries.push({
            userId: slot.signupUserId,
            label: formatSlotLabel(slot),
          });
        slot.signupUserId = null;
        slot.signupDisplayName = null;
        slot.charNote = null;
        slot.isTbc = false;
      }
    }
    for (const index of reserveIndexesToRemove) {
      const reserve = s.reserves[index];
      if (reserve)
        removedEntries.push({ userId: reserve.userId, label: "Reserve" });
    }
    s.reserves = s.reserves.filter(
      (_, index) => !reserveIndexesToRemove.has(index),
    );
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

/** Swaps two slots or joins a slot as oneself. */
export const executeSwap = async (
  i: SignupInteraction,
  firstValueInput: string,
  secondValueInput?: string | null,
): Promise<void> => {
  const swapEntries: { userId: string; label: string }[] = [];
  const sheetAfterUpdate = await update(i, (s) => {
    const firstValue = firstValueInput.toLowerCase().trim();
    const secondValue = secondValueInput?.toLowerCase().trim() || undefined;
    if (firstValue === "reserve") {
      if (secondValue)
        return "Use `/swap first:reserve` without a second slot.";
      const userSlots = s.slots.filter(
        (slot) => slot.signupUserId === i.user.id,
      );
      if (userSlots.length > 1) {
        return "You have multiple slot signups. Specify which slot to move to reserves, e.g. `/swap first:1 second:reserve`.";
      }
      const currentSlot = userSlots[0];
      if (!currentSlot)
        return "You must be signed up in a party slot to move to reserves.";
      if (s.reserves.some((reserve) => reserve.userId === i.user.id))
        return "You are already a reserve.";
      s.reserves.push({
        userId: i.user.id,
        displayName: i.user.displayName,
        charNote: currentSlot.charNote,
        isTbc: currentSlot.isTbc,
      });
      currentSlot.signupUserId = null;
      currentSlot.signupDisplayName = null;
      currentSlot.charNote = null;
      currentSlot.isTbc = false;
      swapEntries.push({ userId: i.user.id, label: "Reserve" });
      return null;
    }
    const first =
      firstValue === "random"
        ? pickRandomOpenSlot(s)
        : s.slots.find((slot) => slot.number === Number(firstValue));
    if (firstValue === "random" && !first)
      return "There are no open slots available.";
    const second = secondValue
      ? s.slots.find((slot) => slot.number === Number(secondValue))
      : undefined;
    const reserveIndex = secondValue
      ? Number(secondValue) - s.slots.length - 1
      : -1;
    const secondReserve =
      reserveIndex >= 0 ? (s.reserves[reserveIndex] ?? null) : null;
    if (
      !first ||
      (secondValue && secondValue !== "reserve" && !second && !secondReserve)
    )
      return "One of those slots does not exist.";
    if (secondValue === "reserve") {
      if (!first.signupUserId)
        return "That party slot does not have a signup to move to reserves.";
      if (s.reserves.some((reserve) => reserve.userId === first.signupUserId))
        return "That user is already a reserve.";
      const movedUserId = first.signupUserId;
      s.reserves.push({
        userId: first.signupUserId,
        displayName: first.signupDisplayName ?? "Unknown user",
        charNote: first.charNote,
        isTbc: first.isTbc,
      });
      first.signupUserId = null;
      first.signupDisplayName = null;
      first.charNote = null;
      first.isTbc = false;
      swapEntries.push({ userId: movedUserId, label: "Reserve" });
      return null;
    }
    if (secondReserve) {
      const firstSignup = first.signupUserId
        ? {
            userId: first.signupUserId,
            displayName: first.signupDisplayName ?? "Unknown user",
            charNote: first.charNote,
            isTbc: first.isTbc,
          }
        : null;
      first.signupUserId = secondReserve.userId;
      first.signupDisplayName = secondReserve.displayName;
      first.charNote = secondReserve.charNote;
      first.isTbc = secondReserve.isTbc;
      if (firstSignup) s.reserves[reserveIndex] = firstSignup;
      else s.reserves.splice(reserveIndex, 1);
      swapEntries.push({
        userId: secondReserve.userId,
        label: formatSlotLabel(first),
      });
      if (firstSignup)
        swapEntries.push({ userId: firstSignup.userId, label: "Reserve" });
      return null;
    }
    if (second) {
      const previousFirstUserId = first.signupUserId;
      const previousSecondUserId = second.signupUserId;
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
      if (previousFirstUserId)
        swapEntries.push({
          userId: previousFirstUserId,
          label: formatSlotLabel(second),
        });
      if (previousSecondUserId)
        swapEntries.push({
          userId: previousSecondUserId,
          label: formatSlotLabel(first),
        });
    } else {
      const userSlots = s.slots.filter(
        (slot) => slot.signupUserId === i.user.id,
      );
      const userReserves = s.reserves.filter(
        (reserve) => reserve.userId === i.user.id,
      );
      if (userSlots.length + userReserves.length > 1) {
        return "You have multiple signups. Specify the second slot or reserve to swap.";
      }
      const currentSlot = userSlots[0];
      const reserveIndex = s.reserves.findIndex(
        (reserve) => reserve.userId === i.user.id,
      );
      const reserve =
        reserveIndex === -1 ? null : (s.reserves[reserveIndex] ?? null);
      const previousCharNote =
        currentSlot?.charNote ?? reserve?.charNote ?? null;
      const previousIsTbc = currentSlot?.isTbc ?? reserve?.isTbc ?? false;
      if (currentSlot && currentSlot !== first) {
        currentSlot.signupUserId = null;
        currentSlot.signupDisplayName = null;
        currentSlot.charNote = null;
        currentSlot.isTbc = false;
      }
      if (reserveIndex !== -1) s.reserves.splice(reserveIndex, 1);
      [
        first.signupUserId,
        first.signupDisplayName,
        first.charNote,
        first.isTbc,
      ] = [i.user.id, i.user.displayName, previousCharNote, previousIsTbc];
      swapEntries.push({
        userId: i.user.id,
        label: formatSlotLabel(first),
      });
    }
    return null;
  });
  if (sheetAfterUpdate)
    await sendActionNotices(
      i,
      "swapped",
      mergeActionNotices(swapEntries),
      sheetAfterUpdate.title,
    );
};

/** Sets character notes for a given party slot, reserve slot, or the invoking user. */
export const executeCharNote = async (
  i: SignupInteraction,
  note: string,
  positionValue?: number | string | null,
): Promise<void> => {
  await update(i, (s) => {
    const rawPos =
      typeof positionValue === "string" ? positionValue.trim() : positionValue;
    const position =
      typeof rawPos === "number" ? rawPos : rawPos ? Number(rawPos) : null;
    if (rawPos && (position === null || !Number.isInteger(position))) {
      return "That slot does not exist.";
    }
    if (position !== null) {
      const slot = s.slots.find((candidate) => candidate.number === position);
      if (slot) {
        slot.charNote = note.trim();
        return null;
      }
      const reserveIndex = position - s.slots.length - 1;
      if (
        Number.isInteger(reserveIndex) &&
        reserveIndex >= 0 &&
        reserveIndex < s.reserves.length
      ) {
        const reserve = s.reserves[reserveIndex];
        if (reserve) {
          reserve.charNote = note.trim();
          return null;
        }
      }
      return "That slot does not exist.";
    }

    const slot = getInvokingUserSlot(s, i.user.id);
    if (slot) {
      slot.charNote = note.trim();
      return null;
    }
    const reserve = s.reserves.find((r) => r.userId === i.user.id);
    if (reserve) {
      reserve.charNote = note.trim();
      return null;
    }
    return "You must be signed up in a party slot or reserve when no position is provided.";
  });
};

/** Removes character notes from slots or reserves. */
export const executeRemoveCharNote = async (
  i: SignupInteraction,
  inputValue?: string | null,
): Promise<void> => {
  await update(i, (s) => {
    const input = inputValue?.trim();
    if (!input) {
      const isSignedUp =
        s.slots.some((slot) => slot.signupUserId === i.user.id) ||
        s.reserves.some((reserve) => reserve.userId === i.user.id);
      if (!isSignedUp) return "You are not signed up or a reserve.";
      for (const slot of s.slots) {
        if (slot.signupUserId === i.user.id) {
          slot.charNote = null;
        }
      }
      for (const reserve of s.reserves) {
        if (reserve.userId === i.user.id) {
          reserve.charNote = null;
        }
      }
      return null;
    }
    const parts = input
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const invalid: string[] = [];
    const slotNumbersToRemove = new Set<number>();
    const reserveIndexesToRemove = new Set<number>();
    for (const part of parts) {
      const num = Number(part);
      if (!Number.isInteger(num)) {
        invalid.push(part);
        continue;
      }
      if (s.slots.some((slot) => slot.number === num)) {
        slotNumbersToRemove.add(num);
        continue;
      }
      const reserveIndex = num - s.slots.length - 1;
      if (
        Number.isInteger(reserveIndex) &&
        reserveIndex >= 0 &&
        reserveIndex < s.reserves.length
      ) {
        reserveIndexesToRemove.add(reserveIndex);
        continue;
      }
      invalid.push(part);
    }
    if (
      invalid.length ||
      (!slotNumbersToRemove.size && !reserveIndexesToRemove.size)
    ) {
      return invalid.length
        ? `These slot numbers do not exist: ${invalid.join(", ")}.`
        : "Provide at least one valid slot number.";
    }
    for (const slot of s.slots) {
      if (slotNumbersToRemove.has(slot.number)) {
        slot.charNote = null;
      }
    }
    for (const index of reserveIndexesToRemove) {
      const reserve = s.reserves[index];
      if (reserve) reserve.charNote = null;
    }
    return null;
  });
};

/** Toggles or sets TBC status on slots or reserves. */
export const executeTbc = async (
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
        slot.isTbc = !slot.isTbc;
      }
      for (const reserve of userReserves) {
        reserve.isTbc = !reserve.isTbc;
      }
      return null;
    }
    const parts = input
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const invalid: string[] = [];
    const slotNumbersToToggle = new Set<number>();
    const reserveIndexesToToggle = new Set<number>();
    for (const part of parts) {
      const num = Number(part);
      if (!Number.isInteger(num)) {
        invalid.push(part);
        continue;
      }
      if (s.slots.some((slot) => slot.number === num)) {
        slotNumbersToToggle.add(num);
        continue;
      }
      const reserveIndex = num - s.slots.length - 1;
      if (
        Number.isInteger(reserveIndex) &&
        reserveIndex >= 0 &&
        reserveIndex < s.reserves.length
      ) {
        reserveIndexesToToggle.add(reserveIndex);
        continue;
      }
      invalid.push(part);
    }
    if (
      invalid.length ||
      (!slotNumbersToToggle.size && !reserveIndexesToToggle.size)
    ) {
      return invalid.length
        ? `These slot numbers do not exist: ${invalid.join(", ")}.`
        : "Provide at least one valid slot number.";
    }
    for (const slot of s.slots) {
      if (slotNumbersToToggle.has(slot.number)) {
        slot.isTbc = !slot.isTbc;
      }
    }
    for (const index of reserveIndexesToToggle) {
      const reserve = s.reserves[index];
      if (reserve) reserve.isTbc = !reserve.isTbc;
    }
    return null;
  });
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
    const parts = input
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const invalid: string[] = [];
    const slotNumbersToRemove = new Set<number>();
    const reserveIndexesToRemove = new Set<number>();
    for (const part of parts) {
      const num = Number(part);
      if (!Number.isInteger(num)) {
        invalid.push(part);
        continue;
      }
      if (s.slots.some((slot) => slot.number === num)) {
        slotNumbersToRemove.add(num);
        continue;
      }
      const reserveIndex = num - s.slots.length - 1;
      if (
        Number.isInteger(reserveIndex) &&
        reserveIndex >= 0 &&
        reserveIndex < s.reserves.length
      ) {
        reserveIndexesToRemove.add(reserveIndex);
        continue;
      }
      invalid.push(part);
    }
    if (
      invalid.length ||
      (!slotNumbersToRemove.size && !reserveIndexesToRemove.size)
    ) {
      return invalid.length
        ? `These slot numbers do not exist: ${invalid.join(", ")}.`
        : "Provide at least one valid slot number.";
    }
    for (const slot of s.slots) {
      if (slotNumbersToRemove.has(slot.number)) {
        slot.isTbc = false;
      }
    }
    for (const index of reserveIndexesToRemove) {
      const reserve = s.reserves[index];
      if (reserve) reserve.isTbc = false;
    }
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
