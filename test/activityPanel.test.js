'use strict';

const assert = require('assert');
const { renderPanel } = require('../utils/activity');
const { width } = require('../utils/terminal');

for (const data of [
  { isGroup: true, chat: '120@g.us', chatName: 'grupo com nome muito grande', sender: '5511999999999@s.whatsapp.net', input: ',ia status' },
  { isGroup: false, chat: '5511999999999@s.whatsapp.net', sender: '5511999999999@s.whatsapp.net', input: 'lua, quem é você? 😀 ação' },
  { isGroup: true, chat: '123456@lid', chatName: 'grupo', sender: '123456@lid', input: `lua ${'mensagem longa '.repeat(100)} gsk_secret` },
]) {
  const panel = renderPanel({ ...data, time: Date.now() });
  const lines = panel.split('\n');
  assert.ok(lines[0].startsWith('╔') && lines.at(-1).startsWith('╚'));
  assert.ok(lines.every((line) => width(line) === width(lines[0])), 'bordas alinhadas');
  assert.ok(!panel.includes('gsk_secret'), 'segredo não aparece');
  if (data.input.includes('gsk_')) assert.ok(panel.includes('[REDACTED]'));
}
console.log('activityPanel.test.js: OK');
