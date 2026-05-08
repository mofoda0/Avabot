const {
  PermissionFlagsBits, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  EmbedBuilder,
} = require('discord.js');

const {
  getAva, saveAva, deleteAva,
  getAvaLeaderRoleId, setAvaLeaderRoleId,
  getHostDefaults, saveHostDefaults, resetHostDefaults,
} = require('../utils/avaData');

const {
  buildAvaEmbed, buildAvaComponents, buildHostPanel,
  buildSetupEmbed, buildManagePanel, getRoleEmoji,
} = require('../utils/avaBuilder');

// messageId → timeout
const massTimers = new Map();

// setupId → draft
const setupDrafts = new Map();

// ── Helpers ────────────────────────────────────────────────────────

async function safeReply(interaction, options) {
  try {
    if (interaction.replied || interaction.deferred) return await interaction.followUp(options);
    return await interaction.reply(options);
  } catch (err) { console.error('❌ AVA safeReply error:', err); }
}

async function updateAvaEmbed(client, ava) {
  try {
    const channel = await client.channels.fetch(ava.channelId).catch(() => null);
    if (!channel) return;
    const message = await channel.messages.fetch(ava.messageId).catch(() => null);
    if (!message) return;
    await message.edit({
      embeds:     [buildAvaEmbed(ava)],
      components: buildAvaComponents(ava),
    });
  } catch (err) { console.error('❌ Could not update AVA embed:', err); }
}

/** Checks AVA Leader role or ManageGuild fallback. Returns true if allowed. */
async function checkLeaderRole(interaction, guildId) {
  const leaderRoleId = getAvaLeaderRoleId(guildId);
  if (leaderRoleId) {
    if (!interaction.member.roles.cache.has(leaderRoleId)) {
      await safeReply(interaction, { content: '❌ You need the **AVA Leader** role to use this command.', flags: MessageFlags.Ephemeral });
      return false;
    }
  } else {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      await safeReply(interaction, { content: '❌ No AVA Leader role configured. Ask the bot owner to run `/setava setleaderrole`.', flags: MessageFlags.Ephemeral });
      return false;
    }
  }
  return true;
}

