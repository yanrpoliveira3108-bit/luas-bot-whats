'use strict';
const audit = require('../../database/communityAudit');
const resolver = require('../../utils/communityResolver');
const renderer = require('./renderer');
const profile = require('../welcome/profile');
const logger = require('../../utils/logger').child('community-audit');
const queues = new Map();
function enqueue(key, job) { const prev=queues.get(key)||Promise.resolve(); const next=prev.catch(()=>{}).then(job).finally(()=>{if(queues.get(key)===next)queues.delete(key);}); queues.set(key,next); return next; }
function typeFor(action) { return { add:'JOIN', leave:'LEAVE', remove:'REMOVE', promote:'PROMOTE', demote:'DEMOTE' }[action] || null; }
function kind(jid) { return String(jid || '').endsWith('@lid') ? 'LID' : String(jid || '').endsWith('@s.whatsapp.net') ? 'PN' : 'OTHER'; }
function member(meta,jid){const keys=new Set([String(jid||''),String(jid||'').split(':')[0]]);return (meta?.participants||[]).find(p=>[p.id,p.lid,p.phoneNumber].filter(Boolean).some(v=>keys.has(String(v))));}
function nameOf(meta,jid,fallback){const p=member(meta,jid);return p&&(p.notify||p.name||p.pushName)||fallback||null;}
async function process(sock,event,base) {
  const resolved=await resolver.resolve(sock,event.id);
  const groupMeta=resolved.groupMeta; const participantName=nameOf(groupMeta,base.participantJid,null); const actorName=nameOf(groupMeta,base.actorJid,null);
  const data={...base,...resolved,groupName:groupMeta?.subject||'',participantName:participantName||base.participantJid,participantDisplayName:participantName,actorDisplayName:actorName,deliveryStatus:resolved.status==='RESOLVED'?'PENDING':'UNRESOLVED'};
  const made=audit.createEvent(data); if(made.duplicate)return;
  const record=made.record;
  logger.info({eventId:record.event_id,type:base.type,groupJid:event.id,communityJid:resolved.communityJid||null,announcementJid:resolved.announcementJid||null,participantKind:kind(base.participantJid),actorPresent:Boolean(base.actorJid),resolutionMode:resolved.mode||'UNRESOLVED',deliveryStatus:record.delivery_status},'[COMMUNITY_AUDIT]');
  if(resolved.status!=='RESOLVED'){ logger.warn({eventId:record.event_id,groupJid:event.id},'[COMMUNITY_AUDIT_UNRESOLVED]'); return; }
  const community=audit.getCommunity(resolved.communityJid); if(community && !community.enabled)return;
  try { const avatar=await profile.getPhoto(sock,base.participantJid); const image=await renderer.renderAuditCard({...data,eventId:record.event_id},{avatarBuffer:avatar}); logger.info({eventId:record.event_id,type:base.type,destination:resolved.announcementJid},'[COMMUNITY_AUDIT_SEND]'); await sock.sendMessage(resolved.announcementJid,{image,caption:`LUA ${base.type} AUDIT ${record.event_id}`}); audit.updateDelivery(record.event_id,'SENT'); logger.info({eventId:record.event_id,success:true},'[COMMUNITY_AUDIT_SENT]'); } catch(err) { audit.updateDelivery(record.event_id,'FAILED'); logger.error({eventId:record.event_id,type:base.type,destination:resolved.announcementJid,errorCode:err.code||'AUDIT_SEND_FAILED'},'[COMMUNITY_AUDIT_ERROR]'); }
}
async function handle(sock, ev) {
  if(!ev || !String(ev.id||'').endsWith('@g.us'))return;
  const type=typeFor(ev.action); if(!type)return;
  const participants=Array.isArray(ev.participants)?ev.participants:[];
  logger.info({action:ev.action,groupJid:ev.id,participantsCount:participants.length,authorPresent:Boolean(ev.author)},'[COMMUNITY_EVENT]');
  for(const participantJid of participants){ let actorJid=ev.author||null; if(type==='LEAVE' && actorJid===participantJid) actorJid=null; const task={type,groupJid:ev.id,participantJid,actorJid,reason:null,occurredAt:new Date().toISOString(),groupName:'',communityName:'',participantName:participantJid,memberCount:null}; enqueue(ev.id,()=>process(sock,ev,task)); }
}
module.exports={handle,enqueue,queues};
