'use strict';
const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const engine = require('./gameEngine');
const DATA = path.resolve(process.env.LUA_GAME_DATA || path.join(__dirname, '..', 'tmp', 'lua-imperios.json')); const PUBLIC = path.resolve(__dirname, '..', 'web', 'imperios'); const tickets = new Map(); const sessions = new Map();
function readDb(){try{return JSON.parse(fs.readFileSync(DATA,'utf8'));}catch(_){return {campaigns:{}}}}
function saveDb(db){fs.mkdirSync(path.dirname(DATA),{recursive:true});const tmp=`${DATA}.${process.pid}.${Date.now()}.tmp`;fs.writeFileSync(tmp,JSON.stringify(db));fs.renameSync(tmp,DATA)}
function json(res,status,data){const body=JSON.stringify(data);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':process.env.LUA_GAME_ORIGIN||'*'});res.end(body)}
function body(req){return new Promise((resolve,reject)=>{let b='';req.on('data',c=>{b+=c;if(b.length>100000)reject(new Error('payload grande'));});req.on('end',()=>{try{resolve(b?JSON.parse(b):{})}catch(_){reject(new Error('JSON inválido'))}});req.on('error',reject)})}
function token(){return crypto.randomBytes(32).toString('base64url')}
function campaignFor(user){const db=readDb();let c=db.campaigns[user];if(!c){c=engine.newCampaign('lua');db.campaigns[user]=c;saveDb(db)}return c}
function persist(user,c){const db=readDb();db.campaigns[user]=c;saveDb(db)}
function userFrom(req){const auth=String(req.headers.authorization||'');const t=auth.startsWith('Bearer ')?auth.slice(7):'';const s=sessions.get(t);if(!s||s.expires<Date.now())return null;return s.user}
function publicFile(res,url){const name=url==='/'?'index.html':url.slice(1);if(!['index.html','game.js','game.css'].includes(name))return false;const file=path.join(PUBLIC,name);if(!file.startsWith(PUBLIC)||!fs.existsSync(file))return false;res.writeHead(200,{'content-type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html','cache-control':'no-store'});fs.createReadStream(file).pipe(res);return true}
const server=http.createServer(async(req,res)=>{try{if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-headers':'authorization, content-type','access-control-allow-methods':'GET, POST, OPTIONS'});return res.end()}
 if(req.method==='GET'&&publicFile(res,new URL(req.url,'http://localhost').pathname))return;
 const url=new URL(req.url,'http://localhost'); if(url.pathname==='/api/access/exchange'&&req.method==='POST'){const q=await body(req);const t=tickets.get(String(q.ticket||''));if(!t||t.expires<Date.now()||t.used)return json(res,401,{error:'Acesso expirado ou já utilizado.'});t.used=true;const session=token();sessions.set(session,{user:t.user,expires:Date.now()+86400000});return json(res,200,{token:session})}
 const user=userFrom(req);if(!user)return json(res,401,{error:'Sessão necessária.'}); if(url.pathname==='/api/game/state'&&req.method==='GET'){return json(res,200,engine.publicState(campaignFor(user)))}
 if(url.pathname==='/api/game/action'&&req.method==='POST'){const p=await body(req);const c=campaignFor(user);if(!p.operationId||typeof p.operationId!=='string')return json(res,400,{error:'operationId obrigatório.'});if(p.version!==c.version)return json(res,409,{error:'O estado mudou. Recarregue a campanha.',state:engine.publicState(c)});let next=JSON.parse(JSON.stringify(c));if(p.type==='endTurn')engine.endTurn(next);else engine.action(next,'lua',p);persist(user,next);return json(res,200,engine.publicState(next))}
 if(url.pathname==='/api/game/new'&&req.method==='POST'){const p=await body(req);if(!engine.NATIONS.some((n)=>n.id===p.nation))return json(res,400,{error:'Nação inválida.'});const c=engine.newCampaign(p.nation);persist(user,c);return json(res,200,engine.publicState(c))}
 return json(res,404,{error:'Rota não encontrada.'});}catch(e){return json(res,e.message.startsWith('CONFLICT')?409:400,{error:e.message})}});
function createTicket(user){const value=token();tickets.set(value,{user,expires:Date.now()+10*60*1000,used:false});return value}
if(require.main===module){const port=Number(process.env.LUA_GAME_PORT||8787);server.listen(port,process.env.LUA_GAME_HOST||'0.0.0.0',()=>console.log(`Lua: Imperios em http://0.0.0.0:${port}`))}
module.exports={server,createTicket};
