const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setava')
    .setDescription('AVA raid signup management')

    // ── Create setup panel ──────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create and launch a new AVA raid signup (AVA Leader only)')
    )

    // ── Bot owner only ──────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('setleaderrole')
        .setDescription('(Bot owner only) Set which Discord role grants access to /setava create')
        .addRoleOption(opt =>
          opt.setName('role').setDescription('The role that should be treated as AVA Leader').setRequired(true)
        )
    )

    // ── Quick default setters (AVA Leader only) ─────────────────────
    .addSubcommand(sub =>
      sub
        .setName('settimer')
        .setDescription('Set your default mass timer (minutes from launch)')
        .addIntegerOption(opt =>
          opt.setName('minutes').setDescription('Minutes until mass fires after embed launches').setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('settitle')
        .setDescription('Set your default AVA title')
        .addStringOption(opt =>
          opt.setName('title').setDescription('The title shown on the embed').setRequired(true).setMaxLength(100)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('setimage')
        .setDescription('Set your default AVA image/GIF URL')
        .addStringOption(opt =>
          opt.setName('url').setDescription('Direct image or GIF URL').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('setpingrole')
        .setDescription('Set which role gets pinged when the AVA embed launches')
        .addRoleOption(opt =>
          opt.setName('role').setDescription('The role to ping on launch').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('setinvite')
        .setDescription('Set your default voice channel invite link (sent at mass time)')
        .addStringOption(opt =>
          opt.setName('url').setDescription('Discord invite URL e.g. https://discord.gg/abc123').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('setmassmsg')
        .setDescription('Set your default mass message (opens a modal)')
    )
    .addSubcommand(sub =>
      sub
        .setName('defaults')
        .setDescription('View your current saved defaults')
    )
    .addSubcommand(sub =>
      sub
        .setName('resetdefaults')
        .setDescription('Reset all your saved defaults back to the system defaults')
    ),
};
