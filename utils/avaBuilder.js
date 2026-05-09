const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');

const ROLE_EMOJIS = {};

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
  const isActive    = ava.active !== false;
  const massExpired = ava.massTime && Date.now() >= ava.massTime;
  const color       = (isActive && !massExpired) ? 0x57F287 : 0xED4245;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`⚔️  ${ava.title}`)
    .setTimestamp();

  const headerLines = [];
  if (ava.description) headerLines.push(ava.description, '');
  if (ava.massTime) {
    const ts = Math.floor(ava.massTime / 1000);
    headerLines.push(`⏰ **Mass Time:** <t:${ts}:R> (<t:${ts}:t>)`);
  }
  headerLines.push(`👑 **Host:** <@${ava.hostId}>`);
  headerLines.push('');
  headerLines.push('━━━━━━━━━━━━━━━━━━━━━━━');
  embed.setDescription(headerLines.join('\n'));

  for (const role of (ava.roles || [])) {
    // Only accepted users shown/counted in the public embed
    const accepted = Object.values(ava.signups || {}).filter(
      s => s.assignedRole === role.name && s.status === 'accepted'
    );
    const slotInfo = role.limit ? `${accepted.length}/${role.limit}` : `${accepted.length}`;
    const emoji    = getRoleEmoji(role.name, role);

    let fieldValue = '';
    if (role.description) fieldValue += `*${role.description}*\n`;
    fieldValue += accepted.length > 0
      ? accepted.map(u => `<@${u.userId}>`).join('\n')
      : '*No signups yet*';

    embed.addFields({
      name:   `${emoji}  ${role.name}  \`[${slotInfo}]\``,
      value:  fieldValue,
      inline: false,
    });
  }

  const totalAccepted = Object.values(ava.signups || {}).filter(s => s.status === 'accepted').length;
  embed.setFooter({ text: `Total sign-ups: ${totalAccepted}` });
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
    // ONLY accepted count toward the slot limit — pending never blocks a slot
    const acceptedCount = Object.values(ava.signups || {}).filter(
      s => s.assignedRole === role.name && s.status === 'accepted'
    ).length;

    if (role.limit && acceptedCount >= role.limit) return; // hide full roles

    const slotStr   = role.limit ? `${acceptedCount}/${role.limit} slots` : `${acceptedCount} signed`;
    const descPart  = role.description ? `${role.description} • ` : '';
    const menuDesc  = `${descPart}${slotStr}`;
    const truncated = menuDesc.length > 100 ? menuDesc.slice(0, 97) + '…' : menuDesc;

    const option = new StringSelectMenuOptionBuilder()
      .setLabel(role.name)
      .setValue(role.name)
      .setDescription(truncated);

    const emojiObj = buildEmojiOption(emojiStr);
    if (emojiObj) option.setEmoji(emojiObj);
    selectMenu.addOptions(option);
  });

  if (selectMenu.options.length === 0) {
    selectMenu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('All roles are full').setValue('__full__').setDescription('No slots available')
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

// ── Live host DM panel ─────────────────────────────────────────────
// Single persistent DM message for the host.
// Edits itself every time the pending list changes.
// ava.hostPanelSelected    = userId of whichever applicant the host has picked
// ava.hostPanelMode        = 'pending' | 'manage'  (toggle between views)
// ava.managePanelSelected  = userId selected in the manage view

function buildLiveHostPanel(ava) {
  const signups  = ava.signups || {};
  const pending  = Object.values(signups).filter(s => s.status === 'pending');
  const accepted = Object.values(signups).filter(s => s.status === 'accepted');
  const massTs   = ava.massTime ? Math.floor(ava.massTime / 1000) : null;
  const mode     = ava.hostPanelMode || 'pending';

  // ── Embed ──────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setTitle(`⚔️ AVA Control Panel — ${ava.title}`)
    .setColor(mode === 'manage' ? 0xFEE75C : 0x5865F2)
    .setTimestamp();

  const descLines = [];
  if (massTs) descLines.push(`⏰ **Mass:** <t:${massTs}:R> (<t:${massTs}:t>)`);
  descLines.push(`✅ **Accepted:** ${accepted.length}   ⏳ **Pending:** ${pending.length}`);
  embed.setDescription(descLines.join('\n'));

  if (mode === 'pending') {
    // ── PENDING VIEW ─────────────────────────────────────────────
    if (pending.length > 0) {
      const lines = pending.map(s => {
        const roleName = s.assignedRole || s.selectedRole;
        const role     = ava.roles?.find(r => r.name === roleName);
        const emoji    = getRoleEmoji(roleName, role);
        return `${emoji} **${s.username}** → ${roleName}`;
      });
      embed.addFields({ name: '⏳ Pending Applicants', value: lines.join('\n') });
    } else {
      embed.addFields({ name: '⏳ Pending Applicants', value: '*None right now — looking clean* ✅' });
    }
  } else {
    // ── MANAGE VIEW ──────────────────────────────────────────────
    embed.addFields({
      name: `⚙️ Manage Members — Accepted (${accepted.length})`,
      value: accepted.length > 0
        ? accepted.map(s => {
            const role = ava.roles?.find(r => r.name === s.assignedRole);
            return `${getRoleEmoji(s.assignedRole, role)} **${s.username}** — ${s.assignedRole}`;
          }).join('\n')
        : '*No accepted members yet*',
    });
  }

  // ── Components ─────────────────────────────────────────────────
  const components = [];
  const selectedSignup = ava.hostPanelSelected ? signups[ava.hostPanelSelected] : null;
  const manageSelected = ava.managePanelSelected ? signups[ava.managePanelSelected] : null;

  if (mode === 'pending') {
    if (pending.length > 0) {
      // Row 1 — pick which applicant to manage
      const applicantSelect = new StringSelectMenuBuilder()
        .setCustomId(`ava_hp_pick_${ava.messageId}`)
        .setPlaceholder('Select a pending applicant to manage…');

      pending.forEach(s => {
        const roleName = s.assignedRole || s.selectedRole;
        const role     = ava.roles?.find(r => r.name === roleName);
        const emojiStr = getRoleEmoji(roleName, role);
        const opt      = new StringSelectMenuOptionBuilder()
          .setLabel(s.username)
          .setValue(s.userId)
          .setDescription(`Requested: ${roleName}`)
          .setDefault(s.userId === ava.hostPanelSelected);
        const emojiObj = buildEmojiOption(emojiStr);
        if (emojiObj) opt.setEmoji(emojiObj);
        applicantSelect.addOptions(opt);
      });
      components.push(new ActionRowBuilder().addComponents(applicantSelect));

      // Row 2 — optionally redirect selected applicant to a different role
      const roleSelect = new StringSelectMenuBuilder()
        .setCustomId(`ava_hp_changerole_${ava.messageId}`)
        .setPlaceholder(selectedSignup ? 'Redirect to a different role (optional)…' : 'Pick an applicant first…')
        .setDisabled(!selectedSignup);

      (ava.roles || []).forEach(role => {
        const acceptedCount = Object.values(signups).filter(
          s => s.assignedRole === role.name && s.status === 'accepted'
        ).length;
        const slotStr  = role.limit ? `${acceptedCount}/${role.limit} slots` : `${acceptedCount} signed`;
        const descPart = role.description ? `${role.description} • ` : '';
        const menuDesc = `${descPart}${slotStr}`;
        const opt = new StringSelectMenuOptionBuilder()
          .setLabel(role.name)
          .setValue(role.name)
          .setDescription(menuDesc.length > 100 ? menuDesc.slice(0, 97) + '…' : menuDesc)
          .setDefault(
            !!selectedSignup &&
            (selectedSignup.assignedRole || selectedSignup.selectedRole) === role.name
          );
        const emojiObj = buildEmojiOption(getRoleEmoji(role.name, role));
        if (emojiObj) opt.setEmoji(emojiObj);
        roleSelect.addOptions(opt);
      });
      components.push(new ActionRowBuilder().addComponents(roleSelect));

      // Row 3 — Accept / Reject / Remove (disabled until applicant is selected)
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ava_hp_accept_${ava.messageId}`)
          .setLabel('Accept').setEmoji('✅').setStyle(ButtonStyle.Success)
          .setDisabled(!selectedSignup),
        new ButtonBuilder()
          .setCustomId(`ava_hp_reject_${ava.messageId}`)
          .setLabel('Reject').setEmoji('❌').setStyle(ButtonStyle.Danger)
          .setDisabled(!selectedSignup),
        new ButtonBuilder()
          .setCustomId(`ava_hp_remove_${ava.messageId}`)
          .setLabel('Remove').setEmoji('🗑️').setStyle(ButtonStyle.Secondary)
          .setDisabled(!selectedSignup),
      ));
    }

    // Bottom row: switch to manage view + timer + cancel
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ava_hp_togglemanage_${ava.messageId}`)
        .setLabel('⚙️ Manage Members').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ava_edittimer_${ava.messageId}`)
        .setLabel('⏰ Edit Timer').setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`ava_cancelava_${ava.messageId}`)
        .setLabel('🗑️ Cancel AVA').setStyle(ButtonStyle.Danger),
    ));

  } else {
    // MANAGE VIEW components

    if (accepted.length > 0) {
      // Row 1 — select a member to manage
      const memberSelect = new StringSelectMenuBuilder()
        .setCustomId(`ava_hp_manageselect_${ava.messageId}`)
        .setPlaceholder('Select a member to manage...');

      accepted.forEach(s => {
        const role     = ava.roles?.find(r => r.name === s.assignedRole);
        const emojiStr = getRoleEmoji(s.assignedRole, role);
        const option   = new StringSelectMenuOptionBuilder()
          .setLabel(s.username).setValue(s.userId)
          .setDescription(`Currently: ${s.assignedRole}`)
          .setDefault(s.userId === ava.managePanelSelected);
        const emojiObj = buildEmojiOption(emojiStr);
        if (emojiObj) option.setEmoji(emojiObj);
        memberSelect.addOptions(option);
      });
      components.push(new ActionRowBuilder().addComponents(memberSelect));

      // Row 2 — change role for selected member
      const changeRoleSelect = new StringSelectMenuBuilder()
        .setCustomId(`ava_hp_managechangerole_${ava.messageId}`)
        .setPlaceholder(manageSelected ? 'Move to a different role…' : 'Pick a member first…')
        .setDisabled(!manageSelected);

      (ava.roles || []).forEach(role => {
        const acceptedCount = Object.values(signups).filter(
          s => s.assignedRole === role.name && s.status === 'accepted'
        ).length;
        const slotStr  = role.limit ? `${acceptedCount}/${role.limit} slots` : `${acceptedCount} signed`;
        const descPart = role.description ? `${role.description} • ` : '';
        const menuDesc = `${descPart}${slotStr}`;
        const opt = new StringSelectMenuOptionBuilder()
          .setLabel(role.name).setValue(role.name)
          .setDescription(menuDesc.length > 100 ? menuDesc.slice(0, 97) + '…' : menuDesc)
          .setDefault(!!manageSelected && manageSelected.assignedRole === role.name);
        const emojiObj = buildEmojiOption(getRoleEmoji(role.name, role));
        if (emojiObj) opt.setEmoji(emojiObj);
        changeRoleSelect.addOptions(opt);
      });
      components.push(new ActionRowBuilder().addComponents(changeRoleSelect));

      // Row 3 — remove selected member
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ava_hp_manageremove_${ava.messageId}`)
          .setLabel('Remove Member').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
          .setDisabled(!manageSelected),
      ));
    }

    // Last row: add member + back to pending view
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ava_manage_addmember_${ava.messageId}`)
        .setLabel('➕ Add Member').setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ava_hp_togglemanage_${ava.messageId}`)
        .setLabel('◀ Back to Pending').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ava_edittimer_${ava.messageId}`)
        .setLabel('⏰ Edit Timer').setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`ava_cancelava_${ava.messageId}`)
        .setLabel('🗑️ Cancel AVA').setStyle(ButtonStyle.Danger),
    ));
  }

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
          .map(s => `  └ <@${s.userId}>`).join('\n');
        const descStr = r.description ? ` — *${r.description}*` : '';
        const line = `\`${i + 1}.\` ${emoji} **${r.name}**${r.limit ? ` *(max ${r.limit})*` : ''}${r.emoji ? ` \`emoji:${r.emoji}\`` : ''}${descStr}`;
        return prefilled ? `${line}\n${prefilled}` : line;
      }).join('\n')
    : '*No roles added yet*';

  const embed = new EmbedBuilder()
    .setTitle('⚔️ AVA Setup Panel')
    .setColor(0x6c63ff)
    .setDescription('Configure your AVA below. All settings are saved as your defaults on launch.')
    .addFields(
      { name: '📌 Title',       value: ava.title       || '*Not set*',                                inline: true  },
      { name: '⏰ Mass Timer',   value: ava.massMinutes ? `${ava.massMinutes} min` : '*Not set*',      inline: true  },
      { name: '📣 Ping Role',   value: ava.pingRoleId  ? `<@&${ava.pingRoleId}>` : '*Not set*',       inline: true  },
      { name: '🔗 Invite Link', value: ava.inviteUrl   || '*Not set*',                                inline: false },
      { name: '📋 Roles',       value: roleList,                                                       inline: false },
      { name: '📝 Description', value: ava.description ? ava.description.slice(0, 300) : '*Not set*', inline: false },
    )
    .setFooter({ text: 'Tip: Use "Edit Role" to set a per-role description — shows in embed and dropdown.' });

  if (ava.imageUrl) embed.setImage(ava.imageUrl);
  return embed;
}

module.exports = {
  buildAvaEmbed, buildAvaComponents, buildLiveHostPanel,
  buildSetupEmbed, getRoleEmoji,
};
