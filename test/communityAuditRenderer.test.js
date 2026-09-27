'use strict';
const fs=require('fs'); const path=require('path'); const assert=require('assert');
const renderer=require('../plugins/communityAudit/renderer');
const templates=require('../plugins/welcome/templates');
(async()=>{const avatar=await templates.ensureAvatar(); const base={eventId:'evt_fixture_20260927',communityName:'Comunidade Nightfall 🌙 com um nome deliberadamente muito comprido',groupName:'Grupo Dev Lunar com nome muito comprido para testar wrap',participantName:'Usuário de Teste 🚀 Unicode',participantJid:'123456@lid',actorJid:null,reason:null,memberCount:198}; for(const type of ['JOIN','LEAVE','REMOVE','PROMOTE','DEMOTE']){const b=await renderer.renderAuditCard({...base,type},{avatarBuffer:avatar}); assert(Buffer.isBuffer(b)&&b.length>1000); fs.writeFileSync(path.join(__dirname,`${type.toLowerCase()}.png`),b);} console.log('communityAuditRenderer.test.js: OK');})().catch(e=>{console.error(e);process.exitCode=1;});
