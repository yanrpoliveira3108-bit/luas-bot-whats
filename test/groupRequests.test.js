'use strict';

const assert = require('assert');
const {
  listPending,
  approveRequests,
  rejectRequests,
} = require('../utils/groupRequests');

const group = '120363000000000000@g.us';
const a = { jid: '5511999990001@s.whatsapp.net' };
const b = { jid: '5511999990002@s.whatsapp.net' };
const c = { jid: '5511999990003@s.whatsapp.net' };

(async () => {
  let calls = [];
  const socket = {
    async groupRequestParticipantsList(jid) {
      calls.push(['list', jid]);
      return [a, b, c];
    },
    async groupRequestParticipantsUpdate(jid, jids, action) {
      calls.push(['update', jid, jids, action]);
      return jids.map((jid) => ({ jid, status: '200' }));
    },
  };

  assert.deepStrictEqual(await listPending(socket, group), [a, b, c]);
  assert.deepStrictEqual(await approveRequests(socket, group, [a, b, c]), {
    requested: 3,
    success: 3,
    failed: 0,
    results: [
      { jid: a.jid, status: '200', ok: true },
      { jid: b.jid, status: '200', ok: true },
      { jid: c.jid, status: '200', ok: true },
    ],
  });
  assert.deepStrictEqual(calls[0], ['list', group]);
  assert.deepStrictEqual(calls[1], ['update', group, [a.jid, b.jid, c.jid], 'approve']);

  const oldShape = { async groupRequestParticipantsList() { return { participants: [a] }; } };
  assert.deepStrictEqual(await listPending(oldShape, group), [a]);

  const empty = { async groupRequestParticipantsList() { return []; } };
  assert.deepStrictEqual(await listPending(empty, group), []);

  for (const raw of [undefined, null, {}, { participants: 'nope' }]) {
    const bad = { async groupRequestParticipantsList() { return raw; } };
    await assert.rejects(() => listPending(bad, group), /Formato inesperado/);
  }

  const rejected = { async groupRequestParticipantsList() { throw new Error('network'); } };
  await assert.rejects(() => listPending(rejected, group), (err) => err.code === 'GROUP_REQUESTS_LIST_FAILED');

  const partial = {
    async groupRequestParticipantsUpdate() {
      return [{ jid: a.jid, status: '200' }, { jid: b.jid, status: '403' }];
    },
  };
  const partialResult = await rejectRequests(partial, group, [a, b, { jid: 'invalido' }]);
  assert.strictEqual(partialResult.requested, 2);
  assert.strictEqual(partialResult.success, 1);
  assert.strictEqual(partialResult.failed, 1);

  const failed = { async groupRequestParticipantsUpdate() { return [{ jid: a.jid, status: '500' }]; } };
  const failedResult = await approveRequests(failed, group, [a]);
  assert.strictEqual(failedResult.success, 0);
  assert.strictEqual(failedResult.failed, 1);

  const malformedUpdate = { async groupRequestParticipantsUpdate() { return { status: '200' }; } };
  await assert.rejects(() => approveRequests(malformedUpdate, group, [a]), /Formato inesperado/);

  console.log('✅ groupRequests: normalização, erros, validação e resultados parciais');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
