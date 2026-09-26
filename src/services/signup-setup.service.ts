import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  CHANGE_ALL_MODAL_ID,
  INSTANCE_TYPE_NONE_VALUE,
  SETUP_MODAL_ID,
  SETUP_PROMPT_CONTENT,
  SIGNUP_CANCEL_SETUP_BUTTON_ID,
  SIGNUP_EDIT_PARTY_SETUP_BUTTON_ID,
  SIGNUP_INSTANCE_TYPE_BUTTON_ID,
  SIGNUP_INSTANCE_TYPE_SELECT_ID,
  SIGNUP_MODAL_ADD_ID,
  SIGNUP_MODAL_CHARNOTE_ID,
  SIGNUP_MODAL_REMOVE_CHARNOTE_ID,
  SIGNUP_MODAL_REMOVE_ID,
  SIGNUP_MODAL_SWAP_ID,
  SIGNUP_MODAL_TBC_ID,
  SIGNUP_NO_ROSTER_CHANGES_BUTTON_ID,
  SIGNUP_ROSTER_BUTTON_ID,
} from "../constants/signup.js";
import { COOLDOWN_INSTANCE_TYPES } from "../constants/cooldowns.js";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import {
  addConfirmationKey,
  executeAdd,
  executeCharNote,
  executeRemove,
  executeRemoveCharNote,
  executeSwap,
  executeTbc,
  formatAddNoticeDetail,
  pendingAddConfirmations,
  publish,
  publishToChannel,
  sendActionNotices,
  sendSignupNotice,
  signupSheetKey,
} from "./signup-actions.service.js";
import {
  getSignupSheet,
  mutateSignupSheet,
  saveSignupSheet,
} from "./signup-sheet.service.js";
import type { SignupSheet } from "../types/signup-sheet.js";
import {
  createEmptySlots,
  ExpiringMap,
  formatNewRunDate,
  formatSlotLabel,
  getRosterPrompt,
  parseNewRunTimestamp,
  parseRosterWithPartySizes,
  parseServerTimezone,
  resolveRosterSignupUserIds,
} from "../utils/signup-sheet.js";

export const pendingSetupSnapshots = new ExpiringMap<
  string,
  SignupSheet | null
>();
export const pendingSetupDrafts = new ExpiringMap<string, SignupSheet>();
export const pendingRosterUsers = new ExpiringMap<string, string>();
export const pendingNoteUsers = new ExpiringMap<string, string>();

export const input = (
  id: string,
  placeholder: string,
  required = true,
  style = TextInputStyle.Short,
  value?: string,
) =>
  new TextInputBuilder()
    .setCustomId(id)
    .setPlaceholder(placeholder)
    .setStyle(style)
    .setRequired(required)
    .setValue(value ?? "");

/** Builds the instance-type select menu row, pre-selecting the sheet's current instance type (or "None"). */
export const buildInstanceTypeSelectRow = (
  currentInstanceType: string | null,
  instanceTypes = COOLDOWN_INSTANCE_TYPES,
): ActionRowBuilder<StringSelectMenuBuilder> =>
  new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SIGNUP_INSTANCE_TYPE_SELECT_ID)
      .setPlaceholder("Select the instance type")
      .addOptions(
        {
          label: "None",
          value: INSTANCE_TYPE_NONE_VALUE,
          default: !currentInstanceType,
        },
        ...instanceTypes
          .filter((type) => type.name !== "Others")
          .map((type) => ({
            label: `${type.emoji} ${type.name}`,
            value: type.name,
            default: currentInstanceType === type.name,
          })),
      ),
  );

/** Builds the button row shown after party setup: edit roster/party setup/instance type, save, or cancel. */
export const buildSetupPromptButtons = (): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SIGNUP_ROSTER_BUTTON_ID)
      .setLabel("Edit Roster")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(SIGNUP_EDIT_PARTY_SETUP_BUTTON_ID)
      .setLabel("Edit Party Setup")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(SIGNUP_INSTANCE_TYPE_BUTTON_ID)
      .setLabel("Set Instance Type")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(SIGNUP_NO_ROSTER_CHANGES_BUTTON_ID)
      .setLabel("Save Changes")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(SIGNUP_CANCEL_SETUP_BUTTON_ID)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger),
  );

