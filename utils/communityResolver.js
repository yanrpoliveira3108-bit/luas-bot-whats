'use strict';
const audit = require('../database/communityAudit');
const metaCache = require('./groupMetadataCache');
const logger = require('./logger').child('community-audit');
const isGroup = (v) => audit.valid(v);
const bool = (v) => v === true ? 'true' : v === false ? 'false' : 'unknown';
const hasRelation = (m) => Boolean(m && (isGroup(m.linkedParent) || m.isCommunity || m.isCommunityAnnounce));
function resolutionLog(fields) { logger.info(fields, '[COMMUNITY_RESOLVER]'); }
function cached(jid) { return metaCache._interno && metaCache._interno.cache.get(String(jid))?.data || null; }
async function socketMeta(sock, jid) { try { return await sock.groupMetadata(jid); } catch (_) { return null; } }
async function getMeta(sock, jid, options = {}) {
  if (!isGroup(jid)) return null;
  const cacheMeta = cached(jid);
  if (cacheMeta && !options.forceSocket) return cacheMeta;
  return socketMeta(sock, jid);
}
function probeLog(groupJid, source, meta) {
  logger.info({ groupJid, source, metadataFound: Boolean(meta), linkedParent: meta?.linkedParent || null, isCommunity: bool(meta?.isCommunity), isCommunityAnnounce: bool(meta?.isCommunityAnnounce), subject: meta?.subject || '' }, '[COMMUNITY_METADATA_PROBE]');
}
async function probe(sock, groupJid) {
  const cacheMeta = cached(groupJid);
  probeLog(groupJid, cacheMeta ? 'CACHE' : 'NONE', cacheMeta);
  let socket = null;
  if (!cacheMeta || !hasRelation(cacheMeta)) socket = await socketMeta(sock, groupJid);
  if (socket) probeLog(groupJid, 'SOCKET', socket);
  if (cacheMeta && socket) logger.info({ groupJid, cacheLinkedParent: cacheMeta.linkedParent || null, socketLinkedParent: socket.linkedParent || null, cacheIsCommunityAnnounce: bool(cacheMeta.isCommunityAnnounce), socketIsCommunityAnnounce: bool(socket.isCommunityAnnounce) }, '[COMMUNITY_METADATA_COMPARE]');
  return { cache: cacheMeta, socket, selected: socket || cacheMeta };
}
async function resolve(sock, groupJid, options = {}) {
  if (!isGroup(groupJid)) return { status: 'UNRESOLVED', reason: 'GROUP_JID_INVALID', groupJid };
  let meta = await getMeta(sock, groupJid, options);
  let source = meta ? (cached(groupJid) === meta ? 'CACHE' : 'SOCKET') : 'NONE';
  if (meta && !hasRelation(meta)) {
    const fresh = await socketMeta(sock, groupJid);
    if (fresh) { probeLog(groupJid, 'SOCKET', fresh); if (cached(groupJid)) logger.info({ groupJid, cacheLinkedParent: cached(groupJid).linkedParent || null, socketLinkedParent: fresh.linkedParent || null, cacheIsCommunityAnnounce: bool(cached(groupJid).isCommunityAnnounce), socketIsCommunityAnnounce: bool(fresh.isCommunityAnnounce) }, '[COMMUNITY_METADATA_COMPARE]'); meta = fresh; source = 'SOCKET'; if (metaCache._interno?.guardar) metaCache._interno.guardar(groupJid, fresh, 'community resolver diagnostic refresh'); }
  }
  probeLog(groupJid, source, meta);
  const manual = audit.getGroupLink(groupJid);
  let communityJid = meta && isGroup(meta.linkedParent) ? meta.linkedParent : null;
  let announcementJid = null; let communityName = ''; let mode = communityJid ? 'AUTO' : null;
  if (communityJid && meta?.isCommunityAnnounce) { announcementJid = groupJid; communityName = meta.subject || ''; }
  if (communityJid && !announcementJid) { const configured = audit.getCommunity(communityJid); if (configured && isGroup(configured.announcement_jid)) { announcementJid = configured.announcement_jid; communityName = configured.community_name || ''; } }
  if (!communityJid || !announcementJid) logger.warn({ groupJid, groupSubject: meta?.subject || '', linkedParent: meta?.linkedParent || null, isCommunity: bool(meta?.isCommunity), isCommunityAnnounce: bool(meta?.isCommunityAnnounce), announce: bool(meta?.announce) }, 'AUTO_RESOLUTION_FAILED');
  if ((!communityJid || !announcementJid) && manual) { communityJid = manual.community_jid; announcementJid = manual.announcement_jid; mode = 'MANUAL'; communityName = communityName || (audit.getCommunity(communityJid) || {}).community_name || ''; }
  let announcementMeta = null;
  if (communityJid && announcementJid && isGroup(communityJid) && isGroup(announcementJid)) {
    announcementMeta = announcementJid === groupJid ? meta : await getMeta(sock, announcementJid);
    const announcedParent = announcementMeta?.linkedParent;
    if (announcedParent && isGroup(announcedParent) && announcedParent !== communityJid) { logger.error({ groupJid, communityJid, announcementJid, announcedParent }, '[COMMUNITY_AUDIT_DESTINATION_MISMATCH]'); resolutionLog({ groupJid, groupSubject: meta?.subject || '', linkedParent: meta?.linkedParent || null, isCommunity: bool(meta?.isCommunity), isCommunityAnnounce: bool(meta?.isCommunityAnnounce), announce: bool(meta?.announce), communityJid, announcementJid: null, resolutionMode: 'UNRESOLVED' }); return { status:'UNRESOLVED', reason:'DESTINATION_MISMATCH', groupJid, meta, announcementMeta, mode:'UNRESOLVED', source }; }
  }
  if (!communityJid || !announcementJid || !isGroup(communityJid) || !isGroup(announcementJid)) { resolutionLog({ groupJid, groupSubject: meta?.subject || '', linkedParent: meta?.linkedParent || null, isCommunity: bool(meta?.isCommunity), isCommunityAnnounce: bool(meta?.isCommunityAnnounce), announce: bool(meta?.announce), communityJid: communityJid || null, announcementJid: announcementJid || null, resolutionMode:'UNRESOLVED' }); logger.warn({ groupJid }, '[COMMUNITY_AUDIT_UNRESOLVED]'); return { status:'UNRESOLVED', groupJid, meta, announcementMeta, mode:'UNRESOLVED', source }; }
  if (!communityName) communityName = meta?.subject || communityJid;
  if (mode === 'AUTO' && !audit.getGroupLink(groupJid)) { try { audit.linkGroup({ communityJid, groupJid, announcementJid, resolutionMode:'automatic', groupName:meta?.subject }); } catch (_) {} }
  resolutionLog({ groupJid, groupSubject:meta?.subject || '', linkedParent:meta?.linkedParent || null, isCommunity:bool(meta?.isCommunity), isCommunityAnnounce:bool(meta?.isCommunityAnnounce), announce:bool(meta?.announce), communityJid, announcementJid, resolutionMode:mode || 'MANUAL' });
  return { status:'RESOLVED', communityJid, announcementJid, groupJid, communityName, groupMeta:meta, announcementMeta, mode:mode || 'MANUAL', source };
}
module.exports = { resolve, getMeta, probe, cached };