function buildSetupRows(setupId) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ava_setup_title_${setupId}`).setLabel('Set Title').setEmoji('📌').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ava_setup_desc_${setupId}`).setLabel('Set Description').setEmoji('📝').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ava_setup_image_${setupId}`).setLabel('Set Image/GIF').setEmoji('🖼️').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ava_setup_addrole_${setupId}`).setLabel('Add Role').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ava_setup_editrole_${setupId}`).setLabel('Edit Role').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ava_setup_removerole_${setupId}`).setLabel('Remove Role').setEmoji('➖').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`ava_setup_prefill_${setupId}`).setLabel('Pre-fill Member').setEmoji('👤').setStyle(ButtonStyle.Primary),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ava_setup_invite_${setupId}`).setLabel('Set Invite Link').setEmoji('🔗').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ava_setup_masstime_${setupId}`).setLabel('Set Mass Timer').setEmoji('⏰').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ava_setup_massmsg_${setupId}`).setLabel('Set Mass Message').setEmoji('💬').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ava_setup_pingrole_${setupId}`).setLabel('Set Ping Role').setEmoji('📣').setStyle(ButtonStyle.Secondary),
  );
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ava_setup_launch_${setupId}`).setLabel('🚀 Launch AVA').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ava_setup_cancel_${setupId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
  );
  return [row1, row2, row3, row4];
}

// ── Main handler ───────────────────────────────────────────────────

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    try {
      const guildId = interaction.guildId;

      // ══════════════════════════════════════════════════════════════
      // SLASH COMMANDS
      // ══════════════════════════════════════════════════════════════

      if (interaction.isChatInputCommand() && interaction.commandName === 'setava') {
        const sub = interaction.options.getSubcommand();

        // ── setleaderrole ─────────────────────────────────────────
        if (sub === 'setleaderrole') {
          const ownerIds = (process.env.BOT_OWNER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
          if (!ownerIds.includes(interaction.user.id)) {
            return safeReply(interaction, { content: '❌ Only the bot owner can set the AVA Leader role.', flags: MessageFlags.Ephemeral });
          }
          const role = interaction.options.getRole('role');
          setAvaLeaderRoleId(guildId, role.id);
          return safeReply(interaction, {
            content: `✅ AVA Leader role set to **${role.name}**.`,
            flags: MessageFlags.Ephemeral,
          });
        }

        // ── create ────────────────────────────────────────────────
        if (sub === 'create') {
          if (!await checkLeaderRole(interaction, guildId)) return;

          const setupId  = `${interaction.user.id}_${Date.now()}`;
          const defaults = getHostDefaults(guildId, interaction.user.id);

          setupDrafts.set(setupId, {
            hostId:       interaction.user.id,
            guildId,
            channelId:    interaction.channelId,
            title:        defaults.title,
            description:  defaults.description,
            roles:        defaults.roles,
            signups:      {},
            massMessage:  defaults.massMessage,
            imageUrl:     defaults.imageUrl,
            voiceChannel: defaults.voiceChannel,
            inviteUrl:    defaults.inviteUrl    ?? null,
            massMinutes:  defaults.massMinutes  ?? null,
            massTime:     null,
            pingRoleId:   defaults.pingRoleId   ?? null,
          });

          return safeReply(interaction, {
            embeds:     [buildSetupEmbed(setupDrafts.get(setupId))],
            components: buildSetupRows(setupId),
            flags:      MessageFlags.Ephemeral,
          });
        }

        // ── settimer ──────────────────────────────────────────────
        if (sub === 'settimer') {
          if (!await checkLeaderRole(interaction, guildId)) return;
          const mins     = interaction.options.getInteger('minutes');
          const defaults = getHostDefaults(guildId, interaction.user.id);
          defaults.massMinutes = mins;
          saveHostDefaults(guildId, interaction.user.id, defaults);
          return safeReply(interaction, {
            content: `✅ Default mass timer set to **${mins} minutes**.`,
            flags: MessageFlags.Ephemeral,
          });
        }

        // ── settitle ──────────────────────────────────────────────
        if (sub === 'settitle') {
          if (!await checkLeaderRole(interaction, guildId)) return;
          const title    = interaction.options.getString('title');
          const defaults = getHostDefaults(guildId, interaction.user.id);
          defaults.title = title;
          saveHostDefaults(guildId, interaction.user.id, defaults);
          return safeReply(interaction, {
            content: `✅ Default title set to **${title}**.`,
            flags: MessageFlags.Ephemeral,
          });
        }

        // ── setimage ──────────────────────────────────────────────
        if (sub === 'setimage') {
          if (!await checkLeaderRole(interaction, guildId)) return;
          const url      = interaction.options.getString('url');
          const defaults = getHostDefaults(guildId, interaction.user.id);
          defaults.imageUrl = url;
          saveHostDefaults(guildId, interaction.user.id, defaults);
          return safeReply(interaction, {
            content: `✅ Default image set.`,
            flags: MessageFlags.Ephemeral,
          });
        }

        // ── setpingrole ───────────────────────────────────────────
        if (sub === 'setpingrole') {
          if (!await checkLeaderRole(interaction, guildId)) return;
          const role     = interaction.options.getRole('role');
          const defaults = getHostDefaults(guildId, interaction.user.id);
          defaults.pingRoleId = role.id;
          saveHostDefaults(guildId, interaction.user.id, defaults);
          return safeReply(interaction, {
            content: `✅ Ping role set to **${role.name}**.`,
            flags: MessageFlags.Ephemeral,
          });
        }

        // ── setinvite ─────────────────────────────────────────────
        if (sub === 'setinvite') {
          if (!await checkLeaderRole(interaction, guildId)) return;
          const url      = interaction.options.getString('url');
          const defaults = getHostDefaults(guildId, interaction.user.id);
          defaults.inviteUrl = url;
          saveHostDefaults(guildId, interaction.user.id, defaults);
          return safeReply(interaction, {
            content: `✅ Default invite link set to: ${url}`,
            flags: MessageFlags.Ephemeral,
          });
        }

        // ── setmassmsg — opens modal ──────────────────────────────
        if (sub === 'setmassmsg') {
          if (!await checkLeaderRole(interaction, guildId)) return;
          const defaults = getHostDefaults(guildId, interaction.user.id);
          const modal = new ModalBuilder()
            .setCustomId('ava_quick_massmsg')
            .setTitle('Set Default Mass Message');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('msg')
              .setLabel('Mass message')
              .setStyle(TextInputStyle.Paragraph)
              .setValue(defaults.massMessage || '')
              .setRequired(true)
              .setMaxLength(500)
          ));
          return interaction.showModal(modal);
        }

        // ── defaults — show current saved defaults ────────────────
        if (sub === 'defaults') {
          if (!await checkLeaderRole(interaction, guildId)) return;
          const d = getHostDefaults(guildId, interaction.user.id);
          const lines = [
            `📌 **Title:** ${d.title || '*Not set*'}`,
            `⏰ **Timer:** ${d.massMinutes ? `${d.massMinutes} min` : '*Not set*'}`,
            `📣 **Ping Role:** ${d.pingRoleId ? `<@&${d.pingRoleId}>` : '*Not set*'}`,
            `🔗 **Invite URL:** ${d.inviteUrl || '*Not set*'}`,
            `🖼️ **Image:** ${d.imageUrl || '*Not set*'}`,
            `📋 **Roles:** ${d.roles.map(r => `${r.name}${r.limit ? ` (${r.limit})` : ''}`).join(', ')}`,
          ];
          return safeReply(interaction, {
            content: lines.join('\n'),
            flags: MessageFlags.Ephemeral,
          });
        }

        // ── resetdefaults ─────────────────────────────────────────
        if (sub === 'resetdefaults') {
          if (!await checkLeaderRole(interaction, guildId)) return;
          resetHostDefaults(guildId, interaction.user.id);
          return safeReply(interaction, {
            content: '✅ Your saved defaults have been reset to the system defaults. They will load next time you run `/setava create`.',
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      // ── Quick mass message modal submit ───────────────────────────
      if (interaction.isModalSubmit() && interaction.customId === 'ava_quick_massmsg') {
        const msg      = interaction.fields.getTextInputValue('msg');
        const defaults = getHostDefaults(guildId, interaction.user.id);
        defaults.massMessage = msg;
        saveHostDefaults(guildId, interaction.user.id, defaults);
        return safeReply(interaction, {
          content: '✅ Default mass message saved.',
          flags: MessageFlags.Ephemeral,
        });
      }

      // ══════════════════════════════════════════════════════════════
      // SETUP PANEL INTERACTIONS
      // ══════════════════════════════════════════════════════════════

      const getSetupId = (customId, prefix) => customId.replace(prefix, '');

      // ── Set Title ────────────────────────────────────────────────
      if (interaction.isButton() && interaction.customId.startsWith('ava_setup_title_')) {
        const setupId = getSetupId(interaction.customId, 'ava_setup_title_');
        const modal   = new ModalBuilder().setCustomId(`ava_modal_title_${setupId}`).setTitle('Set AVA Title');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('title').setLabel('AVA Title')
            .setStyle(TextInputStyle.Short)
            .setValue(setupDrafts.get(setupId)?.title || '')
            .setPlaceholder('e.g. Sunday AVA — Crystal League')
            .setRequired(true).setMaxLength(100)
        ));
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('ava_modal_title_')) {
        const setupId = getSetupId(interaction.customId, 'ava_modal_title_');
        const draft   = setupDrafts.get(setupId);
        if (!draft) return safeReply(interaction, { content: '❌ Setup session expired.', flags: MessageFlags.Ephemeral });
        draft.title = interaction.fields.getTextInputValue('title');
        return interaction.update({ embeds: [buildSetupEmbed(draft)], components: buildSetupRows(setupId) });
      }

      // ── Set Description ──────────────────────────────────────────
      if (interaction.isButton() && interaction.customId.startsWith('ava_setup_desc_')) {
        const setupId = getSetupId(interaction.customId, 'ava_setup_desc_');
        const modal   = new ModalBuilder().setCustomId(`ava_modal_desc_${setupId}`).setTitle('Set AVA Description');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('desc').setLabel('Description / Rules')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(setupDrafts.get(setupId)?.description || '')
            .setPlaceholder('Rules, requirements, notes...')
            .setRequired(false).setMaxLength(1000)
        ));
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('ava_modal_desc_')) {
        const setupId = getSetupId(interaction.customId, 'ava_modal_desc_');
        const draft   = setupDrafts.get(setupId);
        if (!draft) return safeReply(interaction, { content: '❌ Setup session expired.', flags: MessageFlags.Ephemeral });
        draft.description = interaction.fields.getTextInputValue('desc');
        return interaction.update({ embeds: [buildSetupEmbed(draft)], components: buildSetupRows(setupId) });
      }

      // ── Set Image ────────────────────────────────────────────────
      if (interaction.isButton() && interaction.customId.startsWith('ava_setup_image_')) {
        const setupId = getSetupId(interaction.customId, 'ava_setup_image_');
        const modal   = new ModalBuilder().setCustomId(`ava_modal_image_${setupId}`).setTitle('Set Image / GIF');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('imageUrl').setLabel('Image or GIF URL (direct link)')
            .setStyle(TextInputStyle.Short)
            .setValue(setupDrafts.get(setupId)?.imageUrl || '')
            .setPlaceholder('https://i.imgur.com/example.gif')
            .setRequired(false)
        ));
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('ava_modal_image_')) {
        const setupId = getSetupId(interaction.customId, 'ava_modal_image_');
        const draft   = setupDrafts.get(setupId);
        if (!draft) return safeReply(interaction, { content: '❌ Setup session expired.', flags: MessageFlags.Ephemeral });
        draft.imageUrl = interaction.fields.getTextInputValue('imageUrl').trim() || null;
        return interaction.update({ embeds: [buildSetupEmbed(draft)], components: buildSetupRows(setupId) });
      }

      // ── Set Invite Link ───────────────────────────────────────────
      if (interaction.isButton() && interaction.customId.startsWith('ava_setup_invite_')) {
        const setupId = getSetupId(interaction.customId, 'ava_setup_invite_');
        const modal   = new ModalBuilder().setCustomId(`ava_modal_invite_${setupId}`).setTitle('Set Invite Link');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('inviteUrl')
            .setLabel('Voice channel invite URL')
            .setStyle(TextInputStyle.Short)
            .setValue(setupDrafts.get(setupId)?.inviteUrl || '')
            .setPlaceholder('https://discord.gg/yourlink')
            .setRequired(false)
        ));
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('ava_modal_invite_')) {
        const setupId = getSetupId(interaction.customId, 'ava_modal_invite_');
        const draft   = setupDrafts.get(setupId);
        if (!draft) return safeReply(interaction, { content: '❌ Setup session expired.', flags: MessageFlags.Ephemeral });
        draft.inviteUrl = interaction.fields.getTextInputValue('inviteUrl').trim() || null;
        return interaction.update({ embeds: [buildSetupEmbed(draft)], components: buildSetupRows(setupId) });
      }

      // ── Add Role ─────────────────────────────────────────────────
      if (interaction.isButton() && interaction.customId.startsWith('ava_setup_addrole_')) {
        const setupId = getSetupId(interaction.customId, 'ava_setup_addrole_');
        const modal   = new ModalBuilder().setCustomId(`ava_modal_addrole_${setupId}`).setTitle('Add Role');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('roleName').setLabel('Role Name')
              .setStyle(TextInputStyle.Short).setPlaceholder('e.g. BATTLEMOUNT').setRequired(true).setMaxLength(50)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('roleLimit').setLabel('Max slots (leave blank = unlimited)')
              .setStyle(TextInputStyle.Short).setPlaceholder('e.g. 2').setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('roleEmoji').setLabel('Emoji (unicode 🛡️ or custom emoji ID)')
              .setStyle(TextInputStyle.Short).setPlaceholder('e.g. 🛡️  or  1234567890123456789').setRequired(false).setMaxLength(64)
          ),
        );
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('ava_modal_addrole_')) {
        const setupId  = getSetupId(interaction.customId, 'ava_modal_addrole_');
        const draft    = setupDrafts.get(setupId);
        if (!draft) return safeReply(interaction, { content: '❌ Setup session expired.', flags: MessageFlags.Ephemeral });
        const name     = interaction.fields.getTextInputValue('roleName').trim().toUpperCase();
        const limitRaw = interaction.fields.getTextInputValue('roleLimit').trim();
        const emojiRaw = interaction.fields.getTextInputValue('roleEmoji').trim();
        const limit    = limitRaw ? parseInt(limitRaw) || null : null;
        const emoji    = emojiRaw || null;
        if (draft.roles.find(r => r.name === name)) {
          return safeReply(interaction, { content: `⚠️ Role **${name}** already exists.`, flags: MessageFlags.Ephemeral });
        }
        draft.roles.push({ name, limit, emoji });
        return interaction.update({ embeds: [buildSetupEmbed(draft)], components: buildSetupRows(setupId) });
      }

      // ── Edit Role ────────────────────────────────────────────────
      if (interaction.isButton() && interaction.customId.startsWith('ava_setup_editrole_')) {
        const setupId = getSetupId(interaction.customId, 'ava_setup_editrole_');
        const draft   = setupDrafts.get(setupId);
        if (!draft || draft.roles.length === 0) {
          return safeReply(interaction, { content: '❌ No roles to edit.', flags: MessageFlags.Ephemeral });
        }
        const select = new StringSelectMenuBuilder()
          .setCustomId(`ava_setup_editrole_select_${setupId}`)
          .setPlaceholder('Select a role to edit...');
        draft.roles.forEach(r => select.addOptions(new StringSelectMenuOptionBuilder().setLabel(r.name).setValue(r.name)));
        return safeReply(interaction, {
          content:    'Select the role you want to edit:',
          components: [new ActionRowBuilder().addComponents(select)],
          flags:      MessageFlags.Ephemeral,
        });
      }

      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ava_setup_editrole_select_')) {
        const setupId  = getSetupId(interaction.customId, 'ava_setup_editrole_select_');
        const roleName = interaction.values[0];
        const draft    = setupDrafts.get(setupId);
        const role     = draft?.roles.find(r => r.name === roleName);
        if (!role) return safeReply(interaction, { content: '❌ Role not found.', flags: MessageFlags.Ephemeral });
        const modal = new ModalBuilder().setCustomId(`ava_modal_editrole_${setupId}_${roleName}`).setTitle(`Edit Role: ${roleName}`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('roleName').setLabel('New Role Name')
              .setStyle(TextInputStyle.Short).setValue(roleName).setRequired(true).setMaxLength(50)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('roleLimit').setLabel('Max slots (blank = unlimited)')
              .setStyle(TextInputStyle.Short).setValue(role.limit ? String(role.limit) : '').setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('roleEmoji').setLabel('Emoji (unicode 🛡️ or custom emoji ID)')
              .setStyle(TextInputStyle.Short).setValue(role.emoji || '').setPlaceholder('e.g. 🛡️  or  1234567890123456789').setRequired(false).setMaxLength(64)
          ),
        );
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('ava_modal_editrole_')) {
        const parts   = interaction.customId.replace('ava_modal_editrole_', '').split('_');
        const setupId = parts[0];
        const oldName = parts.slice(1).join('_');
        const draft   = setupDrafts.get(setupId);
        if (!draft) return safeReply(interaction, { content: '❌ Setup session expired.', flags: MessageFlags.Ephemeral });
        const newName  = interaction.fields.getTextInputValue('roleName').trim().toUpperCase();
        const limitRaw = interaction.fields.getTextInputValue('roleLimit').trim();
        const emojiRaw = interaction.fields.getTextInputValue('roleEmoji').trim();
        const limit    = limitRaw ? parseInt(limitRaw) || null : null;
        const emoji    = emojiRaw || null;
        const idx      = draft.roles.findIndex(r => r.name === oldName);
        if (idx !== -1) draft.roles[idx] = { name: newName, limit, emoji };
        return interaction.update({ embeds: [buildSetupEmbed(draft)], components: buildSetupRows(setupId) });
      }

      // ── Remove Role ──────────────────────────────────────────────
      if (interaction.isButton() && interaction.customId.startsWith('ava_setup_removerole_')) {
        const setupId = getSetupId(interaction.customId, 'ava_setup_removerole_');
        const draft   = setupDrafts.get(setupId);
        if (!draft || draft.roles.length === 0) {
          return safeReply(interaction, { content: '❌ No roles to remove.', flags: MessageFlags.Ephemeral });
        }
        const select = new StringSelectMenuBuilder()
          .setCustomId(`ava_setup_removerole_select_${setupId}`)
          .setPlaceholder('Select a role to remove...');
        draft.roles.forEach(r => select.addOptions(new StringSelectMenuOptionBuilder().setLabel(r.name).setValue(r.name)));
        return safeReply(interaction, {
          content:    'Select the role to remove:',
          components: [new ActionRowBuilder().addComponents(select)],
          flags:      MessageFlags.Ephemeral,
        });
      }

      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ava_setup_removerole_select_')) {
        const setupId  = getSetupId(interaction.customId, 'ava_setup_removerole_select_');
        const roleName = interaction.values[0];
        const draft    = setupDrafts.get(setupId);
        if (!draft) return safeReply(interaction, { content: '❌ Setup session expired.', flags: MessageFlags.Ephemeral });
        draft.roles = draft.roles.filter(r => r.name !== roleName);
        return interaction.update({ embeds: [buildSetupEmbed(draft)], components: buildSetupRows(setupId) });
      }

      // ── Set Mass Timer ───────────────────────────────────────────
      if (interaction.isButton() && interaction.customId.startsWith('ava_setup_masstime_')) {
        const setupId = getSetupId(interaction.customId, 'ava_setup_masstime_');
        const modal   = new ModalBuilder().setCustomId(`ava_modal_masstime_${setupId}`).setTitle('Set Mass Timer');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('minutes').setLabel('Minutes until mass (from embed launch)')
            .setStyle(TextInputStyle.Short)
            .setValue(setupDrafts.get(setupId)?.massMinutes ? String(setupDrafts.get(setupId).massMinutes) : '')
            .setPlaceholder('e.g. 30').setRequired(true)
        ));
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('ava_modal_masstime_')) {
        const setupId = getSetupId(interaction.customId, 'ava_modal_masstime_');
        const draft   = setupDrafts.get(setupId);
        if (!draft) return safeReply(interaction, { content: '❌ Setup session expired.', flags: MessageFlags.Ephemeral });
        const mins = parseInt(interaction.fields.getTextInputValue('minutes').trim());
        if (isNaN(mins) || mins < 1) return safeReply(interaction, { content: '❌ Please enter a valid number of minutes.', flags: MessageFlags.Ephemeral });
        draft.massMinutes = mins;
        draft.massTime    = Date.now() + mins * 60 * 1000; // preview only, recalculated at launch
        return interaction.update({ embeds: [buildSetupEmbed(draft)], components: buildSetupRows(setupId) });
      }

      // ── Set Mass Message ─────────────────────────────────────────
      if (interaction.isButton() && interaction.customId.startsWith('ava_setup_massmsg_')) {
        const setupId = getSetupId(interaction.customId, 'ava_setup_massmsg_');
        const modal   = new ModalBuilder().setCustomId(`ava_modal_massmsg_${setupId}`).setTitle('Set Mass Message');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('msg').setLabel('Message sent when mass starts')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(setupDrafts.get(setupId)?.massMessage || '')
            .setPlaceholder('e.g. ⚔️ AVA is starting! Head to the voice channel NOW!')
            .setRequired(true).setMaxLength(500)
        ));
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('ava_modal_massmsg_')) {
        const setupId = getSetupId(interaction.customId, 'ava_modal_massmsg_');
        const draft   = setupDrafts.get(setupId);
        if (!draft) return safeReply(interaction, { content: '❌ Setup session expired.', flags: MessageFlags.Ephemeral });
        draft.massMessage = interaction.fields.getTextInputValue('msg');
        return interaction.update({ embeds: [buildSetupEmbed(draft)], components: buildSetupRows(setupId) });
      }

      // ── Set Ping Role ─────────────────────────────────────────────
      if (interaction.isButton() && interaction.customId.startsWith('ava_setup_pingrole_')) {
        const setupId = getSetupId(interaction.customId, 'ava_setup_pingrole_');
        const modal   = new ModalBuilder().setCustomId(`ava_modal_pingrole_${setupId}`).setTitle('Set Ping Role');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('roleId')
            .setLabel('Role ID to ping when embed launches')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Right-click the role → Copy ID')
            .setValue(setupDrafts.get(setupId)?.pingRoleId || '')
            .setRequired(false)
        ));
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('ava_modal_pingrole_')) {
        const setupId = getSetupId(interaction.customId, 'ava_modal_pingrole_');
        const draft   = setupDrafts.get(setupId);
        if (!draft) return safeReply(interaction, { content: '❌ Setup session expired.', flags: MessageFlags.Ephemeral });
        draft.pingRoleId = interaction.fields.getTextInputValue('roleId').trim() || null;
        return interaction.update({ embeds: [buildSetupEmbed(draft)], components: buildSetupRows(setupId) });
      }

      // ── Pre-fill Member ───────────────────────────────────────────
      if (interaction.isButton() && interaction.customId.startsWith('ava_setup_prefill_')) {
        const setupId = getSetupId(interaction.customId, 'ava_setup_prefill_');
        const draft   = setupDrafts.get(setupId);
        if (!draft) return safeReply(interaction, { content: '❌ Setup session expired.', flags: MessageFlags.Ephemeral });
        if (draft.roles.length === 0) return safeReply(interaction, { content: '❌ Add at least one role first.', flags: MessageFlags.Ephemeral });

        const modal = new ModalBuilder().setCustomId(`ava_modal_prefill_${setupId}`).setTitle('Pre-fill Member');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('userId').setLabel('User ID')
              .setStyle(TextInputStyle.Short).setPlaceholder('Right-click the user → Copy ID').setRequired(true).setMaxLength(20)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('roleName').setLabel('Role to assign')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder(`e.g. ${draft.roles.map(r => r.name).join(' / ')}`)
              .setRequired(true).setMaxLength(50)
          ),
        );
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('ava_modal_prefill_')) {
        const setupId     = getSetupId(interaction.customId, 'ava_modal_prefill_');
        const draft       = setupDrafts.get(setupId);
        if (!draft) return safeReply(interaction, { content: '❌ Setup session expired.', flags: MessageFlags.Ephemeral });
        const userId      = interaction.fields.getTextInputValue('userId').trim();
        const roleNameRaw = interaction.fields.getTextInputValue('roleName').trim().toUpperCase();
        const role        = draft.roles.find(r => r.name === roleNameRaw);
        if (!role) return safeReply(interaction, { content: `❌ Role **${roleNameRaw}** not found. Available: ${draft.roles.map(r => r.name).join(', ')}`, flags: MessageFlags.Ephemeral });
        if (draft.signups[userId]) return safeReply(interaction, { content: `⚠️ <@${userId}> is already pre-filled as **${draft.signups[userId].assignedRole}**.`, flags: MessageFlags.Ephemeral });
        const count = Object.values(draft.signups).filter(s => s.assignedRole === role.name && s.status === 'accepted').length;
        if (role.limit && count >= role.limit) return safeReply(interaction, { content: `❌ **${role.name}** is already full in the draft (${count}/${role.limit}).`, flags: MessageFlags.Ephemeral });
        let targetUser;
        try { targetUser = await interaction.client.users.fetch(userId); }
        catch { return safeReply(interaction, { content: `❌ Could not find user with ID \`${userId}\`.`, flags: MessageFlags.Ephemeral }); }
        draft.signups[userId] = {
          userId, username: targetUser.tag,
          selectedRole: role.name, assignedRole: role.name,
          status: 'accepted', timestamp: Date.now(), addedByHost: true,
        };
        return interaction.update({ embeds: [buildSetupEmbed(draft)], components: buildSetupRows(setupId) });
      }

      // ── Cancel Setup ──────────────────────────────────────────────
      if (interaction.isButton() && interaction.customId.startsWith('ava_setup_cancel_')) {
        const setupId = getSetupId(interaction.customId, 'ava_setup_cancel_');
        setupDrafts.delete(setupId);
        return interaction.update({ content: '❌ AVA setup cancelled.', embeds: [], components: [] });
      }

      // ── 🚀 Launch AVA ─────────────────────────────────────────────
      if (interaction.isButton() && interaction.customId.startsWith('ava_setup_launch_')) {
        const setupId = getSetupId(interaction.customId, 'ava_setup_launch_');
        const draft   = setupDrafts.get(setupId);
        if (!draft)                 return safeReply(interaction, { content: '❌ Setup session expired.',              flags: MessageFlags.Ephemeral });
        if (!draft.title)           return safeReply(interaction, { content: '❌ Please set a title first.',           flags: MessageFlags.Ephemeral });
        if (!draft.roles.length)    return safeReply(interaction, { content: '❌ Please add at least one role.',       flags: MessageFlags.Ephemeral });
        if (!draft.massMinutes)     return safeReply(interaction, { content: '❌ Please set a mass timer first.',      flags: MessageFlags.Ephemeral });

        const channel = await interaction.guild.channels.fetch(draft.channelId).catch(() => null);
        if (!channel) return safeReply(interaction, { content: '❌ Could not find the channel.', flags: MessageFlags.Ephemeral });

        const launchTime = Date.now();
        const massTime   = launchTime + draft.massMinutes * 60 * 1000;

        // Send temp embed first to get message ID
        const tempEmbed = buildAvaEmbed({ ...draft, messageId: 'pending', massTime, active: true });
        const liveMsg   = await channel.send({ embeds: [tempEmbed] });

        const avaData = {
          ...draft,
          messageId:   liveMsg.id,
          channelId:   channel.id,
          launchedAt:  launchTime,
          active:      true,
          signups:     { ...draft.signups }, // carry over pre-filled members
          massTime,
          massMinutes: draft.massMinutes,
        };

        // Auto-signup host as MAIN TANK if not already pre-filled
        const mainTankRole = avaData.roles.find(r => r.name === 'MAIN TANK');
        if (mainTankRole && !avaData.signups[avaData.hostId]) {
          avaData.signups[avaData.hostId] = {
            userId:       avaData.hostId,
            username:     interaction.user.tag,
            selectedRole: 'MAIN TANK',
            assignedRole: 'MAIN TANK',
            status:       'accepted',
            timestamp:    launchTime,
          };
        }

        saveHostDefaults(avaData.guildId, avaData.hostId, avaData);
        saveAva(liveMsg.id, avaData);
        setupDrafts.delete(setupId);

        // Edit with real messageId so components work
        await liveMsg.edit({
          embeds:     [buildAvaEmbed(avaData)],
          components: buildAvaComponents(avaData),
        });

        // Ping role if set
        if (avaData.pingRoleId) {
          await channel.send({ content: `<@&${avaData.pingRoleId}>` });
        }

        scheduleMass(interaction.client, liveMsg.id, avaData);

        // DM host control panel
        try {
          const hostUser = await interaction.client.users.fetch(avaData.hostId);
          await hostUser.send({
            content: [
              `⚔️ **Your AVA has been launched!**`,
              `🔗 [Jump to embed](https://discord.com/channels/${guildId}/${channel.id}/${liveMsg.id})`,
              ``,
              `⏰ Mass starts: <t:${Math.floor(massTime / 1000)}:R> (<t:${Math.floor(massTime / 1000)}:t>)`,
              ``,
              `Use the buttons below to manage your AVA.`,
            ].join('\n'),
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ava_manage_${liveMsg.id}`).setLabel('⚙️ Manage Members').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`ava_edittimer_${liveMsg.id}`).setLabel('⏰ Edit Mass Timer').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`ava_cancelava_${liveMsg.id}`).setLabel('🗑️ Cancel AVA').setStyle(ButtonStyle.Danger),
              ),
            ],
          });
        } catch { console.warn('⚠️ Could not DM host.'); }

        return interaction.update({
          content:    `✅ AVA launched! [Jump to embed](https://discord.com/channels/${guildId}/${channel.id}/${liveMsg.id})\n⏰ Mass starts <t:${Math.floor(massTime / 1000)}:R>\n📬 Management panel sent to your DMs.`,
          embeds:     [],
          components: [],
        });
      }

      // ══════════════════════════════════════════════════════════════
      // USER INTERACTIONS (live embed)
      // ══════════════════════════════════════════════════════════════

      // ── Select role ───────────────────────────────────────────────
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ava_select_role_')) {
        const messageId    = interaction.customId.replace('ava_select_role_', '');
        const ava          = getAva(messageId);
        if (!ava || !ava.active) return safeReply(interaction, { content: '❌ This AVA is no longer active.', flags: MessageFlags.Ephemeral });

        const userId       = interaction.user.id;
        const selectedRole = interaction.values[0];

        if (ava.signups[userId]) {
          const existing = ava.signups[userId];
          if (existing.status === 'accepted' && existing.assignedRole === selectedRole) {
            return safeReply(interaction, { content: `ℹ️ You are already accepted as **${selectedRole}**.`, flags: MessageFlags.Ephemeral });
          }
          delete ava.signups[userId];
          if (ava.pendingApprovals) delete ava.pendingApprovals[userId];
        }

        const role         = ava.roles.find(r => r.name === selectedRole);
        const currentCount = Object.values(ava.signups).filter(s => s.assignedRole === selectedRole && s.status === 'accepted').length;
        if (role?.limit && currentCount >= role.limit) {
          return safeReply(interaction, { content: `❌ **${selectedRole}** is full (${currentCount}/${role.limit}).`, flags: MessageFlags.Ephemeral });
        }

        ava.signups[userId] = {
          userId, username: interaction.user.tag,
          selectedRole, assignedRole: selectedRole,
          status: 'pending', timestamp: Date.now(),
        };

        saveAva(messageId, ava);
        await updateAvaEmbed(interaction.client, ava);

        try {
          const host      = await interaction.client.users.fetch(ava.hostId);
          const panelData = buildHostPanel({ ...ava, messageId }, userId);
          const dmMsg     = await host.send(panelData);
          ava.signups[userId].panelMsgId = dmMsg.id;
          if (!ava.pendingApprovals) ava.pendingApprovals = {};
          ava.pendingApprovals[userId] = { panelMsgId: dmMsg.id };
          saveAva(messageId, ava);
        } catch (err) { console.error('❌ Could not DM host:', err); }

        return safeReply(interaction, {
          content: `📬 You've signed up for **${selectedRole}**! Waiting for host approval.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      // ── Leave ─────────────────────────────────────────────────────
      if (interaction.isButton() && interaction.customId.startsWith('ava_leave_')) {
        const messageId = interaction.customId.replace('ava_leave_', '');
        const ava       = getAva(messageId);
        if (!ava)          return safeReply(interaction, { content: '❌ AVA not found.',              flags: MessageFlags.Ephemeral });
        if (!ava.active)   return safeReply(interaction, { content: '❌ This AVA has already ended.', flags: MessageFlags.Ephemeral });

        const userId = interaction.user.id;
        if (!ava.signups[userId]) return safeReply(interaction, { content: '❌ You are not signed up.', flags: MessageFlags.Ephemeral });

        const roleName = ava.signups[userId].assignedRole || ava.signups[userId].selectedRole;
        delete ava.signups[userId];
        if (ava.pendingApprovals) delete ava.pendingApprovals[userId];
        saveAva(messageId, ava);
        await updateAvaEmbed(interaction.client, ava);

        return safeReply(interaction, {
          content: `✅ You have left the AVA. Your **${roleName}** slot is now available.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      // ── My Status ─────────────────────────────────────────────────
      if (interaction.isButton() && interaction.customId.startsWith('ava_myinfo_')) {
        const messageId = interaction.customId.replace('ava_myinfo_', '');
        const ava       = getAva(messageId);
        const signup    = ava?.signups[interaction.user.id];
        if (!signup) return safeReply(interaction, { content: '❌ You are not signed up for this AVA.', flags: MessageFlags.Ephemeral });

        const statusEmoji = { pending: '⏳', accepted: '✅', rejected: '❌' }[signup.status] || '❓';
        return safeReply(interaction, {
          content: [
            `**Your AVA Status:**`,
            `${statusEmoji} Status: **${signup.status.toUpperCase()}**`,
            `🎯 Role: **${signup.assignedRole || signup.selectedRole}**`,
            `⏰ Applied: <t:${Math.floor(signup.timestamp / 1000)}:R>`,
          ].join('\n'),
          flags: MessageFlags.Ephemeral,
        });
      }

      // ══════════════════════════════════════════════════════════════
      // HOST PANEL (DMs — new applicants)
      // ══════════════════════════════════════════════════════════════

      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ava_host_changerole_')) {
        const parts       = interaction.customId.replace('ava_host_changerole_', '').split('_');
        const messageId   = parts[0];
        const applicantId = parts[1];
        const ava         = getAva(messageId);
        if (!ava || !ava.signups[applicantId]) return;
        ava.signups[applicantId].assignedRole = interaction.values[0];
        saveAva(messageId, ava);
        return safeReply(interaction, { content: `✅ Role changed to **${interaction.values[0]}**. Press Accept to confirm.`, flags: MessageFlags.Ephemeral });
      }

      if (interaction.isButton() && interaction.customId.startsWith('ava_host_accept_')) {
        const parts       = interaction.customId.replace('ava_host_accept_', '').split('_');
        const messageId   = parts[0];
        const applicantId = parts[1];
        const ava         = getAva(messageId);
        if (!ava || !ava.signups[applicantId]) return safeReply(interaction, { content: '❌ Signup not found.', flags: MessageFlags.Ephemeral });

        const signup = ava.signups[applicantId];
        const role   = ava.roles.find(r => r.name === (signup.assignedRole || signup.selectedRole));
        const count  = Object.values(ava.signups).filter(s => s.assignedRole === role?.name && s.status === 'accepted' && s.userId !== applicantId).length;
        if (role?.limit && count >= role.limit) return safeReply(interaction, { content: `❌ **${role.name}** is full. Change the role first.`, flags: MessageFlags.Ephemeral });

        signup.status       = 'accepted';
        signup.assignedRole = signup.assignedRole || signup.selectedRole;
        if (ava.pendingApprovals) delete ava.pendingApprovals[applicantId];
        saveAva(messageId, ava);
        await updateAvaEmbed(interaction.client, ava);

        try { await (await interaction.client.users.fetch(applicantId)).send(`✅ Your signup for **${ava.title}** has been **accepted**! You are assigned as **${signup.assignedRole}**.`); } catch {}
        return interaction.update({ content: `✅ **${signup.username}** accepted as **${signup.assignedRole}**.`, embeds: [], components: [] });
      }

      if (interaction.isButton() && interaction.customId.startsWith('ava_host_reject_')) {
        const parts       = interaction.customId.replace('ava_host_reject_', '').split('_');
        const messageId   = parts[0];
        const applicantId = parts[1];
        const ava         = getAva(messageId);
        if (!ava || !ava.signups[applicantId]) return safeReply(interaction, { content: '❌ Signup not found.', flags: MessageFlags.Ephemeral });

        const signup  = ava.signups[applicantId];
        signup.status = 'rejected';
        if (ava.pendingApprovals) delete ava.pendingApprovals[applicantId];
        saveAva(messageId, ava);
        await updateAvaEmbed(interaction.client, ava);

        try { await (await interaction.client.users.fetch(applicantId)).send(`❌ Your signup for **${ava.title}** has been **rejected**.`); } catch {}
        return interaction.update({ content: `❌ **${signup.username}** rejected.`, embeds: [], components: [] });
      }

      if (interaction.isButton() && interaction.customId.startsWith('ava_host_remove_')) {
        const parts       = interaction.customId.replace('ava_host_remove_', '').split('_');
        const messageId   = parts[0];
        const applicantId = parts[1];
        const ava         = getAva(messageId);
        if (!ava || !ava.signups[applicantId]) return safeReply(interaction, { content: '❌ Signup not found.', flags: MessageFlags.Ephemeral });

        const signup = ava.signups[applicantId];
        delete ava.signups[applicantId];
        if (ava.pendingApprovals) delete ava.pendingApprovals[applicantId];
        saveAva(messageId, ava);
        await updateAvaEmbed(interaction.client, ava);

        try { await (await interaction.client.users.fetch(applicantId)).send(`⚠️ You have been **removed** from the AVA **${ava.title}**.`); } catch {}
        return interaction.update({ content: `🗑️ **${signup.username}** removed.`, embeds: [], components: [] });
      }

      // ══════════════════════════════════════════════════════════════
      // MANAGE ACCEPTED MEMBERS
      // ══════════════════════════════════════════════════════════════

      if (interaction.isButton() && interaction.customId.startsWith('ava_manage_') &&
          !interaction.customId.startsWith('ava_manage_select_') &&
          !interaction.customId.startsWith('ava_manage_changerole_') &&
          !interaction.customId.startsWith('ava_manage_remove_') &&
          !interaction.customId.startsWith('ava_manage_addmember_')) {

        const messageId = interaction.customId.replace('ava_manage_', '');
        const ava       = getAva(messageId);
        if (!ava) return safeReply(interaction, { content: '❌ AVA not found.', flags: MessageFlags.Ephemeral });
        if (interaction.user.id !== ava.hostId) return safeReply(interaction, { content: '❌ Only the host can manage members.', flags: MessageFlags.Ephemeral });

        try {
          await (await interaction.client.users.fetch(ava.hostId)).send(buildManagePanel(ava));
          return safeReply(interaction, { content: '📬 Management panel sent to your DMs.', flags: MessageFlags.Ephemeral });
        } catch {
          return safeReply(interaction, { content: '❌ Could not DM you. Enable DMs from server members.', flags: MessageFlags.Ephemeral });
        }
      }

      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ava_manage_select_')) {
        const messageId   = interaction.customId.replace('ava_manage_select_', '');
        const applicantId = interaction.values[0];
        const ava         = getAva(messageId);
        if (!ava || !ava.signups[applicantId]) return safeReply(interaction, { content: '❌ Member not found.', flags: MessageFlags.Ephemeral });

        const signup     = ava.signups[applicantId];
        const roleSelect = new StringSelectMenuBuilder()
          .setCustomId(`ava_manage_changerole_${messageId}_${applicantId}`)
          .setPlaceholder(`Change role (current: ${signup.assignedRole})...`);
        ava.roles.forEach(role => roleSelect.addOptions(
          new StringSelectMenuOptionBuilder().setLabel(role.name).setValue(role.name).setDefault(role.name === signup.assignedRole)
        ));

        return safeReply(interaction, {
          content: `Managing **${signup.username}** (currently **${signup.assignedRole}**):`,
          components: [
            new ActionRowBuilder().addComponents(roleSelect),
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`ava_manage_remove_${messageId}_${applicantId}`).setLabel('Remove from AVA').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ava_manage_changerole_')) {
        const parts       = interaction.customId.replace('ava_manage_changerole_', '').split('_');
        const messageId   = parts[0];
        const applicantId = parts[1];
        const newRole     = interaction.values[0];
        const ava         = getAva(messageId);
        if (!ava || !ava.signups[applicantId]) return safeReply(interaction, { content: '❌ Member not found.', flags: MessageFlags.Ephemeral });

        const role  = ava.roles.find(r => r.name === newRole);
        const count = Object.values(ava.signups).filter(s => s.assignedRole === newRole && s.status === 'accepted' && s.userId !== applicantId).length;
        if (role?.limit && count >= role.limit) return safeReply(interaction, { content: `❌ **${newRole}** is full.`, flags: MessageFlags.Ephemeral });

        const signup  = ava.signups[applicantId];
        const oldRole = signup.assignedRole;
        signup.assignedRole = newRole;
        saveAva(messageId, ava);
        await updateAvaEmbed(interaction.client, ava);

        try { await (await interaction.client.users.fetch(applicantId)).send(`🔄 Your role in **${ava.title}** changed from **${oldRole}** → **${newRole}**.`); } catch {}
        return safeReply(interaction, { content: `✅ **${signup.username}** moved from **${oldRole}** → **${newRole}**.`, flags: MessageFlags.Ephemeral });
      }

      if (interaction.isButton() && interaction.customId.startsWith('ava_manage_remove_')) {
        const parts       = interaction.customId.replace('ava_manage_remove_', '').split('_');
        const messageId   = parts[0];
        const applicantId = parts[1];
        const ava         = getAva(messageId);
        if (!ava || !ava.signups[applicantId]) return safeReply(interaction, { content: '❌ Member not found.', flags: MessageFlags.Ephemeral });

        const signup = ava.signups[applicantId];
        delete ava.signups[applicantId];
        if (ava.pendingApprovals) delete ava.pendingApprovals[applicantId];
        saveAva(messageId, ava);
        await updateAvaEmbed(interaction.client, ava);

        try { await (await interaction.client.users.fetch(applicantId)).send(`⚠️ You have been **removed** from **${ava.title}** by the host.`); } catch {}
        return safeReply(interaction, { content: `🗑️ **${signup.username}** removed.`, flags: MessageFlags.Ephemeral });
      }

      // ── Add Member (manage panel) ─────────────────────────────────
      if (interaction.isButton() && interaction.customId.startsWith('ava_manage_addmember_')) {
        const messageId = interaction.customId.replace('ava_manage_addmember_', '');
        const ava       = getAva(messageId);
        if (!ava) return safeReply(interaction, { content: '❌ AVA not found.', flags: MessageFlags.Ephemeral });
        if (interaction.user.id !== ava.hostId) return safeReply(interaction, { content: '❌ Only the host can add members.', flags: MessageFlags.Ephemeral });

        const modal = new ModalBuilder().setCustomId(`ava_modal_addmember_${messageId}`).setTitle('Add Member to AVA');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('userId').setLabel('User ID')
              .setStyle(TextInputStyle.Short).setPlaceholder('Right-click the user → Copy ID').setRequired(true).setMaxLength(20)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('roleName').setLabel('Role to assign')
              .setStyle(TextInputStyle.Short).setPlaceholder(`e.g. ${ava.roles.map(r => r.name).join(' / ')}`).setRequired(true).setMaxLength(50)
          ),
        );
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('ava_modal_addmember_')) {
        const messageId   = interaction.customId.replace('ava_modal_addmember_', '');
        const ava         = getAva(messageId);
        if (!ava) return safeReply(interaction, { content: '❌ AVA not found.', flags: MessageFlags.Ephemeral });
        if (interaction.user.id !== ava.hostId) return safeReply(interaction, { content: '❌ Only the host can add members.', flags: MessageFlags.Ephemeral });

        const userId      = interaction.fields.getTextInputValue('userId').trim();
        const roleNameRaw = interaction.fields.getTextInputValue('roleName').trim().toUpperCase();
        const role        = ava.roles.find(r => r.name === roleNameRaw);
        if (!role) return safeReply(interaction, { content: `❌ Role **${roleNameRaw}** not found. Available: ${ava.roles.map(r => r.name).join(', ')}`, flags: MessageFlags.Ephemeral });
        if (ava.signups[userId]) return safeReply(interaction, { content: `⚠️ <@${userId}> is already in this AVA as **${ava.signups[userId].assignedRole || ava.signups[userId].selectedRole}**.`, flags: MessageFlags.Ephemeral });

        const count = Object.values(ava.signups).filter(s => s.assignedRole === role.name && s.status === 'accepted').length;
        if (role.limit && count >= role.limit) return safeReply(interaction, { content: `❌ **${role.name}** is full (${count}/${role.limit}).`, flags: MessageFlags.Ephemeral });

        let targetUser;
        try { targetUser = await interaction.client.users.fetch(userId); }
        catch { return safeReply(interaction, { content: `❌ Could not find user \`${userId}\`.`, flags: MessageFlags.Ephemeral }); }

        ava.signups[userId] = { userId, username: targetUser.tag, selectedRole: role.name, assignedRole: role.name, status: 'accepted', timestamp: Date.now(), addedByHost: true };
        saveAva(messageId, ava);
        await updateAvaEmbed(interaction.client, ava);

        try { await targetUser.send(`✅ You have been **added** to **${ava.title}** as **${role.name}**.`); } catch {}
        return safeReply(interaction, { content: `✅ **${targetUser.tag}** added as **${role.name}**.`, flags: MessageFlags.Ephemeral });
      }

      // ══════════════════════════════════════════════════════════════
      // HOST CONTROL — CANCEL AVA
      // ══════════════════════════════════════════════════════════════

      if (interaction.isButton() && interaction.customId.startsWith('ava_cancelava_')) {
        const messageId = interaction.customId.replace('ava_cancelava_', '');
        const ava       = getAva(messageId);
        if (!ava) return safeReply(interaction, { content: '❌ AVA not found.', flags: MessageFlags.Ephemeral });
        if (interaction.user.id !== ava.hostId) return safeReply(interaction, { content: '❌ Only the host can cancel.', flags: MessageFlags.Ephemeral });

        if (massTimers.has(messageId)) { clearTimeout(massTimers.get(messageId)); massTimers.delete(messageId); }

        ava.active = false;
        saveAva(messageId, ava);

        try {
          const channel = await interaction.client.channels.fetch(ava.channelId).catch(() => null);
          if (channel) {
            const msg = await channel.messages.fetch(messageId).catch(() => null);
            if (msg) {
              await msg.edit({
                embeds: [new EmbedBuilder().setTitle(`❌  ${ava.title} — CANCELLED`).setDescription('This AVA has been cancelled by the host.').setColor(0xED4245).setTimestamp()],
                components: [],
              });
            }
          }
        } catch (err) { console.error('❌ Could not edit embed on cancel:', err); }

        for (const signup of Object.values(ava.signups).filter(s => s.status === 'accepted')) {
          try { await (await interaction.client.users.fetch(signup.userId)).send(`❌ The AVA **${ava.title}** has been **cancelled**.`); } catch {}
        }

        deleteAva(messageId);
        return interaction.update({ content: `✅ AVA **${ava.title}** cancelled.`, components: [], embeds: [] });
      }

      // ══════════════════════════════════════════════════════════════
      // HOST CONTROL — EDIT MASS TIMER
      // ══════════════════════════════════════════════════════════════

      if (interaction.isButton() && interaction.customId.startsWith('ava_edittimer_')) {
        const messageId = interaction.customId.replace('ava_edittimer_', '');
        const ava       = getAva(messageId);
        if (!ava) return safeReply(interaction, { content: '❌ AVA not found.', flags: MessageFlags.Ephemeral });
        if (interaction.user.id !== ava.hostId) return safeReply(interaction, { content: '❌ Only the host can edit the timer.', flags: MessageFlags.Ephemeral });

        const modal = new ModalBuilder().setCustomId(`ava_modal_edittimer_${messageId}`).setTitle('Edit Mass Timer');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('minutes').setLabel('New time until mass (minutes from NOW)')
            .setStyle(TextInputStyle.Short).setPlaceholder('e.g. 30')
            .setValue(ava.massMinutes ? String(ava.massMinutes) : '').setRequired(true)
        ));
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('ava_modal_edittimer_')) {
        const messageId = interaction.customId.replace('ava_modal_edittimer_', '');
        const ava       = getAva(messageId);
        if (!ava) return safeReply(interaction, { content: '❌ AVA not found.', flags: MessageFlags.Ephemeral });
        if (interaction.user.id !== ava.hostId) return safeReply(interaction, { content: '❌ Only the host can edit the timer.', flags: MessageFlags.Ephemeral });

        const mins = parseInt(interaction.fields.getTextInputValue('minutes').trim());
        if (isNaN(mins) || mins < 1) return safeReply(interaction, { content: '❌ Please enter a valid number of minutes.', flags: MessageFlags.Ephemeral });

        ava.massMinutes = mins;
        ava.massTime    = Date.now() + mins * 60 * 1000;
        saveAva(messageId, ava);
        scheduleMass(interaction.client, messageId, ava);
        await updateAvaEmbed(interaction.client, ava);

        return safeReply(interaction, {
          content: `✅ Mass timer updated! New mass time: <t:${Math.floor(ava.massTime / 1000)}:R> (<t:${Math.floor(ava.massTime / 1000)}:t>)`,
          flags: MessageFlags.Ephemeral,
        });
      }

    } catch (err) {
      console.error('❌ Unexpected error in avaHandler:', err);
      try {
        const msg = { content: '❌ Something went wrong. Please try again.', flags: MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
        else await interaction.reply(msg);
      } catch { /* dead */ }
    }
  },
};