/** Builds the button row attached to the roster prompt message with a Cancel button. */
export const buildRosterPromptButtons = (): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SIGNUP_CANCEL_SETUP_BUTTON_ID)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger),
  );

/**
 * Validates the setup modal fields and builds the resulting sheet.
 * The datetime field may be blank or `TBD` to keep the schedule unset, except
 * when creating a brand-new sheet (`existingSheet` is `undefined`), where a
 * valid date/time is required.
 */
export const parseSetup = (
  interaction: ModalSubmitInteraction,
  existingSheet?: SignupSheet,
): { sheet: SignupSheet } | { error: string } => {
  const title = interaction.fields.getTextInputValue("title").trim();
  const datetimeValue = interaction.fields.getTextInputValue("datetime").trim();
  const isDatetimeTbd = /^tbd$/i.test(datetimeValue);
  const schedule =
    datetimeValue && !isDatetimeTbd
      ? parseNewRunTimestamp(datetimeValue)
      : null;
  const serverTimezone = parseServerTimezone(
    interaction.fields.getTextInputValue("timezone"),
  );
  const partyCount = Number(
    interaction.fields.getTextInputValue("parties").trim(),
  );
  const partySizes = interaction.fields
    .getTextInputValue("sizes")
    .split(",")
    .map((value) => Number(value.trim()));
  if (partySizes.length !== partyCount) {
    return {
      error: `Number of parties (${partyCount}) must match the number of party sizes (${partySizes.length}). Enter one size for each party, separated by commas, e.g. 12,6.`,
    };
  }
  if (
    !title ||
    (datetimeValue && !isDatetimeTbd && !schedule) ||
    (!datetimeValue && !existingSheet) ||
    serverTimezone === undefined ||
    !Number.isInteger(partyCount) ||
    partyCount < 1 ||
    partySizes.some((size) => !Number.isInteger(size) || size < 1)
  ) {
    return {
      error:
        "Use date/time `DD/MM HH:MM GMT+8` (or `TBD`/blank to keep the schedule TBD), a server timezone such as `GMT+8`, and valid party sizes.",
    };
  }

  if (existingSheet) {
    const newTotalSlots = partySizes.reduce((total, size) => total + size, 0);
    const droppedOccupiedSlots = existingSheet.slots
      .slice(newTotalSlots)
      .filter((slot) => slot.signupUserId || slot.signupDisplayName);
    if (droppedOccupiedSlots.length > 0) {
      const droppedLabels = droppedOccupiedSlots
        .map((slot) => formatSlotLabel(slot))
        .join(", ");
      return {
        error: `Reducing party sizes would drop signups in slot(s): ${droppedLabels}. Remove or move those players before shrinking party sizes.`,
      };
    }
  }

  return {
    sheet: {
      guildId: interaction.guildId!,
      channelId: interaction.channelId!,
      title,
      organizerId: existingSheet?.organizerId ?? interaction.user.id,
      organizerName:
        existingSheet?.organizerName ?? interaction.user.displayName,
      organizerAvatarUrl:
        existingSheet?.organizerAvatarUrl ??
        interaction.user.displayAvatarURL({ extension: "png", size: 512 }),
      partySizes,
      slots: createEmptySlots(partySizes).map((slot, index) => {
        const existingSlot = existingSheet?.slots[index];
        return existingSlot ? { ...existingSlot, number: slot.number } : slot;
      }),
      reserves: existingSheet?.reserves ?? [],
      notes: existingSheet?.notes ?? null,
      thumbnailUrl: existingSheet?.thumbnailUrl ?? null,
      color: existingSheet?.color ?? null,
      instanceType: existingSheet?.instanceType ?? null,
      timestamp: schedule?.timestamp ?? null,
      scheduleTimezone: schedule?.scheduleTimezone ?? null,
      serverTimezone,
      messageId: existingSheet?.messageId ?? null,
    },
  };
};

