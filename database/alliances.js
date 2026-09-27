'use strict';
const { prepare } = require('./database');
const now = () => new Date().toISOString();
const TYPES = new Set(['GROUP', 'SITE', 'CONTACT', 'SERVICE', 'OTHER']);
function normalize(data) {
  const type = String(data.type || '').toUpperCase();
  if (!TYPES.has(type)) throw new Error('ALLIANCE_TYPE_INVALID');
  const name = String(data.name || '').trim();
  const value = String(data.value || '').trim();
  if (!name || !value) throw new Error('ALLIANCE_REQUIRED');
  return { type, name, value, ownerName: data.ownerName || '', ownerContact: data.ownerContact || '', description: data.description || '', public: data.public !== false, active: data.active !== false };
}
function validateValue(type, value) {
  if (type === 'GROUP' && !/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+$/.test(value)) throw new Error('ALLIANCE_INVITE_INVALID');
  if ((type === 'SITE' || type === 'SERVICE') && !/^https?:\/\/[^\s]+$/i.test(value)) throw new Error('ALLIANCE_URL_INVALID');
  if (type === 'CONTACT' && !/^\+?[1-9]\d{7,14}$/.test(value.replace(/[\s()-]/g, ''))) throw new Error('ALLIANCE_PHONE_INVALID');
}
function listAlliances({ includePrivate = false, activeOnly = true } = {}) {
  let sql = 'SELECT * FROM alliances'; const args = []; const where = [];
  if (activeOnly) where.push('active = 1'); if (!includePrivate) where.push('public = 1');
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`; sql += ' ORDER BY id ASC';
  return prepare('alliances_list_' + (includePrivate ? 'all' : 'public') + (activeOnly ? '_active' : '_all'), sql).all(...args);
}
function getAlliance(id) { return prepare('alliance_get', 'SELECT * FROM alliances WHERE id = ?').get(Number(id)) || null; }
function addAlliance(data) { const d = normalize(data); validateValue(d.type, d.value); const t = now(); const r = prepare('alliance_add', `INSERT INTO alliances (type,name,value,owner_name,owner_contact,description,public,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(d.type,d.name,d.value,d.ownerName,d.ownerContact,d.description,d.public?1:0,d.active?1:0,t,t); return getAlliance(r.lastInsertRowid); }
function removeAlliance(id) { return prepare('alliance_remove', 'UPDATE alliances SET active = 0, updated_at = ? WHERE id = ? AND active = 1').run(now(), Number(id)).changes > 0; }
function updateAlliance(id, patch) { const old = getAlliance(id); if (!old) return null; const d = normalize({ ...old, ...patch, ownerName: patch.ownerName ?? old.owner_name, ownerContact: patch.ownerContact ?? old.owner_contact }); validateValue(d.type, d.value); prepare('alliance_update', `UPDATE alliances SET type=?,name=?,value=?,owner_name=?,owner_contact=?,description=?,public=?,active=?,updated_at=? WHERE id=?`).run(d.type,d.name,d.value,d.ownerName,d.ownerContact,d.description,d.public?1:0,d.active?1:0,now(),Number(id)); return getAlliance(id); }
module.exports = { TYPES: [...TYPES], listAlliances, getAlliance, addAlliance, removeAlliance, updateAlliance, validateValue };
