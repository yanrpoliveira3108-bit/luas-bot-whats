'use strict';
const Jimp = require('jimp');
const templates = require('../welcome/templates');
const W = 1280; const H = 720;
const C = { bg:[6,10,25], surface:[19,25,45], surface2:[25,25,55], violet:[170,112,255], blue:[102,169,255], green:[104,221,180], rose:[224,111,143], gold:[238,196,105], text:[247,245,255], muted:[157,169,196], faint:[57,70,103] };
const TYPE = { JOIN:{title:'NOVO MEMBRO',accent:C.green,action:'ENTROU NO GRUPO'}, LEAVE:{title:'MEMBRO SAIU',accent:C.blue,action:'SAIDA VOLUNTARIA'}, REMOVE:{title:'MEMBRO REMOVIDO',accent:C.rose,action:'REMOVIDO'}, PROMOTE:{title:'PROMOCAO ADMINISTRATIVA',accent:C.gold,action:'MEMBRO -> ADMIN'}, DEMOTE:{title:'REBAIXAMENTO ADMINISTRATIVO',accent:C.blue,action:'ADMIN -> MEMBRO'} };
function ascii(value, fallback='') { const s=String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\r\n]+/g,' ').replace(/[^\x20-\x7E]/g,'').trim(); return s || fallback; }
function humanJid(jid) { const s=String(jid||''); if(s.endsWith('@lid')) return 'Identidade WhatsApp protegida'; if(s.endsWith('@s.whatsapp.net')) { const d=s.split('@')[0].split(':')[0]; return d.length>8 ? `+${d.slice(0,2)} ${d.slice(2,4)} *****-${d.slice(-4)}` : 'Numero protegido'; } return ''; }
function displayParticipant(e) { return ascii(e.participantDisplayName || e.participantName, humanJid(e.participantJid) || 'Membro'); }
function displayActor(e) { return ascii(e.actorDisplayName, e.actorJid ? humanJid(e.actorJid) : 'Nao identificado'); }
function displayGroup(e) { return /@(g\.us|lid|s\.whatsapp\.net)$/.test(String(e.groupName||'')) ? 'Grupo nao identificado' : ascii(e.groupName, 'Grupo nao identificado'); }
function displayCommunity(e) { return /@(g\.us|lid|s\.whatsapp\.net)$/.test(String(e.communityName||'')) ? 'Comunidade nao identificada' : ascii(e.communityName, 'Comunidade nao identificada'); }
function measure(font,s){return Jimp.measureText(font,s);}
function fitText(font,value,max,fallback='') { const original=ascii(value,fallback); let s=original; while(s.length>1&&measure(font,s)>max)s=s.slice(0,-1); return s.length<original.length?`${s.slice(0,-1)}...`:s; }
function wrapText(font,value,max,limit=2) { const words=ascii(value).split(/\s+/).filter(Boolean); const out=[]; let line=''; for(const w of words){const next=line?`${line} ${w}`:w;if(measure(font,next)<=max)line=next;else{if(line)out.push(line);line=w;if(out.length===limit-1)break;}} if(line&&out.length<limit)out.push(line); if(words.join(' ')!==out.join(' '))out[limit-1]=fitText(font,`${out[limit-1]||''}...`,max); return out; }
function rect(img,x,y,w,h,col,a=255){for(let yy=Math.max(0,y);yy<Math.min(H,y+h);yy++)for(let xx=Math.max(0,x);xx<Math.min(W,x+w);xx++){const i=img.getPixelIndex(xx,yy),d=img.bitmap.data,q=a/255;d[i]=d[i]*(1-q)+col[0]*q;d[i+1]=d[i+1]*(1-q)+col[1]*q;d[i+2]=d[i+2]*(1-q)+col[2]*q;d[i+3]=255;}}
function circle(img,cx,cy,r,col,a=255){for(let y=cy-r;y<=cy+r;y++)for(let x=cx-r;x<=cx+r;x++)if((x-cx)**2+(y-cy)**2<=r*r)rect(img,x,y,1,1,col,a);}
function line(img,x,y,w,col,a=210){rect(img,x,y,w,2,col,a);}
function stars(img){for(let i=0;i<70;i++){const x=(i*173)%W,y=(i*83)%H;rect(img,x,y,1,1,i%3?C.faint:C.violet,i%3?90:145);}}
function orbit(img,cx,cy,r,col){for(let a=0;a<360;a+=2){const rad=a*Math.PI/180;const x=Math.round(cx+Math.cos(rad)*r),y=Math.round(cy+Math.sin(rad)*r*.42);rect(img,x,y,1,1,col,70);}}
function shortAuditId(id){const s=String(id||'').replace(/^evt_/,'').replace(/-/g,'').toUpperCase();return s.slice(-8)||'LOCAL';}
function dateLabel(occurredAt){const d=new Date(occurredAt||Date.now());const months=['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];return `${String(d.getDate()).padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()} - ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
async function avatar(img,buffer){let src;try{src=await Jimp.read(buffer||await templates.ensureAvatar());}catch(_){src=await Jimp.read(await templates.ensureAvatar());}const size=Math.min(src.bitmap.width,src.bitmap.height);src.crop((src.bitmap.width-size)/2,(src.bitmap.height-size)/2,size,size).resize(204,204).circle();circle(img,205,292,116,C.violet,90);circle(img,205,292,106,C.bg,255);img.composite(src,103,190);}
function field(img,font,label,value,x,y,w){img.print(font,x,y,ascii(label).toUpperCase()); const lines=wrapText(font,value,w,2);lines.forEach((v,i)=>img.print(font,x,y+22+i*20,fitText(font,v,w)));return y+58+(lines.length-1)*14;}
async function renderAuditCard(event,visual={}){
 const img=new Jimp(W,H,Jimp.rgbaToInt(...C.bg,255)); stars(img); orbit(img,1110,130,130,C.violet); orbit(img,1110,130,170,C.blue); circle(img,1110,130,42,[30,35,67],170); circle(img,1110,130,28,[215,220,245],220); circle(img,1125,122,28,C.bg,255);
 const style=TYPE[event.type]||{title:ascii(event.type,'EVENTO'),accent:C.violet,action:''}; rect(img,34,30,1212,660,C.surface,245);rect(img,34,30,7,660,style.accent,255);rect(img,58,104,1160,1,C.faint,180);
 const fSmall=await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE),fLabel=await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE),fTitle=await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE),fName=await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE),fValue=await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
 img.print(fTitle,70,58,'LUA // COMMUNITY INTELLIGENCE');img.print(fSmall,1060,67,fitText(fSmall,event.type,120));
 await avatar(img,visual.avatarBuffer); img.print(fSmall,110,430,'IDENTIDADE'); img.print(fName,92,458,fitText(fName,displayParticipant(event),320)); img.print(fSmall,112,535,fitText(fSmall,event.participantJid&&String(event.participantJid).endsWith('@lid')?'IDENTIDADE PROTEGIDA':humanJid(event.participantJid),270));
 img.print(fTitle,455,136,fitText(fTitle,style.title,720)); img.print(fValue,455,190,fitText(fValue,style.action,720));
 let y=292; const left=455,right=845,w=330; y=field(img,fLabel,'COMUNIDADE',displayCommunity(event),left,y,w); y=field(img,fLabel,'GRUPO',displayGroup(event),left,y,w);
 if(event.type==='JOIN'){y=field(img,fLabel,'MEMBROS AGORA',event.memberCount==null?'':String(event.memberCount),left,y,w);}
 if(event.type==='REMOVE'){y=field(img,fLabel,'REMOVIDO POR',displayActor(event),right,292,w);y=field(img,fLabel,'MOTIVO',event.reason||'Motivo nao informado',right,350,w);}
 if(event.type==='PROMOTE'||event.type==='DEMOTE'){y=field(img,fLabel,'ALTERADO POR',displayActor(event),right,292,w);y=field(img,fLabel,'CARGO',event.type==='PROMOTE'?'MEMBRO -> ADMIN':'ADMIN -> MEMBRO',right,350,w);}
 if(event.type==='LEAVE'){y=field(img,fLabel,'SAIDA', 'Voluntaria',right,292,w);}
 field(img,fLabel,'HORARIO',dateLabel(event.occurredAt),right,event.type==='JOIN'?292:408,w);
 line(img,70,650,1140,style.accent,110);img.print(fSmall,70,662,'LUA DATABASE');img.print(fSmall,1060,662,`AUDIT ${shortAuditId(event.eventId)}`);
 return img.getBufferAsync(Jimp.MIME_PNG);
}
module.exports={renderAuditCard,ascii,fitText,wrapText,displayParticipant,displayActor,displayGroup,displayCommunity};
