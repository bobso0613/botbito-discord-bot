import {
  ActionRowBuilder,
  ApplicationIntegrationType,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Message,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  deleteSignupSheet,
  getSignupSheet,
  saveSignupSheet,
} from "../services/signup-sheet.service.js";
import { SIGNUP_GUILD_IDS } from "../config/discord-settings.js";
import { COOLDOWN_INSTANCE_TYPES } from "../constants/cooldowns.js";
import {
  buildSignupSheetEmbed,
  formatSignupSchedule,
  SIGNUP_COMMANDS_HELP_TEXT,
} from "../templates/signup-sheet.template.js";
import type { Command } from "../types/command.js";
import type { SignupSheet, SignupSlot } from "../types/signup-sheet.js";
import {
  createEmptySlots,
  formatNewRunDate,
  formatSlotLabel,
  getDefaultRoster,
  getInvokingUserSlot,
  getRosterPrompt,
  mergeActionNotices,
  parseNewRunTimestamp,
  parseRoster,
  parseServerTimezone,
  parseTimeShift,
  pickRandomOpenSlot,
  resolveRosterSignupUserIds,
  type ActionNotice,
} from "../utils/signup-sheet.js";

const SETUP_MODAL_ID = "signup-setup";
const CHANGE_ALL_MODAL_ID = "signup-change-all";
export const SIGNUP_ROSTER_BUTTON_ID = "signup-add-roster";
export const SIGNUP_NO_ROSTER_CHANGES_BUTTON_ID = "signup-no-roster-changes";
export const SIGNUP_CANCEL_SETUP_BUTTON_ID = "signup-cancel-setup";
export const SIGNUP_ADD_CONFIRM_BUTTON_ID = "signup-add-confirm";
export const SIGNUP_ADD_CANCEL_BUTTON_ID = "signup-add-cancel";
export const SIGNUP_INFO_BUTTON_ID = "signup-info";
export const SIGNUP_INSTANCE_TYPE_BUTTON_ID = "signup-instance-type";
export const SIGNUP_INSTANCE_TYPE_SELECT_ID = "signup-instance-type-select";
export const SIGNUP_EDIT_PARTY_SETUP_BUTTON_ID = "signup-edit-party-setup";
const INSTANCE_TYPE_NONE_VALUE = "none";

/** Builds the instance-type select menu row, pre-selecting the sheet's current instance type (or "None"). */
const buildInstanceTypeSelectRow = (
  currentInstanceType: string | null,
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
        ...COOLDOWN_INSTANCE_TYPES.filter((type) => type.name !== "Others").map(
          (type) => ({
            label: `${type.emoji} ${type.name}`,
            value: type.name,
            default: currentInstanceType === type.name,
          }),
        ),
      ),
  );

/** Builds the button row shown after party setup: edit roster/party setup/instance type, save, or cancel. */
const buildSetupPromptButtons = (): ActionRowBuilder<ButtonBuilder> =>
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

const SETUP_PROMPT_CONTENT =
  "Party setup saved. Complete the roster to post the signup sheet.";

/** Builds the row attached to every published signup sheet embed with the "Show list of commands" button. */
const buildSignupSheetComponents = (): ActionRowBuilder<ButtonBuilder>[] => [
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SIGNUP_INFO_BUTTON_ID)
      .setLabel("Show list of commands")
      .setStyle(ButtonStyle.Primary),
  ),
];

/** Replies ephemerally with the full signup command reference; used by the "Show list of commands" button. */
export const handleSignupInfoButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  await interaction.reply({
    content: SIGNUP_COMMANDS_HELP_TEXT,
    flags: MessageFlags.Ephemeral,
  });
};

const pendingSetupSnapshots = new Map<string, SignupSheet | null>();
const pendingSetupDrafts = new Map<string, SignupSheet>();
const pendingRosterUsers = new Map<string, string>();
const pendingNoteUsers = new Map<string, string>();
interface PendingAddConfirmation {
  userId: string;
  displayName: string;
  slotNumbers: number[];
}
const pendingAddConfirmations = new Map<string, PendingAddConfirmation>();
const signupSheetKey = (guildId: string, channelId: string): string =>
  `${guildId}:${channelId}`;