// ── Schedule mass message ──────────────────────────────────────────
function scheduleMass(client, messageId, ava) {
  if (massTimers.has(messageId)) clearTimeout(massTimers.get(messageId));

  const delay = ava.massTime - Date.now();
  if (delay <= 0) return;

  const timer = setTimeout(async () => {
    try {
      const fresh = getAva(messageId);
      if (!fresh || !fresh.active) return;

      const channel = await client.channels.fetch(fresh.channelId).catch(() => null);
      if (!channel) return;

      const accepted = Object.values(fresh.signups).filter(s => s.status === 'accepted');
      const pings    = accepted.map(s => `<@${s.userId}>`).join(' ');

      const massEmbed = new EmbedBuilder()
        .setTitle(`⚔️ ${fresh.title} — MASS TIME!`)
        .setDescription(fresh.massMessage)
        .setColor(0xED4245)
        .addFields({ name: '✅ Accepted Members', value: String(accepted.length), inline: true })
        .setTimestamp();

      for (const role of (fresh.roles || [])) {
        const members = accepted.filter(s => s.assignedRole === role.name);
        if (members.length) {
          massEmbed.addFields({
            name:   `${getRoleEmoji(role.name, role)} ${role.name}`,
            value:  members.map(s => `<@${s.userId}>`).join('\n'),
            inline: true,
          });
        }
      }

      // Send mass embed
      await channel.send({ embeds: [massEmbed] });

      // Send pings + voice channel invite as a plain message (NOT in the embed)
      if (pings || fresh.inviteUrl) {
        const parts = [];
        if (pings) parts.push(pings);
        if (fresh.voiceChannel) parts.push(`🔊 <#${fresh.voiceChannel}>`);
        if (fresh.inviteUrl)    parts.push(`🔗 ${fresh.inviteUrl}`);
        await channel.send({ content: parts.join('\n') });
      }

      // ✅ Set inactive BEFORE editing the embed so color goes red correctly
      fresh.active = false;
      saveAva(messageId, fresh);

      // Edit the signup embed — color will now be red because active = false
      const msg = await channel.messages.fetch(messageId).catch(() => null);
      if (msg) {
        await msg.edit({
          embeds:     [buildAvaEmbed(fresh)],
          components: buildAvaComponents(fresh, true),
        });
      }

      massTimers.delete(messageId);
    } catch (err) {
      console.error('❌ Error triggering mass:', err);
    }
  }, delay);

  massTimers.set(messageId, timer);
}
