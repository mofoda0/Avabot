const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');

const ROLE_EMOJIS = {
  'MAIN TANK':   '🛡️',
  'SECOND TANK': '⚔️',
  'MAIN HEALER': '💚',
};

function getRoleEmoji(roleName, role) {
  if (role && role.emoji) return role.emoji;
  for (const [key, emoji] of Object.entries(ROLE_EMOJIS)) {
    if (roleName.toUpperCase().includes(key)) return emoji;
  }
  return '⚪';
}

function buildEmojiOption(emojiStr) {
  if (!emojiStr) return undefined;
  if (/^\d+$/.test(emojiStr.trim())) return { id: emojiStr.trim() };
  return emojiStr.trim();
}

// ── Live AVA embed ─────────────────────────────────────────────────

function buildAvaEmbed(ava) {
  // Color: green while active + mass hasn't fired, red otherwise
  const isActive    = ava.active !== false;
  const massExpired = ava.massTime && Date.now() >= ava.massTime;
  const color       = (isActive && !massExpired) ? 0x57F287 : 0xED4245;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`⚔️  ${ava.title}`)
    .setTimestamp();

  const headerLines = [];
  if (ava.description) headerLines.push(ava.description, '');
  // NOTE: voice channel is intentionally NOT shown here
  if (ava.massTime) {
    const ts = Math.floor(ava.massTime / 1000);
    headerLines.push(`⏰ **Mass Time:** <t:${ts}:R> (<t:${ts}:t>)`);
  }
  headerLines.push(`👑 **Host:** <@${ava.hostId}>`);
  headerLines.push('');
  headerLines.push('━━━━━━━━━━━━━━━━━━━━━━━');

  embed.setDescription(headerLines.join('\n'));

  const roles   = ava.roles   || [];
  const signups = ava.signups || {};

  for (const role of roles) {
    const assignedUsers = Object.values(signups).filter(s => s.assignedRole === role.name && s.status === 'accepted');
    const lines    = assignedUsers.map(u => `✅ <@${u.userId}>`);
    const slotInfo = role.limit ? `${assignedUsers.length}/${role.limit}` : `${assignedUsers.length}`;
    const emoji    = getRoleEmoji(role.name, role);
    embed.addFields({
      name:   `${emoji}  ${role.name}  \`[${slotInfo}]\``,
      value:  lines.length > 0 ? lines.join('\n') : '*No signups yet*',
      inline: false,
    });
  }

  const totalAccepted = Object.values(signups).filter(s => s.status === 'accepted').length;
  embed.setFooter({ text: `Total sign-up: ${totalAccepted}` });

  if (ava.imageUrl)     embed.setImage(ava.imageUrl);
  if (ava.thumbnailUrl) embed.setThumbnail(ava.thumbnailUrl);

  return embed;
}

// ── Live AVA components ────────────────────────────────────────────

function buildAvaComponents(ava, disabled = false) {
  const rows  = [];
  const roles = ava.roles || [];
  if (roles.length === 0) return rows;

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`ava_select_role_${ava.messageId}`)
    .setPlaceholder('📋 Select a role to join...')
    .setDisabled(disabled);

  roles.forEach(role => {
    const emojiStr = getRoleEmoji(role.name, role);
    const assigned = Object.values(ava.signups || {}).filter(s => s.assignedRole === role.name && s.status === 'accepted').length;

    // Hide role from menu if the slot limit is reached
    if (role.limit && assigned >= role.limit) return;

    const limitStr = role.limit ? `${assigned}/${role.limit}` : `${assigned} signed`;

    const option = new StringSelectMenuOptionBuilder()
      .setLabel(role.name)
      .setValue(role.name)
      .setDescription(`Currently: ${limitStr}`);

    const emojiObj = buildEmojiOption(emojiStr);
    if (emojiObj) option.setEmoji(emojiObj);
    selectMenu.addOptions(option);
  });

  // If every role is full, disable the menu entirely
  if (selectMenu.options.length === 0) {
    selectMenu.addOptions(
      new StringSelectMenuOptionBuilder().setLabel('All roles are full').setValue('__full__').setDescription('No slots available')
    );
    selectMenu.setDisabled(true);
  }

  rows.push(new ActionRowBuilder().addComponents(selectMenu));

  const leaveBtn = new ButtonBuilder()
    .setCustomId(`ava_leave_${ava.messageId}`)
    .setLabel('Leave').setEmoji('🚪').setStyle(ButtonStyle.Danger).setDisabled(disabled);

  const infoBtn = new ButtonBuilder()
    .setCustomId(`ava_myinfo_${ava.messageId}`)
    .setLabel('My Status').setEmoji('👤').setStyle(ButtonStyle.Secondary);

  rows.push(new ActionRowBuilder().addComponents(leaveBtn, infoBtn));

  return rows;
}

// ── Host DM panel (new applicant) ─────────────────────────────────