const addConfirmationKey = (
  guildId: string,
  channelId: string,
  userId: string,
): string => `${signupSheetKey(guildId, channelId)}:${userId}`;

const input = (
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

/** Fetches this channel's signup sheet, or `null` outside a guild text channel or when none exists. */
const getSheet = async (
  interaction: ChatInputCommandInteraction,
): Promise<SignupSheet | null> => {
  if (!interaction.guildId || !interaction.channelId) return null;
  return getSignupSheet(interaction.guildId, interaction.channelId);
};

/** Replies (or edits an existing deferred reply) telling the user this channel has no signup sheet yet. */
const replyMissing = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const content =
    "There is no signup sheet in this text channel. Use `/newrun` first.";
  if (interaction.deferred) {
    await interaction.editReply(content);
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
};

/** Saves the sheet and replies (or edits a deferred reply) with its embed and command-list button. */
const publish = async (
  interaction: ChatInputCommandInteraction,
  sheet: SignupSheet,
): Promise<void> => {
  await saveSignupSheet(sheet);
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
  if (interaction.deferred) await interaction.editReply(response);
  else await interaction.reply(response);
};

const parseTimestamp = (value: string): number | null => {
  const unix = Number(value);
  if (/^\d+$/.test(value) && Number.isSafeInteger(unix))
    return unix > 10_000_000_000 ? Math.floor(unix / 1000) : unix;
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? null : Math.floor(milliseconds / 1000);
};

/**
 * Validates the setup modal fields and builds the resulting sheet.
 * The datetime field may be blank or `TBD` to keep the schedule unset, except
 * when creating a brand-new sheet (`existingSheet` is `undefined`), where a
 * valid date/time is required.
 */
const parseSetup = (
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
  if (
    !title ||
    (datetimeValue && !isDatetimeTbd && !schedule) ||
    (!datetimeValue && !existingSheet) ||
    serverTimezone === undefined ||
    !Number.isInteger(partyCount) ||
    partyCount < 1 ||
    partySizes.length !== partyCount ||
    partySizes.some((size) => !Number.isInteger(size) || size < 1)
  ) {
    return {
      error:
        "Use date/time `DD/MM HH:MM GMT+8` (or `TBD`/blank to keep the schedule TBD), a server timezone such as `GMT+8`, and valid party sizes.",
    };
  }
  return {
    sheet: {
      guildId: interaction.guildId!,
      channelId: interaction.channelId!,
      title,
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
    },
  };
};

/** Shows the create/change party setup modal, pre-filled from `existingSheet` when editing. */
const showSetup = async (
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
export const handleSignupModal = async (
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  const isSignupModal = [SETUP_MODAL_ID, CHANGE_ALL_MODAL_ID].includes(
    interaction.customId,
  );
  if (!isSignupModal) return;
  await interaction.deferReply({
    flags:
      interaction.customId === SETUP_MODAL_ID ||
      interaction.customId === CHANGE_ALL_MODAL_ID
        ? MessageFlags.Ephemeral
        : undefined,
  });
  if (
    interaction.customId === SETUP_MODAL_ID ||
    interaction.customId === CHANGE_ALL_MODAL_ID
  ) {
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
    return;
  }
};

/** Prompts the setup owner to send their edited roster text as their next channel message. */
export const handleSignupRosterButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  if (!interaction.guildId || !interaction.channelId) return;
  await interaction.deferUpdate();
  const key = signupSheetKey(interaction.guildId, interaction.channelId);
  const sheet = pendingSetupDrafts.get(key);
  if (!sheet || pendingRosterUsers.get(key) !== interaction.user.id) {
    await interaction.editReply({
      content: "This roster setup expired or belongs to another user.",
      components: [],
    });
    return;
  }
  await interaction.editReply({
    content: getRosterPrompt(sheet.slots),
    components: [],
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
  await interaction.deferUpdate();
  const key = signupSheetKey(interaction.guildId, interaction.channelId);
  const sheet = pendingSetupDrafts.get(key);
  if (!sheet || pendingRosterUsers.get(key) !== interaction.user.id) {
    await interaction.editReply({
      content: "This roster setup expired or belongs to another user.",
      components: [],
    });
    return;
  }
  await interaction.editReply({
    content: "Select the instance type for this run.",
    components: [buildInstanceTypeSelectRow(sheet.instanceType)],
  });
};

/** Applies the selected instance type to the pending draft and restores the setup prompt buttons. */
export const handleSignupInstanceTypeSelect = async (
  interaction: StringSelectMenuInteraction,
): Promise<void> => {
  if (!interaction.guildId || !interaction.channelId) return;
  await interaction.deferUpdate();
  const key = signupSheetKey(interaction.guildId, interaction.channelId);
  const sheet = pendingSetupDrafts.get(key);
  if (!sheet || pendingRosterUsers.get(key) !== interaction.user.id) {
    await interaction.editReply({
      content: "This roster setup expired or belongs to another user.",
      components: [],
    });
    return;
  }
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
  await saveSignupSheet(sheet);
  pendingSetupDrafts.delete(key);
  pendingSetupSnapshots.delete(key);
  pendingRosterUsers.delete(key);
  await interaction.editReply({
    content: "",
    embeds: [
      buildSignupSheetEmbed(
        sheet,
        interaction.guild?.name ?? "Direct Message",
        interaction.guild?.iconURL({ extension: "png", size: 512 }) ?? null,
      ),
    ],
    components: buildSignupSheetComponents(),
  });
};

/**
 * Handles the setup owner's next channel message as either edited roster text
 * (updates the pending draft only; publishing still requires Save Changes) or,
 * separately, updated `/note` text (`remove` clears it), which saves immediately.
 */
export const handleSignupRosterMessage = async (
  message: Message,
): Promise<void> => {
  if (!message.guildId || message.author.bot) return;
  const key = signupSheetKey(message.guildId, message.channelId);
  if (pendingRosterUsers.get(key) === message.author.id) {
    const sheet = pendingSetupDrafts.get(key);
    const slots = sheet ? parseRoster(message.content, sheet.slots) : null;
    if (!sheet || !slots) {
      await message.reply(
        "Roster lines must be continuous, match the party total, and use `01: Role - name` or `01: Role`.",
      );
      return;
    }
    await resolveRosterSignupUserIds(slots, message);
    sheet.slots = slots;
    await message.reply({
      content: "Roster updated.",
      components: [buildSetupPromptButtons()],
    });
    return;
  }
  if (pendingNoteUsers.get(key) !== message.author.id) return;
  const sheet = await getSignupSheet(message.guildId, message.channelId);
  if (!sheet) {
    pendingNoteUsers.delete(key);
    await message.reply(
      "There is no signup sheet in this text channel. Use `/newrun` first.",
    );
    return;
  }
  sheet.notes =
    message.content.trim().toLowerCase() === "remove"
      ? null
      : message.content.trim() || null;
  await saveSignupSheet(sheet);
  pendingNoteUsers.delete(key);
  await message.reply({
    embeds: [
      buildSignupSheetEmbed(
        sheet,
        message.guild?.name ?? "Direct Message",
        message.guild?.iconURL({ extension: "png", size: 512 }) ?? null,
      ),
    ],
    components: buildSignupSheetComponents(),
  });
};

/** Reverts the setup session to its pre-setup snapshot (or deletes a brand-new sheet) and clears pending state. */
export const handleSignupCancelSetupButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  if (!interaction.guildId || !interaction.channelId) return;
  await interaction.deferUpdate();
  const key = signupSheetKey(interaction.guildId, interaction.channelId);
  const snapshot = pendingSetupSnapshots.get(key);
  if (snapshot === undefined) {
    await interaction.editReply(
      "This setup is no longer pending and cannot be canceled.",
    );
    return;
  }
  if (snapshot) await saveSignupSheet(snapshot);
  else await deleteSignupSheet(interaction.guildId, interaction.channelId);
  pendingSetupSnapshots.delete(key);
  pendingSetupDrafts.delete(key);
  pendingRosterUsers.delete(key);
  await interaction.editReply({
    content: snapshot
      ? "Party setup changes were reverted."
      : "New signup sheet discarded.",
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
  const sheet = await getSignupSheet(
    interaction.guildId,
    interaction.channelId,
  );
  if (!sheet) {
    await interaction.update({
      content: "There is no signup sheet in this text channel anymore.",
      components: [],
    });
    return;
  }
  for (const number of pending.slotNumbers) {
    const slot = sheet.slots.find((candidate) => candidate.number === number);
    if (!slot) continue;
    slot.signupUserId = pending.userId;
    slot.signupDisplayName = pending.displayName;
    slot.charNote = null;
  }
  await saveSignupSheet(sheet);
  await interaction.update({
    content: "",
    embeds: [
      buildSignupSheetEmbed(
        sheet,
        interaction.guild?.name ?? "Direct Message",
        interaction.guild?.iconURL({ extension: "png", size: 512 }) ?? null,
      ),
    ],
    components: buildSignupSheetComponents(),
  });
  const appliedLabels = pending.slotNumbers
    .map((number) => sheet.slots.find((slot) => slot.number === number))
    .filter((slot): slot is SignupSlot => Boolean(slot))
    .map(formatSlotLabel);
  await sendActionNotices(
    interaction,
    "added",
    [{ userId: pending.userId, labels: appliedLabels }],
    sheet.title,
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

/** Loads the sheet, applies `mutate`, and publishes on success; replies with `mutate`'s returned error otherwise. */
const update = async (
  interaction: ChatInputCommandInteraction,
  mutate: (sheet: SignupSheet) => string | null,
): Promise<SignupSheet | null> => {
  const sheet = await getSheet(interaction);
  if (!sheet) {
    await replyMissing(interaction);
    return null;
  }
  const error = mutate(sheet);
  if (error) {
    if (interaction.deferred) await interaction.editReply(error);
    else
      await interaction.reply({
        content: error,
        flags: MessageFlags.Ephemeral,
      });
    return null;
  }
  await publish(interaction, sheet);
  return sheet;
};

// Reports each affected slot/reserve change as an ephemeral note to the invoker (if it was their own signup) or a public mention to whoever else was affected.
const sendActionNotices = async (
  interaction: ChatInputCommandInteraction | ButtonInteraction,
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

const restrictToGuild = (command: Command): Command => ({
  ...command,
  guildIds: SIGNUP_GUILD_IDS,
  data: command.data
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild),
  execute: async (interaction) => {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Signup sheets can only be used in a server text channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await command.execute(interaction);
  },
});

const setupCommand = (name: "newrun", description: string): Command => ({
  data: new SlashCommandBuilder().setName(name).setDescription(description),
  execute: async (interaction) => {
    const existingSheet = await getSheet(interaction);
    if (existingSheet) {
      await interaction.reply({
        content:
          "A signup sheet already exists in this text channel. Use `/change all` to update it.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await showSetup(interaction);
  },
});
const positionOption = (builder: SlashCommandBuilder): SlashCommandBuilder =>
  builder.addStringOption((option) =>
    option
      .setName("position")
      .setDescription(
        "Slot number(s) comma-separated, or reserve (blank removes all your signups)",
      )
      .setRequired(false),
  ) as unknown as SlashCommandBuilder;

const signupCommandDefinitions: Command[] = [
  setupCommand("newrun", "Create a signup sheet in this channel"),
  {
    data: new SlashCommandBuilder()
      .setName("change")
      .setDescription("Change a role or the complete party setup")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("position")
          .setDescription("Change a slot role without removing its signup")
          .addStringOption((option) =>
            option
              .setName("value")
              .setDescription("New role")
              .setRequired(true),
          )
          .addIntegerOption((option) =>
            option
              .setName("position")
              .setDescription("Slot number")
              .setRequired(false),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("all")
          .setDescription("Change the complete party setup"),
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("roster").setDescription("Change only the roster"),
      ) as unknown as SlashCommandBuilder,
    execute: async (interaction) => {
      const sheet = await getSheet(interaction);
      if (!sheet) {
        await replyMissing(interaction);
        return;
      }
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "all") {
        await showSetup(interaction, sheet);
        return;
      }
      if (subcommand === "roster") {
        const key = signupSheetKey(
          interaction.guildId!,
          interaction.channelId!,
        );
        pendingSetupDrafts.set(key, sheet);
        pendingRosterUsers.set(key, interaction.user.id);
        await interaction.reply({
          content: getRosterPrompt(sheet.slots),
        });
        return;
      }
      const position = interaction.options.getInteger("position");
      const slot = position
        ? sheet.slots.find((candidate) => candidate.number === position)
        : getInvokingUserSlot(sheet, interaction.user.id);
      if (!slot) {
        await interaction.reply({
          content: "That slot does not exist.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      slot.role = interaction.options.getString("value", true);
      await publish(interaction, sheet);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("name")
      .setDescription("Set the run title")
      .addStringOption((o) =>
        o.setName("input").setDescription("Run name").setRequired(true),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        s.title = i.options.getString("input", true);
        return null;
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("note")
      .setDescription("Edit important notes"),
    execute: async (i) => {
      const sheet = await getSheet(i);
      if (!sheet) {
        await replyMissing(i);
        return;
      }
      pendingNoteUsers.set(signupSheetKey(i.guildId!, i.channelId!), i.user.id);
      await i.reply({
        content: `Current notes:\n\`\`\`\n${sheet.notes?.trim() || "None"}\n\`\`\`\nSend your updated notes as your next message in this channel, or type \`remove\` to clear them.`,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("setpic")
      .setDescription("Set the sheet thumbnail")
      .addStringOption((o) =>
        o.setName("url").setDescription("Image URL").setRequired(true),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        const url = i.options.getString("url", true);
        if (!/^https?:\/\//i.test(url)) return "Provide an http(s) image URL.";
        s.thumbnailUrl = url;
        return null;
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("color")
      .setDescription("Set the embed color")
      .addStringOption((o) =>
        o
          .setName("hexcodecolor")
          .setDescription("Hex color, e.g. #00b0f4")
          .setRequired(true),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        const value = i.options
          .getString("hexcodecolor", true)
          .replace(/^#/, "");
        if (!/^[\da-f]{6}$/i.test(value))
          return "Provide a six-digit hex color, e.g. `#00b0f4`.";
        s.color = Number.parseInt(value, 16);
        return null;
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("setservertimezone")
      .setDescription("Set the server timezone")
      .addStringOption((o) =>
        o
          .setName("timezone")
          .setDescription("GMT, GMT+8, GMT-5, etc.")
          .setRequired(true),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        const timezone = parseServerTimezone(
          i.options.getString("timezone", true),
        );
        if (timezone === undefined)
          return "Use a server timezone such as `GMT`, `GMT+8`, or `GMT-5`.";
        s.serverTimezone = timezone;
        return null;
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("setinstancetype")
      .setDescription("Set the instance type for this run")
      .addStringOption((o) =>
        o
          .setName("type")
          .setDescription("Instance type")
          .setRequired(true)
          .addChoices(
            { name: "None", value: INSTANCE_TYPE_NONE_VALUE },
            ...COOLDOWN_INSTANCE_TYPES.filter(
              (type) => type.name !== "Others",
            ).map((type) => ({ name: type.name, value: type.name })),
          ),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        const type = i.options.getString("type", true);
        s.instanceType = type === INSTANCE_TYPE_NONE_VALUE ? null : type;
        return null;
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("add")
      .setDescription("Sign up for a slot or reserve")
      .addStringOption((option) =>
        option
          .setName("input")
          .setDescription(
            "Slot number(s), `random`, or `reserve`, optionally followed by @user",
          )
          .setRequired(true),
      ) as SlashCommandBuilder,
    execute: async (interaction) => {
      const sheet = await getSheet(interaction);
      if (!sheet) {
        await replyMissing(interaction);
        return;
      }
      const [rawPosition, ...rest] = interaction.options
        .getString("input", true)
        .trim()
        .split(/\s+/);
      const positionInput = rawPosition?.toLowerCase();
      if (!positionInput) {
        await interaction.reply({
          content:
            "Provide a slot number, `random`, comma-separated slot numbers, or `reserve` to add a user.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const mentionText = rest.join(" ").trim();
      let targetUser = interaction.user;
      if (mentionText) {
        const mentionMatch = /^<@!?(\d+)>$/.exec(mentionText);
        const mentionedUser = mentionMatch
          ? await interaction.client.users
              .fetch(mentionMatch[1])
              .catch(() => null)
          : null;
        if (!mentionedUser) {
          await interaction.reply({
            content:
              "Provide a valid user mention after the slot, e.g. `2 @user`.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        targetUser = mentionedUser;
      }
      if (positionInput === "reserve") {
        const sheetAfterUpdate = await update(interaction, (s) => {
          if (s.reserves.some((r) => r.userId === targetUser.id))
            return "That user is already a reserve.";
          s.reserves.push({
            userId: targetUser.id,
            displayName: targetUser.displayName,
            charNote: null,
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
          await interaction.reply({
            content: "There are no open slots available.",
            flags: MessageFlags.Ephemeral,
          });
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
          await interaction.reply({
            content: invalid.length
              ? `These slot numbers do not exist: ${invalid.join(", ")}.`
              : "Provide at least one valid slot number.",
            flags: MessageFlags.Ephemeral,
          });
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
      await interaction.reply({
        content: `Slot${plural ? "s" : ""} ${occupiedSlotNumbers.join(", ")} already ${plural ? "have" : "has"} a signup. Replace with **${targetUser.displayName}**?`,
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(SIGNUP_ADD_CONFIRM_BUTTON_ID)
              .setLabel("Yes")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(SIGNUP_ADD_CANCEL_BUTTON_ID)
              .setLabel("No")
              .setStyle(ButtonStyle.Danger),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("a")
      .setDescription("Alias for add")
      .addStringOption((option) =>
        option
          .setName("input")
          .setDescription(
            "Slot number(s), `random`, or `reserve`, optionally followed by @user",
          )
          .setRequired(true),
      ) as SlashCommandBuilder,
    execute: (i) =>
      signupCommands.find((c) => c.data.name === "add")!.execute(i),
  },
  {
    data: positionOption(
      new SlashCommandBuilder()
        .setName("remove")
        .setDescription("Remove a signup or reserve"),
    ),
    execute: async (i) => {
      const removedEntries: { userId: string; label: string }[] = [];
      const sheetAfterUpdate = await update(i, (s) => {
        const position = i.options.getString("position")?.toLowerCase().trim();
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
    },
  },
  {
    data: positionOption(
      new SlashCommandBuilder().setName("r").setDescription("Alias for remove"),
    ),
    execute: (i) =>
      signupCommands.find((c) => c.data.name === "remove")!.execute(i),
  },
  {
    data: new SlashCommandBuilder()
      .setName("clear")
      .setDescription("Clear the roster, schedule, or both")
      .addStringOption((o) =>
        o
          .setName("which")
          .setDescription("What to clear")
          .setRequired(true)
          .addChoices(
            { name: "Roster", value: "roster" },
            { name: "Schedule", value: "schedule" },
            { name: "All", value: "all" },
          ),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        const which = i.options.getString("which", true);
        if (which === "roster" || which === "all") {
          for (const slot of s.slots) {
            slot.signupUserId = null;
            slot.signupDisplayName = null;
            slot.charNote = null;
          }
          s.reserves = [];
        }
        if (which === "schedule" || which === "all") {
          s.timestamp = null;
          s.scheduleTimezone = null;
        }
        return null;
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("c")
      .setDescription("Alias for clear")
      .addStringOption((o) =>
        o
          .setName("which")
          .setDescription("What to clear")
          .setRequired(true)
          .addChoices(
            { name: "Roster", value: "roster" },
            { name: "Schedule", value: "schedule" },
            { name: "All", value: "all" },
          ),
      ) as SlashCommandBuilder,
    execute: (i) =>
      signupCommands.find((c) => c.data.name === "clear")!.execute(i),
  },
  {
    data: new SlashCommandBuilder()
      .setName("swap")
      .setDescription("Join a slot or swap two slots")
      .addStringOption((o) =>
        o
          .setName("first")
          .setDescription("Your or first slot number, or reserve")
          .setRequired(true),
      )
      .addStringOption((o) =>
        o.setName("second").setDescription("Second slot number or reserve"),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      const swapEntries: { userId: string; label: string }[] = [];
      const sheetAfterUpdate = await update(i, (s) => {
        const firstValue = i.options.getString("first", true).toLowerCase();
        const secondValue = i.options.getString("second")?.toLowerCase();
        if (firstValue === "reserve") {
          if (secondValue)
            return "Use `/swap first:reserve` without a second slot.";
          const currentSlot = getInvokingUserSlot(s, i.user.id);
          if (!currentSlot)
            return "You must be signed up in a party slot to move to reserves.";
          if (s.reserves.some((reserve) => reserve.userId === i.user.id))
            return "You are already a reserve.";
          s.reserves.push({
            userId: i.user.id,
            displayName: i.user.displayName,
            charNote: currentSlot.charNote,
          });
          currentSlot.signupUserId = null;
          currentSlot.signupDisplayName = null;
          currentSlot.charNote = null;
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
          (secondValue &&
            secondValue !== "reserve" &&
            !second &&
            !secondReserve)
        )
          return "One of those slots does not exist.";
        if (secondValue === "reserve") {
          if (!first.signupUserId)
            return "That party slot does not have a signup to move to reserves.";
          if (
            s.reserves.some((reserve) => reserve.userId === first.signupUserId)
          )
            return "That user is already a reserve.";
          const movedUserId = first.signupUserId;
          s.reserves.push({
            userId: first.signupUserId,
            displayName: first.signupDisplayName ?? "Unknown user",
            charNote: first.charNote,
          });
          first.signupUserId = null;
          first.signupDisplayName = null;
          first.charNote = null;
          swapEntries.push({ userId: movedUserId, label: "Reserve" });
          return null;
        }
        if (secondReserve) {
          const firstSignup = first.signupUserId
            ? {
                userId: first.signupUserId,
                displayName: first.signupDisplayName ?? "Unknown user",
                charNote: first.charNote,
              }
            : null;
          first.signupUserId = secondReserve.userId;
          first.signupDisplayName = secondReserve.displayName;
          first.charNote = secondReserve.charNote;
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
          const currentSlot = getInvokingUserSlot(s, i.user.id);
          const reserveIndex = s.reserves.findIndex(
            (reserve) => reserve.userId === i.user.id,
          );
          const reserve =
            reserveIndex === -1 ? null : (s.reserves[reserveIndex] ?? null);
          const previousCharNote =
            currentSlot?.charNote ?? reserve?.charNote ?? null;
          if (currentSlot && currentSlot !== first) {
            currentSlot.signupUserId = null;
            currentSlot.signupDisplayName = null;
            currentSlot.charNote = null;
          }
          if (reserveIndex !== -1) s.reserves.splice(reserveIndex, 1);
          [first.signupUserId, first.signupDisplayName, first.charNote] = [
            i.user.id,
            i.user.displayName,
            previousCharNote,
          ];
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
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("charnote")
      .setDescription("Set a character note")
      .addStringOption((o) =>
        o.setName("note").setDescription("Character note").setRequired(true),
      )
      .addIntegerOption((o) =>
        o.setName("position").setDescription("Slot").setRequired(false),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        const position = i.options.getInteger("position");
        const slot = position
          ? s.slots.find((candidate) => candidate.number === position)
          : getInvokingUserSlot(s, i.user.id);
        if (!slot)
          return position
            ? "That slot does not exist."
            : "You must be signed up in a party slot when no position is provided.";
        slot.charNote = i.options.getString("note", true);
        return null;
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("char")
      .setDescription("Alias for charnote")
      .addStringOption((o) =>
        o.setName("note").setDescription("Character note").setRequired(true),
      )
      .addIntegerOption((o) =>
        o.setName("position").setDescription("Slot").setRequired(false),
      ) as SlashCommandBuilder,
    execute: (i) =>
      signupCommands.find((c) => c.data.name === "charnote")!.execute(i),
  },
  ...["postpone", "next"].map((name) => ({
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(`${name} the run`)
      .addStringOption((o) =>
        o
          .setName("value")
          .setDescription("For example: next week, last hour, or 1.5 days")
          .setRequired(true),
      ) as SlashCommandBuilder,
    execute: async (i: ChatInputCommandInteraction) => {
      await update(i, (s) => {
        const delta = parseTimeShift(i.options.getString("value", true));
        if (delta === null)
          return "Use `next`, `last`, or a number in 0.5 increments followed by minutes, hours, days, weeks, or months.";
        if (s.timestamp === null)
          return "The schedule is TBD. Set a date first with `/sdt`.";
        s.timestamp += delta;
        if (name === "next")
          for (const slot of s.slots) {
            slot.signupUserId = null;
            slot.signupDisplayName = null;
            slot.charNote = null;
          }
        return null;
      });
    },
  })),
  {
    data: new SlashCommandBuilder()
      .setName("gonow")
      .setDescription("Set the run to now, optionally offset by a duration")
      .addStringOption((o) =>
        o
          .setName("value")
          .setDescription("For example: next week, last hour, or 1.5 days"),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        const value = i.options.getString("value");
        const delta = value ? parseTimeShift(value) : 0;
        if (delta === null)
          return "Use `next`, `last`, or a number in 0.5 increments followed by minutes, hours, days, weeks, or months.";
        s.timestamp = Math.floor(Date.now() / 1000) + delta;
        return null;
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("sdt")
      .setDescription("Set date and time")
      .addStringOption((o) =>
        o
          .setName("datetime")
          .setDescription("Date/time, e.g. 10/09 20:00 GMT+8, or TBD")
          .setRequired(true),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        const datetimeValue = i.options.getString("datetime", true).trim();
        if (/^tbd$/i.test(datetimeValue)) {
          s.timestamp = null;
          s.scheduleTimezone = null;
          return null;
        }
        const schedule = parseNewRunTimestamp(datetimeValue);
        if (!schedule)
          return "Use date/time format `DD/MM HH:MM GMT+8`, or `TBD`.";
        s.timestamp = schedule.timestamp;
        s.scheduleTimezone = schedule.scheduleTimezone;
        return null;
      });
    },
  },
  ...["last", "s", "show"].map((name) => ({
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(
        "Show this channel's signup sheet",
      ) as SlashCommandBuilder,
    execute: async (interaction: ChatInputCommandInteraction) => {
      await interaction.deferReply();
      await update(interaction, () => null);
    },
  })),

  {
    data: new SlashCommandBuilder()
      .setName("when")
      .setDescription("Show the run time"),
    execute: async (i) => {
      const s = await getSheet(i);
      if (!s) {
        await replyMissing(i);
        return;
      }
      await i.reply({
        content: formatSignupSchedule(s),
        flags: MessageFlags.Ephemeral,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Ping signed-up players")
      .addStringOption((o) =>
        o.setName("message").setDescription("Message").setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("which")
          .setDescription("Who to ping")
          .setRequired(true)
          .addChoices(
            { name: "Main Roster", value: "main" },
            { name: "Reserves", value: "reserves" },
            { name: "All", value: "all" },
          ),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      const s = await getSheet(i);
      if (!s) {
        await replyMissing(i);
        return;
      }
      const which = i.options.getString("which", true);
      const mainIds = s.slots.flatMap((slot) =>
        slot.signupUserId ? [slot.signupUserId] : [],
      );
      const reserveIds = s.reserves.map((reserve) => reserve.userId);
      const ids = [
        ...(which === "main" || which === "all" ? mainIds : []),
        ...(which === "reserves" || which === "all" ? reserveIds : []),
      ];
      await i.reply({
        content:
          `Ping from **${i.user.displayName}**: ${i.options.getString("message", true)}\n\n${ids.map((id) => `<@${id}>`).join(" ")}`.trim(),
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("swaporganizer")
      .setDescription("Change the organizer")
      .addUserOption((o) =>
        o.setName("user").setDescription("New organizer").setRequired(true),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        const user = i.options.getUser("user", true);
        s.organizerName = user.displayName;
        s.organizerAvatarUrl = user.displayAvatarURL({
          extension: "png",
          size: 512,
        });
        return null;
      });
    },
  },
];

export const signupCommands: Command[] =
  signupCommandDefinitions.map(restrictToGuild);