/** Shows the create/change party setup modal, pre-filled from `existingSheet` when editing. */
export const showSetup = async (
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  existingSheet?: SignupSheet,
): Promise<void> => {
  const modal = new ModalBuilder()
    .setCustomId(existingSheet ? CHANGE_ALL_MODAL_ID : SETUP_MODAL_ID)
    .setTitle(existingSheet ? "Change party setup" : "Create signup sheet")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Run name")
        .setTextInputComponent(
          input(
            "title",
            "Run name",
            true,
            TextInputStyle.Short,
            existingSheet?.title,
          ),
        ),
      new LabelBuilder()
        .setLabel("Date/time")
        .setDescription(
          "Format DD/MM HH:MM GMT+#. Use your own local timezone offset, or type TBD to decide later.",
        )
        .setTextInputComponent(
          input(
            "datetime",
            "12/09 20:00 GMT+8",
            !existingSheet,
            TextInputStyle.Short,
            existingSheet
              ? formatNewRunDate(
                  existingSheet.timestamp,
                  existingSheet.scheduleTimezone ?? "GMT",
                )
              : undefined,
          ),
        ),
      new LabelBuilder()
        .setLabel("Number of parties")
        .setTextInputComponent(
          input(
            "parties",
            "Party count",
            true,
            TextInputStyle.Short,
            existingSheet ? String(existingSheet.partySizes.length) : undefined,
          ),
        ),
      new LabelBuilder()
        .setLabel("Party sizes, e.g. 12,6,6")
        .setTextInputComponent(
          input(
            "sizes",
            "Party sizes",
            true,
            TextInputStyle.Short,
            existingSheet?.partySizes.join(","),
          ),
        ),
      new LabelBuilder()
        .setLabel("Server timezone (optional, e.g. GMT+8)")
        .setTextInputComponent(
          input(
            "timezone",
            "GMT+8",
            false,
            TextInputStyle.Short,
            existingSheet?.serverTimezone ?? undefined,
          ),
        ),
    );
  await interaction.showModal(modal);
};

/** Handles the create/change-all setup modal submission, staging the parsed sheet as a pending draft. */
const handleSetupModal = async (
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  await interaction.deferReply();
  if (!interaction.guildId || !interaction.channelId) return;
  const key = signupSheetKey(interaction.guildId, interaction.channelId);
  // Reopening "Edit Party Setup" mid-session reuses the in-progress draft so roster/notes/instance type edits aren't lost.
  const pendingDraft = pendingSetupDrafts.get(key);
  const isReopeningPendingSetup =
    interaction.customId === CHANGE_ALL_MODAL_ID && Boolean(pendingDraft);
  const existingSheet =
    interaction.customId === CHANGE_ALL_MODAL_ID
      ? (pendingDraft ??
        (await getSignupSheet(interaction.guildId, interaction.channelId)))
      : undefined;
  const setup = parseSetup(interaction, existingSheet ?? undefined);
  if ("error" in setup) {
    await interaction.editReply(setup.error);
    return;
  }
  if (!isReopeningPendingSetup)
    pendingSetupSnapshots.set(
      key,
      existingSheet ? structuredClone(existingSheet) : null,
    );
  pendingSetupDrafts.set(key, setup.sheet);
  pendingRosterUsers.set(key, interaction.user.id);
  await interaction.editReply({
    content: SETUP_PROMPT_CONTENT,
    components: [buildSetupPromptButtons()],
  });
};

/** Simple modal submissions that just forward their field values to a signup action. */
const SIMPLE_SIGNUP_MODAL_HANDLERS: Readonly<
  Record<string, (interaction: ModalSubmitInteraction) => Promise<void>>