function buildHostPanel(ava, applicantId) {
  const signup = ava.signups[applicantId];
  const roles  = ava.roles || [];

  const embed = new EmbedBuilder()
    .setTitle('📋 New Signup Request')
    .setColor(0x5865F2)
    .setDescription(`**${signup.username}** wants to join your AVA!`)
    .addFields(
      { name: '👤 User',           value: `<@${applicantId}>`,                              inline: true },
      { name: '🎯 Requested Role', value: signup.selectedRole,                               inline: true },
      { name: '⏰ Applied',         value: `<t:${Math.floor(signup.timestamp / 1000)}:R>`,   inline: true },
    )
    .setFooter({ text: `AVA: ${ava.title}` })
    .setTimestamp();

  const roleSelect = new StringSelectMenuBuilder()
    .setCustomId(`ava_host_changerole_${ava.messageId}_${applicantId}`)
    .setPlaceholder('Change role before accepting (optional)...');

  roles.forEach(role => {
    const emojiStr = getRoleEmoji(role.name, role);
    const option   = new StringSelectMenuOptionBuilder()
      .setLabel(role.name).setValue(role.name)
      .setDefault(role.name === signup.selectedRole);
    const emojiObj = buildEmojiOption(emojiStr);
    if (emojiObj) option.setEmoji(emojiObj);
    roleSelect.addOptions(option);
  });

  const acceptBtn = new ButtonBuilder()
    .setCustomId(`ava_host_accept_${ava.messageId}_${applicantId}`)
    .setLabel('Accept').setEmoji('✅').setStyle(ButtonStyle.Success);

  const rejectBtn = new ButtonBuilder()
    .setCustomId(`ava_host_reject_${ava.messageId}_${applicantId}`)
    .setLabel('Reject').setEmoji('❌').setStyle(ButtonStyle.Danger);

  const removeBtn = new ButtonBuilder()
    .setCustomId(`ava_host_remove_${ava.messageId}_${applicantId}`)
    .setLabel('Remove from AVA').setEmoji('🗑️').setStyle(ButtonStyle.Secondary);

  return {
    embeds:     [embed],
    components: [
      new ActionRowBuilder().addComponents(roleSelect),
      new ActionRowBuilder().addComponents(acceptBtn, rejectBtn, removeBtn),
    ],
  };
}

// ── Host manage panel ──────────────────────────────────────────────

function buildManagePanel(ava) {
  const accepted = Object.values(ava.signups).filter(s => s.status === 'accepted');

  const embed = new EmbedBuilder()
    .setTitle(`⚙️ Manage Members — ${ava.title}`)
    .setColor(0xFEE75C)
    .setDescription('Select a member to change their role or remove them.\nUse **➕ Add Member** to add someone by user ID.')
    .setTimestamp();

  if (accepted.length > 0) {
    const lines = accepted.map(s => {
      const role = ava.roles?.find(r => r.name === s.assignedRole);
      return `${getRoleEmoji(s.assignedRole, role)} **${s.username}** — ${s.assignedRole}`;
    });
    embed.addFields({ name: `✅ Accepted (${accepted.length})`, value: lines.join('\n') });
  }

  const memberSelect = new StringSelectMenuBuilder()
    .setCustomId(`ava_manage_select_${ava.messageId}`)
    .setPlaceholder('Select a member to manage...');

  accepted.forEach(s => {
    const role     = ava.roles?.find(r => r.name === s.assignedRole);
    const emojiStr = getRoleEmoji(s.assignedRole, role);
    const option   = new StringSelectMenuOptionBuilder()
      .setLabel(s.username)
      .setValue(s.userId)
      .setDescription(`Currently: ${s.assignedRole}`);
    const emojiObj = buildEmojiOption(emojiStr);
    if (emojiObj) option.setEmoji(emojiObj);
    memberSelect.addOptions(option);
  });

  const addMemberBtn = new ButtonBuilder()
    .setCustomId(`ava_manage_addmember_${ava.messageId}`)
    .setLabel('➕ Add Member')
    .setStyle(ButtonStyle.Success);

  const components = [];
  if (accepted.length > 0) components.push(new ActionRowBuilder().addComponents(memberSelect));
  components.push(new ActionRowBuilder().addComponents(addMemberBtn));

  return { embeds: [embed], components };
}

// ── Setup preview embed ────────────────────────────────────────────

function buildSetupEmbed(ava) {
  const roles   = ava.roles   || [];
  const signups = ava.signups || {};

  const roleList = roles.length
    ? roles.map((r, i) => {
        const emoji     = getRoleEmoji(r.name, r);
        const prefilled = Object.values(signups)
          .filter(s => s.assignedRole === r.name && s.status === 'accepted')
          .map(s => `  └ <@${s.userId}>`)
          .join('\n');
        const line = `\`${i + 1}.\` ${emoji} **${r.name}** ${r.limit ? `*(max ${r.limit})*` : ''} ${r.emoji ? `\`emoji:${r.emoji}\`` : ''}`;
        return prefilled ? `${line}\n${prefilled}` : line;
      }).join('\n')
    : '*No roles added yet*';

  const embed = new EmbedBuilder()
    .setTitle('⚔️ AVA Setup Panel')
    .setColor(0x6c63ff)
    .setDescription('Configure your AVA below. All settings are saved as your defaults on launch.')
    .addFields(
      { name: '📌 Title',       value: ava.title       || '*Not set*',                                         inline: true  },
      { name: '⏰ Mass Timer',   value: ava.massMinutes ? `${ava.massMinutes} min` : '*Not set*',               inline: true  },
      { name: '📣 Ping Role',   value: ava.pingRoleId  ? `<@&${ava.pingRoleId}>` : '*Not set*',                inline: true  },
      { name: '🔗 Invite Link', value: ava.inviteUrl   || '*Not set*',                                         inline: false },
      { name: '📋 Roles',       value: roleList,                                                                inline: false },
      { name: '📝 Description', value: ava.description ? ava.description.slice(0, 300) : '*Not set*',          inline: false },
    )
    .setFooter({ text: 'Tip: Role emojis accept a Unicode emoji OR a custom emoji ID (numbers only).' });

  if (ava.imageUrl) embed.setImage(ava.imageUrl);

  return embed;
}

module.exports = { buildAvaEmbed, buildAvaComponents, buildHostPanel, buildManagePanel, buildSetupEmbed, getRoleEmoji };
