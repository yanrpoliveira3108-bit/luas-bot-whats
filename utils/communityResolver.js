'use strict';
const audit = require('../database/communityAudit');
const metaCache = require('./groupMetadataCache');
const logger = require('./logger').child('community-audit');
const isGroup = (v) => audit.valid(v);

async function resolve(sock, groupJid) {
  if (!isGroup(groupJid)) return { status: 'UNRESOLVED', reason: 'GROUP_JID_INVALID' };
  let meta = null;
  try { meta = await metaCache.garantir(groupJid); } catch (_) {}
  if (!meta) { try { meta = await sock.groupMetadata(groupJid); } catch (_) {} }
  const manual = audit.getGroupLink(groupJid);
  let communityJid = meta && isGroup(meta.linkedParent) ? meta.linkedParent : null;
  let announcementJid = null;
  let communityName = '';
  let mode = communityJid ? 'automatic' : null;
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
  if ((!communityJid || !announcementJid) && manual) {
    communityJid = manual.community_jid;
    announcementJid = manual.announcement_jid;
    mode = manual.resolution_mode || 'manual';
    communityName = communityName || (audit.getCommunity(communityJid) || {}).community_name || '';
  }
  if (!communityJid || !announcementJid || !isGroup(communityJid) || !isGroup(announcementJid)) {
    logger.warn({ groupJid }, '[COMMUNITY_AUDIT_UNRESOLVED]');
    return { status: 'UNRESOLVED', groupJid, meta, mode: mode || 'none' };
  }
  if (!communityName) communityName = (meta && meta.subject) || communityJid;
  if (mode === 'automatic' && !audit.getGroupLink(groupJid)) {
    try { audit.linkGroup({ communityJid, groupJid, announcementJid, resolutionMode: 'automatic', groupName: meta && meta.subject }); } catch (_) {}
  }
  return { status: 'RESOLVED', communityJid, announcementJid, groupJid, communityName, groupMeta: meta, mode: mode || 'manual' };
}
module.exports = { resolve };
