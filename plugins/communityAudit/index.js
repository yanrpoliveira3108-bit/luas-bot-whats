'use strict';
const audit = require('../../database/communityAudit');
const resolver = require('../../utils/communityResolver');
const renderer = require('./renderer');
const profile = require('../welcome/profile');
const logger = require('../../utils/logger').child('community-audit');
const queues = new Map();
function enqueue(key, job) { const prev=queues.get(key)||Promise.resolve(); const next=prev.catch(()=>{}).then(job).finally(()=>{if(queues.get(key)===next)queues.delete(key);}); queues.set(key,next); return next; }
function typeFor(action) { return { add:'JOIN', leave:'LEAVE', remove:'REMOVE', promote:'PROMOTE', demote:'DEMOTE' }[action] || null; }
async function process(sock,event,base) { const resolved=await resolver.resolve(sock,event.id); const data={...base,...resolved, deliveryStatus:resolved.status==='RESOLVED'?'PENDING':'UNRESOLVED'}; const made=audit.createEvent(data); if(made.duplicate)return; const record=made.record; if(resolved.status!=='RESOLVED'){ logger.warn({eventId:record.event_id,groupJid:event.id},'[COMMUNITY_AUDIT_UNRESOLVED]'); return; } const community=audit.getCommunity(resolved.communityJid); if(community && !community.enabled)return; try { const avatar=await profile.getPhoto(sock,base.participantJid); const image=await renderer.renderAuditCard({...data,eventId:record.event_id},{avatarBuffer:avatar}); await sock.sendMessage(resolved.announcementJid,{image,caption:`🌙 ${base.type} • ${record.event_id}`}); audit.updateDelivery(record.event_id,'SENT'); } catch(err) { audit.updateDelivery(record.event_id,'FAILED'); logger.error({eventId:record.event_id,type:base.type,groupJid:event.id,errorCode:err.code||'AUDIT_SEND_FAILED'},'[DATABASE_AUDIT_ERROR]'); } }
async function handle(sock, ev) { if(!ev || !String(ev.id||'').endsWith('@g.us'))return; const type=typeFor(ev.action); if(!type)return; const participants=Array.isArray(ev.participants)?ev.participants:[]; for(const participantJid of participants){ let actorJid=ev.author||null; if(type==='LEAVE' && actorJid===participantJid) actorJid=null; const task={type,groupJid:ev.id,participantJid,actorJid,reason:null,occurredAt:new Date().toISOString(),groupName:'',communityName:'',participantName:participantJid,memberCount:null}; enqueue(ev.id,()=>process(sock,ev,task)); } }
module.exports={handle,enqueue,queues};
