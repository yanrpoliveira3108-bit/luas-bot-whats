'use strict';

const assert = require('assert');
const greeting = require('../plugins/welcome/greetingEngine');

const context = greeting.buildGreetingContext({
  participantJid: '5519999994235@s.whatsapp.net',
  participantName: 'Karma',
  participantNumber: '5519999994235@s.whatsapp.net',
  groupJid: '120363000000000000@g.us',
  groupSubject: 'Lua Desenvolvimento',
  memberCount: 198,
  prefix: ',',
  occurredAt: new Date('2026-09-28T23:20:00-03:00'),
});

assert.equal(greeting.resolveGreetingTemplate('Olá {usuario}', context), 'Olá Karma');
assert.equal(
  greeting.resolveGreetingTemplate('{usuario} entrou em {grupo} às {hora}', context),
  'Karma entrou em Lua Desenvolvimento às 23:20'
);
assert.equal(greeting.resolveGreetingTemplate('{usuario} {usuario}', context), 'Karma Karma');
assert.equal(greeting.resolveGreetingTemplate('{banana}', context), '{banana}');
assert.equal(greeting.resolveGreetingTemplate('{nome} {numero} {membros} {prefix}', context), 'Karma +55 19 *****-4235 198 ,');
assert.equal(greeting.resolveGreetingTemplate('Olá\n{grupo}', context), 'Olá\nLua Desenvolvimento');

const original = `👑🔥 𝑩𝑬𝑴-𝑽𝑰𝑵𝑫𝑶𝑺 𝑨𝑶 𝑩𝑶𝑵𝑫𝑬 𝑫𝑨 𝒁𝑶𝑬𝑰𝑹𝑨! 🔥👑
😎 Chegou agora? Então se apresente pra galera:
👤 𝑵𝒐𝒎𝒆:
🎂 𝑰𝒅𝒂𝒅𝒆:
📍 𝑪𝒊𝒅𝒂𝒅𝒆:
📸 𝑭𝒐𝒕𝒐 𝒅𝒆 𝑽𝑰𝑺𝑼𝑨𝑳𝑰𝒁𝑨𝑪̧𝑨̃𝑶 𝑼́𝑵𝑰𝑪𝑨:
⚠️ 𝑺𝒊𝒈𝒂𝒎 𝒂𝒔 𝒓𝒆𝒈𝒓𝒂𝒔 𝒍𝒂́ 𝒆𝒎 𝒄𝒊𝒎𝒂!
🔥 𝑬 𝑽𝑨𝑴𝑶𝑺 𝑷𝑨𝑹𝑨 𝑨 𝑹𝑬𝑺𝑬𝑵𝑯𝑨! 😂👑`;
assert.strictEqual(greeting.validateTemplate(original).value, original);
assert.strictEqual(greeting.extractTemplateFromCommand(`,welcometext atualizar ${original}`, ',', 'welcometext'), original);
assert.strictEqual(greeting.extractTemplateFromCommand(`,goodbyetext atualizar ${original}`, ',', 'goodbyetext'), original);
assert.strictEqual(original.split('\n').length, 8);

const noIdentity = greeting.buildGreetingContext({ groupJid: '120@g.us', groupSubject: '', occurredAt: context.occurredAt });
assert.ok(!noIdentity.values.nome.includes('@'));
assert.ok(!noIdentity.values.numero.includes('@'));
assert.equal(greeting.validateTemplate('x'.repeat(greeting.MAX_TEMPLATE_LENGTH + 1)).ok, false);

console.log('greetingTemplate.test.js: ok');
