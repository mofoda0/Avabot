const fs   = require('fs');
const path = require('path');

const AVA_PATH      = path.join(__dirname, '../data/ava.json');
const CONFIG_PATH   = path.join(__dirname, '../data/botConfig.json');
const DEFAULTS_PATH = path.join(__dirname, '../data/hostDefaults.json');

// ── Generic load/save helpers ──────────────────────────────────────

function loadFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return {}; }
}

function saveFile(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`❌ Could not save ${filePath}:`, err);
  }
}

// ── AVA records ────────────────────────────────────────────────────

function load()          { return loadFile(AVA_PATH); }
function save(data)      { saveFile(AVA_PATH, data); }

function getAva(messageId) {
  return load()[messageId] ?? null;
}

function saveAva(messageId, data) {
  const all = load();
  all[messageId] = data;
  save(all);
}

function deleteAva(messageId) {
  const all = load();
  delete all[messageId];
  save(all);
}

function getGuildAvas(guildId) {
  const all = load();
  return Object.entries(all)
    .filter(([, v]) => v.guildId === guildId)
    .map(([k, v]) => ({ messageId: k, ...v }));
}

function getAvaByHostPanel(panelMsgId) {
  const all = load();
  for (const [msgId, ava] of Object.entries(all)) {
    if (ava.pendingApprovals) {
      for (const approval of Object.values(ava.pendingApprovals)) {
        if (approval.panelMsgId === panelMsgId) return { messageId: msgId, ava };
      }
    }
  }
  return null;
}

// ── Bot config (AVA leader role per guild) ─────────────────────────

function getBotConfig(guildId) {
  const all = loadFile(CONFIG_PATH);
  return all[guildId] ?? {};
}

function setBotConfig(guildId, data) {
  const all = loadFile(CONFIG_PATH);
  all[guildId] = { ...(all[guildId] ?? {}), ...data };
  saveFile(CONFIG_PATH, all);
}

function getAvaLeaderRoleId(guildId) {
  return getBotConfig(guildId).avaLeaderRoleId ?? null;
}

function setAvaLeaderRoleId(guildId, roleId) {
  setBotConfig(guildId, { avaLeaderRoleId: roleId });
}

// ── Per-host saved defaults ────────────────────────────────────────

const DEFAULT_ROLES = [
  { name: 'MAIN TANK',       limit: 1 },
  { name: 'SECOND TANK',     limit: 1 },
  { name: 'MAIN HEALER',     limit: 1 },
  { name: 'SNAKE',           limit: 1 },
  { name: 'INCUBUS SUPPORT', limit: 1 },
  { name: 'SHADOWCALLER',    limit: 1 },
  { name: 'REALNIGGER',      limit: 1 },
  { name: 'CRSYTAL REAPER',  limit: 3 },
  { name: 'EXTRA DPS',       limit: 1 },
];

const SYSTEM_DEFAULTS = {
  title:        'AVA Raid Signup',
  description:  [
    'MAIN TANK >>    (MAPS + GUCCI ITEMS)',
    'SECOND TANK >>    (CAPE AND BAGS)',
    'MAIN HEALER >>    (ARTIFACTS)',
    'SNAKE >>    (HELMETS)',
    'INCUBUS SUPPORT >>    (GROUND LOOT)',
    'SHADOWCALLER >>    (MELEE DPS)',
    'REALNIGGER >>    (RANGE DPS)',
    'CRSYTAL REAPER >>    (OFF HANDS)',
    'CRSYTAL REAPER >>    (SHOES)',
    'CRSYTAL REAPER >>    (ARMOR)',
  ].join('\n'),
  roles:       DEFAULT_ROLES,
  massMessage: 'The raid is starting! Head to the voice channel now!',
  imageUrl:    null,
  // voiceChannel: stored internally for invite logic but NOT shown in any embed
  voiceChannel: null,
  inviteUrl:    null,   // ← host-provided link, sent as plain message at mass time
  massMinutes:  null,
  pingRoleId:   null,
};

function _hostKey(guildId, userId) {
  return `${guildId}_${userId}`;
}

/**
 * Returns the host's saved defaults merged over system defaults.
 * Always deep-clones so callers can mutate freely.
 */
function getHostDefaults(guildId, userId) {
  const all   = loadFile(DEFAULTS_PATH);
  const saved = all[_hostKey(guildId, userId)] ?? {};
  return {
    ...JSON.parse(JSON.stringify(SYSTEM_DEFAULTS)),
    ...saved,
    roles: saved.roles
      ? JSON.parse(JSON.stringify(saved.roles))
      : JSON.parse(JSON.stringify(SYSTEM_DEFAULTS.roles)),
    massTime: null, // always reset — recomputed from massMinutes at launch
  };
}

/**
 * Persists a subset of the draft as the host's new defaults.
 * Only saves template fields — never live signup data.
 */
function saveHostDefaults(guildId, userId, draft) {
  const all = loadFile(DEFAULTS_PATH);
  const key = _hostKey(guildId, userId);
  all[key] = {
    title:        draft.title,
    description:  draft.description,
    imageUrl:     draft.imageUrl     ?? null,
    voiceChannel: draft.voiceChannel ?? null,
    inviteUrl:    draft.inviteUrl    ?? null,
    massMessage:  draft.massMessage,
    massMinutes:  draft.massMinutes  ?? null,
    pingRoleId:   draft.pingRoleId   ?? null,
    roles: (draft.roles ?? []).map(r => ({ name: r.name, limit: r.limit ?? null, emoji: r.emoji ?? null })),
  };
  saveFile(DEFAULTS_PATH, all);
}

/**
 * Wipes the host's saved defaults so the system defaults are used next time.
 */
function resetHostDefaults(guildId, userId) {
  const all = loadFile(DEFAULTS_PATH);
  delete all[_hostKey(guildId, userId)];
  saveFile(DEFAULTS_PATH, all);
}

module.exports = {
  load, save,
  getAva, saveAva, deleteAva, getGuildAvas, getAvaByHostPanel,
  getAvaLeaderRoleId, setAvaLeaderRoleId,
  getHostDefaults, saveHostDefaults, resetHostDefaults,
  DEFAULT_ROLES,
};
