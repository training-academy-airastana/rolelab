import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:4173/api/sessions';
async function post(p, body) {
  const response = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, ...await response.json() };
}
const created = await post('', { title: 'Тестовая сессия интерфейса', roles: ['Тестовая роль A', 'Тестовая роль B'] });
assert.equal(created.status, 201);
const prefix = '/' + created.code;
const get = async () => (await fetch(base + prefix)).json();
const state = await get();
const p1 = await post(prefix + '/join', { name: 'Тест A' });
const p2 = await post(prefix + '/join', { name: 'Тест B' });
assert.equal(p1.status, 201); assert.equal(p2.status, 201);
assert.equal((await post(prefix + '/action', { token: created.token, action: 'open' })).status, 200);
const vote = { participantId: p1.id, participantToken: p1.token, roleId: state.currentRoleId, round: 1, scores: [5, 4, 4, 3, 4, 2] };
assert.equal((await post(prefix + '/vote', vote)).status, 200);
assert.equal((await post(prefix + '/vote', vote)).status, 400);
assert.equal((await post(prefix + '/vote', { ...vote, participantId: p2.id, participantToken: p2.token, scores: [1, 1, 1, 1, 1, 1] })).status, 200);
assert.deepEqual((await get()).results, {});
assert.equal((await post(prefix + '/action', { action: 'close', token: 'wrong-token' })).status, 403);
assert.equal((await post(prefix + '/action', { action: 'close', token: created.token })).status, 200);
const after = await get();
assert.equal(after.leaderboard[0].score, 2.5);
assert.equal(JSON.stringify(after).includes(created.token), false);
assert.equal(JSON.stringify(after).includes(p1.token), false);
assert.equal((await post(prefix + '/action', { action: 'finish', token: created.token })).status, 200);
assert.equal((await get()).finished, true);
console.log('PASS: create session, two participants, voting, duplicate protection, hidden results, host authorization, weighted mean 2.5, finish.');
