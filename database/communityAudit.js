'use strict';

const crypto = require('crypto');
const { prepare, get } = require('./database');
const now = () => new Date().toISOString();
const valid = (jid) => String(jid || '').endsWith('@g.us');

function newId() { return `evt_${crypto.randomUUID()}`; }
function fingerprint(e) {
  const bucket = Math.floor(new Date(e.occurredAt || Date.now()).getTime() / 10000);
  return crypto.createHash('sha256').update([
    e.type, e.groupJid, e.participantJid, e.actorJid || '', bucket,
  ].join('|')).digest('hex');
}
function getCommunity(communityJid) {
  if (!valid(communityJid)) return null;
  return prepare('audit_community_get', 'SELECT * FROM community_audit_communities WHERE community_jid = ?').get(communityJid) || null;
}
function listCommunities() { return prepare('audit_community_list', 'SELECT * FROM community_audit_communities ORDER BY community_jid').all(); }
function configureCommunity({ communityJid, announcementJid, enabled = true, resolutionMode = 'manual', communityName = '' }) {
  if (!valid(communityJid) || !valid(announcementJid)) throw new Error('COMMUNITY_JID_INVALID');
  prepare('audit_community_upsert', `INSERT INTO community_audit_communities (community_jid, announcement_jid, enabled, resolution_mode, community_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(community_jid) DO UPDATE SET announcement_jid=excluded.announcement_jid, enabled=excluded.enabled, resolution_mode=excluded.resolution_mode, community_name=CASE WHEN excluded.community_name != '' THEN excluded.community_name ELSE community_audit_communities.community_name END, updated_at=excluded.updated_at`).run(communityJid, announcementJid, enabled ? 1 : 0, resolutionMode, communityName || '', now(), now());
  return getCommunity(communityJid);
}
function setEnabled(communityJid, enabled) { prepare('audit_community_enabled', 'UPDATE community_audit_communities SET enabled = ?, updated_at = ? WHERE community_jid = ?').run(enabled ? 1 : 0, now(), communityJid); return getCommunity(communityJid); }
function linkGroup({ communityJid, groupJid, announcementJid, resolutionMode = 'manual', groupName = '' }) {
  if (!valid(communityJid) || !valid(groupJid) || !valid(announcementJid)) throw new Error('GROUP_JID_INVALID');
  configureCommunity({ communityJid, announcementJid, resolutionMode });
  prepare('audit_community_group_upsert', `INSERT INTO community_audit_groups (community_jid, group_jid, announcement_jid, group_name, enabled, resolution_mode, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT(group_jid) DO UPDATE SET community_jid=excluded.community_jid, announcement_jid=excluded.announcement_jid, group_name=CASE WHEN excluded.group_name != '' THEN excluded.group_name ELSE community_audit_groups.group_name END, enabled=1, resolution_mode=excluded.resolution_mode, updated_at=excluded.updated_at`).run(communityJid, groupJid, announcementJid, groupName || '', resolutionMode, now(), now());
  return getGroupLink(groupJid);
}
function getGroupLink(groupJid) { return prepare('audit_group_get', 'SELECT * FROM community_audit_groups WHERE group_jid = ?').get(groupJid) || null; }
function listGroups(communityJid) { return prepare('audit_group_list', 'SELECT * FROM community_audit_groups WHERE community_jid = ? AND enabled = 1 ORDER BY group_jid').all(communityJid); }
function createEvent(event) {
  const eventId = event.eventId || newId();
  const fp = event.fingerprint || fingerprint(event);
  const duplicate = prepare('audit_event_duplicate', 'SELECT * FROM community_audit_events WHERE fingerprint = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1').get(fp, new Date(Date.now() - 60000).toISOString());
  if (duplicate) return { record: duplicate, duplicate: true };
  const createdAt = event.createdAt || now();
  prepare('audit_event_insert', `INSERT INTO community_audit_events (event_id, fingerprint, type, community_jid, announcement_jid, group_jid, participant_jid, actor_jid, reason, group_name, community_name, participant_name, member_count, occurred_at, created_at, delivery_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(eventId, fp, event.type, event.communityJid || null, event.announcementJid || null, event.groupJid, event.participantJid, event.actorJid || null, event.reason || null, event.groupName || '', event.communityName || '', event.participantName || '', event.memberCount == null ? null : Number(event.memberCount), event.occurredAt || createdAt, createdAt, event.deliveryStatus || (event.announcementJid ? 'PENDING' : 'UNRESOLVED'));
  return { record: getEvent(eventId), duplicate: false };
}
function getEvent(eventId) { return prepare('audit_event_get', 'SELECT * FROM community_audit_events WHERE event_id = ?').get(eventId) || null; }
function updateDelivery(eventId, status) { prepare('audit_event_status', 'UPDATE community_audit_events SET delivery_status = ?, delivered_at = CASE WHEN ? = \'SENT\' THEN ? ELSE delivered_at END WHERE event_id = ?').run(status, status, now(), eventId); }
module.exports = { valid, newId, fingerprint, getCommunity, listCommunities, configureCommunity, setEnabled, linkGroup, getGroupLink, listGroups, createEvent, getEvent, updateDelivery };