> = {
  [SIGNUP_MODAL_ADD_ID]: async (interaction) => {
    const rawTbc = interaction.fields
      .getTextInputValue("tbc")
      .trim()
      .toLowerCase();
    const tbcValues: Record<string, boolean> = {
      "": false,
      "0": false,
      false: false,
      no: false,
      "1": true,
      tbc: true,
      true: true,
      yes: true,
    };
    if (!(rawTbc in tbcValues)) {
      await interaction.reply({
        content: "TBC must be true, false, yes, no, 1, 0, or tbc.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await executeAdd(
      interaction,
      interaction.fields.getTextInputValue("input"),
      {
        char: interaction.fields.getTextInputValue("char"),
        tbc: tbcValues[rawTbc],
      },
    );
  },
  [SIGNUP_MODAL_REMOVE_ID]: (interaction) =>
    executeRemove(
      interaction,
      interaction.fields.getTextInputValue("position"),
    ),
  [SIGNUP_MODAL_TBC_ID]: (interaction) =>
    executeTbc(interaction, interaction.fields.getTextInputValue("input")),
  [SIGNUP_MODAL_CHARNOTE_ID]: (interaction) =>
    executeCharNote(
      interaction,
      interaction.fields.getTextInputValue("note"),
      interaction.fields.getTextInputValue("position"),
    ),
  [SIGNUP_MODAL_REMOVE_CHARNOTE_ID]: (interaction) =>
    executeRemoveCharNote(
      interaction,
      interaction.fields.getTextInputValue("input"),
    ),
  [SIGNUP_MODAL_SWAP_ID]: (interaction) =>
    executeSwap(
      interaction,
      interaction.fields.getTextInputValue("first"),
      interaction.fields.getTextInputValue("second"),
    ),
};

/** Dispatches a signup modal submission to its setup or simple-action handler. */
export const handleSignupModal = async (
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  if (
    interaction.customId === SETUP_MODAL_ID ||
    interaction.customId === CHANGE_ALL_MODAL_ID
  ) {
    await handleSetupModal(interaction);
    return;
  }
  await SIMPLE_SIGNUP_MODAL_HANDLERS[interaction.customId]?.(interaction);
};

/** Prompts the setup owner to send their edited roster text as their next channel message. */
export const handleSignupRosterButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  if (!interaction.guildId || !interaction.channelId) return;
  const key = signupSheetKey(interaction.guildId, interaction.channelId);
  const sheet = pendingSetupDrafts.get(key);
  if (!sheet || pendingRosterUsers.get(key) !== interaction.user.id) {
    await interaction.reply({
      content: "This roster setup expired or belongs to another user.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferUpdate();
  await interaction.editReply({
    content: getRosterPrompt(sheet.slots, sheet.partySizes),
    components: [buildRosterPromptButtons()],
  });
};

/** Reopens the setup modal, pre-filled from the in-progress pending draft, without losing other edits. */
export const handleSignupEditPartySetupButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  if (!interaction.guildId || !interaction.channelId) return;
  const key = signupSheetKey(interaction.guildId, interaction.channelId);
  const sheet = pendingSetupDrafts.get(key);
  if (!sheet || pendingRosterUsers.get(key) !== interaction.user.id) {
    await interaction.reply({
      content: "This roster setup expired or belongs to another user.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await showSetup(interaction, sheet);
};

/** Swaps the setup prompt for the instance-type select menu. */
export const handleSignupInstanceTypeButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  if (!interaction.guildId || !interaction.channelId) return;
  const key = signupSheetKey(interaction.guildId, interaction.channelId);
  const sheet = pendingSetupDrafts.get(key);
  if (!sheet || pendingRosterUsers.get(key) !== interaction.user.id) {
    await interaction.reply({
      content: "This roster setup expired or belongs to another user.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferUpdate();
  await interaction.editReply({
    content: "Select the instance type for this run.",
    components: [
      buildInstanceTypeSelectRow(
        sheet.instanceType,
        DISCORD_SETTINGS.cooldownInstanceTypesByGuild[interaction.guildId] ??
          COOLDOWN_INSTANCE_TYPES,
      ),
    ],
  });
};

/** Applies the selected instance type to the pending draft and restores the setup prompt buttons. */
export const handleSignupInstanceTypeSelect = async (
  interaction: StringSelectMenuInteraction,
): Promise<void> => {
  if (!interaction.guildId || !interaction.channelId) return;
  const key = signupSheetKey(interaction.guildId, interaction.channelId);
  const sheet = pendingSetupDrafts.get(key);
  if (!sheet || pendingRosterUsers.get(key) !== interaction.user.id) {
    await interaction.reply({
      content: "This roster setup expired or belongs to another user.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferUpdate();
  const [value] = interaction.values;
  sheet.instanceType =
    value === INSTANCE_TYPE_NONE_VALUE ? null : (value ?? null);
  await interaction.editReply({
    content: SETUP_PROMPT_CONTENT,
    components: [buildSetupPromptButtons()],
  });
};

/** Saves the pending draft as-is (no roster changes) and publishes the signup sheet embed. */
export const handleSignupNoRosterChangesButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  if (!interaction.guildId || !interaction.channelId) return;
  const key = signupSheetKey(interaction.guildId, interaction.channelId);
  const sheet = pendingSetupDrafts.get(key);
  if (!sheet || pendingRosterUsers.get(key) !== interaction.user.id) {
    await interaction.reply({
      content: "This roster setup expired or belongs to another user.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply();
  pendingSetupDrafts.delete(key);
  pendingSetupSnapshots.delete(key);
  pendingRosterUsers.delete(key);
  if (interaction.message && typeof interaction.message.edit === "function") {
    try {
      await interaction.message.edit({ components: [] });
    } catch {
      // Ignore cleanup error
    }
  }
  await saveSignupSheet(sheet);
  await publish(interaction, sheet);
};

/**
 * Handles the setup owner's next channel message as either edited roster text
 * (updates the pending draft only; publishing still requires Save Changes) or,
 * separately, updated `/note` text (`remove` clears it), which saves immediately
 * and posts the public notice after the refreshed sheet is published.
 */
export const handleSignupRosterMessage = async (
  message: Message,
): Promise<void> => {
  if (!message.guildId || message.author.bot) return;
  const key = signupSheetKey(message.guildId, message.channelId);
  if (pendingRosterUsers.get(key) === message.author.id) {
    const sheet = pendingSetupDrafts.get(key);
    const parsedRoster = sheet
      ? parseRosterWithPartySizes(message.content, sheet.slots)
      : null;
    if (!sheet || !parsedRoster) {
      await message.reply(
        "Roster lines must be continuous, match the party total, and use `01: Role - name` or `01: Role`.",
      );
      return;
    }
    const droppedOccupiedSlots = sheet.slots
      .slice(parsedRoster.slots.length)
      .filter((slot) => slot.signupUserId || slot.signupDisplayName);
    if (droppedOccupiedSlots.length > 0) {
      const droppedLabels = droppedOccupiedSlots
        .map((slot) => formatSlotLabel(slot))
        .join(", ");
      await message.reply(
        `Reducing party sizes would drop signups in slot(s): ${droppedLabels}. Remove or move those players before shrinking party sizes.`,
      );
      return;
    }
    await resolveRosterSignupUserIds(parsedRoster.slots, message);
    sheet.slots = parsedRoster.slots;
    if (parsedRoster.partySizes) sheet.partySizes = parsedRoster.partySizes;
    await message.reply({
      content: "Roster updated.",
      components: [buildSetupPromptButtons()],
    });
    return;
  }
  if (pendingNoteUsers.get(key) !== message.author.id) return;
  pendingNoteUsers.delete(key);
  const noteContent = message.content.trim();
  const updatedNotes =
    noteContent.toLowerCase() === "remove" ? null : noteContent || null;
  const { sheet, error } = await mutateSignupSheet(
    message.guildId,
    message.channelId,
    (s) => {
      s.notes = updatedNotes;
      return null;
    },
  );
  if (!sheet || error) {
    await message.reply(
      "There is no signup sheet in this text channel. Use `/newrun` first.",
    );
    return;
  }
  const noticeInteraction = {
    guildId: message.guildId,
    channelId: message.channelId,
    channel: message.channel,
    guild: message.guild,
    user: message.author,
    reply: (options: unknown) => message.reply(options as never),
    followUp: (options: unknown) => message.reply(options as never),
    deferred: false,
    replied: false,
  } as never;
  await publish(noticeInteraction, sheet);
  await sendSignupNotice(
    noticeInteraction,
    `**${message.author.displayName}** has ${updatedNotes ? "added" : "removed"} a note:\n${updatedNotes ?? "None"}`,
  );
};

/** Reverts the setup session to its pre-setup snapshot (or deletes a brand-new sheet) and clears pending state. */
export const handleSignupCancelSetupButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  if (!interaction.guildId || !interaction.channelId) return;
  const key = signupSheetKey(interaction.guildId, interaction.channelId);
  if (pendingRosterUsers.get(key) !== interaction.user.id) {
    await interaction.reply({
      content: "This roster setup expired or belongs to another user.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferUpdate();
  const snapshot = pendingSetupSnapshots.get(key);
  if (snapshot === undefined) {
    await interaction.editReply({
      content: "This setup is no longer pending and cannot be canceled.",
      components: [],
    });
    return;
  }
  pendingSetupSnapshots.delete(key);
  pendingSetupDrafts.delete(key);
  pendingRosterUsers.delete(key);
  await interaction.editReply({
    content: "Setup discarded; no changes saved.",
    components: [],
  });
};

/** Applies a confirmed `/add` overwrite to the previously-occupied slot(s) and notifies affected users. */
export const handleSignupAddConfirmButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  if (!interaction.guildId || !interaction.channelId) return;
  const key = addConfirmationKey(
    interaction.guildId,
    interaction.channelId,
    interaction.user.id,
  );
  const pending = pendingAddConfirmations.get(key);
  pendingAddConfirmations.delete(key);
  if (!pending) {
    await interaction.update({
      content: "This confirmation has expired.",
      components: [],
    });
    return;
  }
  const appliedLabels: string[] = [];
  const { sheet, error } = await mutateSignupSheet(
    interaction.guildId,
    interaction.channelId,
    (s) => {
      for (const number of pending.slotNumbers) {
        const slot = s.slots.find((candidate) => candidate.number === number);
        if (!slot) continue;
        slot.signupUserId = pending.userId;
        slot.signupDisplayName = pending.displayName;
        slot.charNote = pending.charNote;
        slot.isTbc = pending.isTbc;
        appliedLabels.push(formatSlotLabel(slot));
      }
      return null;
    },
  );
  if (!sheet || error) {
    await interaction.update({
      content: "There is no signup sheet in this text channel anymore.",
      components: [],
    });
    return;
  }
  await interaction.update({
    content: "Signup updated.",
    components: [],
  });
  await publishToChannel(interaction, sheet);
  await sendActionNotices(
    interaction,
    "added",
    [{ userId: pending.userId, labels: appliedLabels }],
    sheet.title,
    formatAddNoticeDetail(pending.charNote, pending.isTbc),
    pending.randomSlotNumber,
  );
};

/** Discards a pending `/add` overwrite confirmation without changing the sheet. */
export const handleSignupAddCancelButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  if (!interaction.guildId || !interaction.channelId) return;
  const key = addConfirmationKey(
    interaction.guildId,
    interaction.channelId,
    interaction.user.id,
  );
  pendingAddConfirmations.delete(key);
  await interaction.update({
    content: "No changes were made.",
    components: [],
  });
};
