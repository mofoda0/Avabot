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
    // Atomic write — prevents JSON corruption on crash
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  } catch (err) {
    console.error(`❌ Could not save ${filePath}:`, err);
  }
}

// ── AVA records ────────────────────────────────────────────────────

function load()     { return loadFile(AVA_PATH); }
function save(data) { saveFile(AVA_PATH, data); }

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

// ── Bot config ─────────────────────────────────────────────────────

function getBotConfig(guildId) {
  return loadFile(CONFIG_PATH)[guildId] ?? {};
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
  { name: 'MAIN TANK',       limit: 1, description: 'Maps + Gucci Items'      },
  { name: 'SECOND TANK',     limit: 1, description: 'Cape and Bags'           },
  { name: 'MAIN HEALER',     limit: 1, description: 'Artifacts'               },
  { name: 'SNAKE',           limit: 1, description: 'Helmets'                 },
  { name: 'INCUBUS SUPPORT', limit: 1, description: 'Ground Loot'             },
  { name: 'SHADOWCALLER',    limit: 1, description: 'Melee DPS'               },
  { name: 'REALNIGGER',      limit: 1, description: 'Range DPS'               },
  { name: 'CRSYTAL REAPER',  limit: 3, description: 'Off Hands / Shoes / Armor' },
  { name: 'EXTRA DPS',       limit: 1, description: null                      },
];

const SYSTEM_DEFAULTS = {
  title:        'AVA 8.3',
  description:  null,
  roles:        DEFAULT_ROLES,
  massMessage:  'Massing Now!',
  imageUrl:     null,
  voiceChannel: null,
  inviteUrl:    null,
  massMinutes:  null,
  pingRoleId:   null,
};

function _hostKey(guildId, userId) { return `${guildId}_${userId}`; }

function getHostDefaults(guildId, userId) {
  const all   = loadFile(DEFAULTS_PATH);
  const saved = all[_hostKey(guildId, userId)] ?? {};

  // Build roles: use saved roles if present, otherwise system defaults.
  // FIX: if a saved role has description: null but the system default for that
  // same role name has a description, inherit it — prevents stale null from
  // disk wiping descriptions that were added/changed in DEFAULT_ROLES.
  let roles;
  if (saved.roles) {
    roles = JSON.parse(JSON.stringify(saved.roles)).map(savedRole => {
      if (savedRole.description !== null && savedRole.description !== undefined) {
        return savedRole; // host explicitly set a description, keep it
      }
      const systemRole = DEFAULT_ROLES.find(r => r.name === savedRole.name);
      return {
        ...savedRole,
        description: systemRole?.description ?? null,
      };
    });
  } else {
    roles = JSON.parse(JSON.stringify(SYSTEM_DEFAULTS.roles));
  }

  return {
    ...JSON.parse(JSON.stringify(SYSTEM_DEFAULTS)),
    ...saved,
    roles,
    massTime: null,
  };
}

function saveHostDefaults(guildId, userId, draft) {
  const all = loadFile(DEFAULTS_PATH);
  const key = _hostKey(guildId, userId);
  all[key] = {
    title:        draft.title,
    description:  draft.description  ?? null,
    imageUrl:     draft.imageUrl     ?? null,
    voiceChannel: draft.voiceChannel ?? null,
    inviteUrl:    draft.inviteUrl    ?? null,
    massMessage:  draft.massMessage,
    massMinutes:  draft.massMinutes  ?? null,
    pingRoleId:   draft.pingRoleId   ?? null,
    roles: (draft.roles ?? []).map(r => ({
      name:        r.name,
      limit:       r.limit       ?? null,
      emoji:       r.emoji       ?? null,
      description: r.description ?? null,
    })),
  };
  saveFile(DEFAULTS_PATH, all);
}

function resetHostDefaults(guildId, userId) {
  const all = loadFile(DEFAULTS_PATH);
  delete all[_hostKey(guildId, userId)];
  saveFile(DEFAULTS_PATH, all);
}

module.exports = {
  load, save,
  getAva, saveAva, deleteAva, getGuildAvas,
  getAvaLeaderRoleId, setAvaLeaderRoleId,
  getHostDefaults, saveHostDefaults, resetHostDefaults,getGuildAvas,
  DEFAULT_ROLES,
};
