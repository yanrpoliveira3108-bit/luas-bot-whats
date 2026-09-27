'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert'); const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lua-community-')); process.env.DATABASE_FILE=path.join(dir,'db.sqlite');
const db=require('../database/database'); db.open(); const audit=require('../database/communityAudit'); const resolver=require('../utils/communityResolver');
const A='100@g.us',AA='101@g.us',A1='102@g.us',B='200@g.us',BA='201@g.us',B1='202@g.us';
audit.linkGroup({communityJid:A,announcementJid:AA,groupJid:A1}); audit.linkGroup({communityJid:B,announcementJid:BA,groupJid:B1});
(async()=>{const sock={groupMetadata:async(jid)=>({id:jid,subject:jid,participants:[]})}; const a=await resolver.resolve(sock,A1),b=await resolver.resolve(sock,B1); assert.strictEqual(a.announcementJid,AA); assert.strictEqual(b.announcementJid,BA); assert.notStrictEqual(a.announcementJid,b.announcementJid); console.log('communityIsolation.test.js: OK'); db.close();})().catch(e=>{console.error(e);process.exitCode=1;});
