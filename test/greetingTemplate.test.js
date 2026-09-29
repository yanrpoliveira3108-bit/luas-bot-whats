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

const noIdentity = greeting.buildGreetingContext({ groupJid: '120@g.us', groupSubject: '', occurredAt: context.occurredAt });
assert.ok(!noIdentity.values.nome.includes('@'));
assert.ok(!noIdentity.values.numero.includes('@'));
assert.ok(greeting.validateTemplate('x'.repeat(greeting.MAX_TEMPLATE_LENGTH + 1)).ok === false);

console.log('greetingTemplate.test.js: ok');
