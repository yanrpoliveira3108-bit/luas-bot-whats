'use strict';
const audit = require('../database/communityAudit');
const metaCache = require('./groupMetadataCache');
const logger = require('./logger').child('community-audit');
const isGroup = (v) => audit.valid(v);
const bool = (v) => v === true ? 'true' : v === false ? 'false' : 'unknown';

function resolutionLog(fields) {
  logger.info(fields, '[COMMUNITY_RESOLVER]');
}

async function getMeta(sock, jid) {
  if (!isGroup(jid)) return null;
  try { const cached = await metaCache.garantir(jid); if (cached) return cached; } catch (_) {}
  try { return await sock.groupMetadata(jid); } catch (_) { return null; }
}

async function resolve(sock, groupJid) {
  if (!isGroup(groupJid)) return { status: 'UNRESOLVED', reason: 'GROUP_JID_INVALID', groupJid };
  const meta = await getMeta(sock, groupJid);
  const manual = audit.getGroupLink(groupJid);
  let communityJid = meta && isGroup(meta.linkedParent) ? meta.linkedParent : null;
  let announcementJid = null;
  let communityName = '';
  let mode = communityJid ? 'AUTO' : null;
  if (communityJid && meta && meta.isCommunityAnnounce) {
    announcementJid = groupJid;
    communityName = meta.subject || '';
  }
  if (communityJid && !announcementJid) {
    const configured = audit.getCommunity(communityJid);
    if (configured && isGroup(configured.announcement_jid)) {
      announcementJid = configured.announcement_jid;
      communityName = configured.community_name || '';
    }
  }
  if (!communityJid || !announcementJid) {
    logger.warn({ groupJid, groupSubject: meta && meta.subject || '', linkedParent: meta && meta.linkedParent || null, isCommunity: bool(meta && meta.isCommunity), isCommunityAnnounce: bool(meta && meta.isCommunityAnnounce), announce: bool(meta && meta.announce) }, 'AUTO_RESOLUTION_FAILED');
  }
  if ((!communityJid || !announcementJid) && manual) {
    communityJid = manual.community_jid;
    announcementJid = manual.announcement_jid;
    mode = 'MANUAL';
    communityName = communityName || (audit.getCommunity(communityJid) || {}).community_name || '';
  }
  let announcementMeta = null;
  if (communityJid && announcementJid && isGroup(communityJid) && isGroup(announcementJid)) {
    announcementMeta = announcementJid === groupJid ? meta : await getMeta(sock, announcementJid);
    const announcedParent = announcementMeta && announcementMeta.linkedParent;
    if (announcedParent && isGroup(announcedParent) && announcedParent !== communityJid) {
      logger.error({ groupJid, communityJid, announcementJid, announcedParent }, '[COMMUNITY_AUDIT_DESTINATION_MISMATCH]');
      resolutionLog({ groupJid, groupSubject: meta && meta.subject || '', linkedParent: meta && meta.linkedParent || null, isCommunity: bool(meta && meta.isCommunity), isCommunityAnnounce: bool(meta && meta.isCommunityAnnounce), announce: bool(meta && meta.announce), communityJid, announcementJid: null, resolutionMode: 'UNRESOLVED' });
      return { status: 'UNRESOLVED', reason: 'DESTINATION_MISMATCH', groupJid, meta, announcementMeta, mode: mode || 'UNRESOLVED' };
    }
  }
  if (!communityJid || !announcementJid || !isGroup(communityJid) || !isGroup(announcementJid)) {
    resolutionLog({ groupJid, groupSubject: meta && meta.subject || '', linkedParent: meta && meta.linkedParent || null, isCommunity: bool(meta && meta.isCommunity), isCommunityAnnounce: bool(meta && meta.isCommunityAnnounce), announce: bool(meta && meta.announce), communityJid: communityJid || null, announcementJid: announcementJid || null, resolutionMode: 'UNRESOLVED' });
    logger.warn({ groupJid }, '[COMMUNITY_AUDIT_UNRESOLVED]');
    return { status: 'UNRESOLVED', groupJid, meta, announcementMeta, mode: mode || 'UNRESOLVED' };
  }
  if (!communityName) communityName = (meta && meta.subject) || communityJid;
  if (mode === 'AUTO' && !audit.getGroupLink(groupJid)) {
    try { audit.linkGroup({ communityJid, groupJid, announcementJid, resolutionMode: 'automatic', groupName: meta && meta.subject }); } catch (_) {}
  }
  resolutionLog({ groupJid, groupSubject: meta && meta.subject || '', linkedParent: meta && meta.linkedParent || null, isCommunity: bool(meta && meta.isCommunity), isCommunityAnnounce: bool(meta && meta.isCommunityAnnounce), announce: bool(meta && meta.announce), communityJid, announcementJid, resolutionMode: mode || 'MANUAL' });
  return { status: 'RESOLVED', communityJid, announcementJid, groupJid, communityName, groupMeta: meta, announcementMeta, mode: mode || 'MANUAL' };
}
module.exports = { resolve, getMeta };
