import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { invitationUrl, siteUrl } from '../public/site-paths.mjs';
import { createSupabaseApi, validateSupabaseConfig } from '../public/supabase-api.mjs';

test('GitHub Pages invitations preserve the repository prefix and exclude host tokens', () => {
  const url = invitationUrl('https://example.github.io/rolelab/?s=123456&tab=ranking', '123456', 'invite-only');
  assert.equal(url, 'https://example.github.io/rolelab/?s=123456&key=invite-only&view=participant');
  assert.equal(invitationUrl('http://localhost:4173/', 'demo'), 'http://localhost:4173/?view=participant');
  assert.equal(siteUrl('https://example.github.io/rolelab/?s=123456&key=private-key&view=host#results'), 'https://example.github.io/rolelab/');
});
test('browser config accepts publishable keys and rejects privileged keys', () => {
  assert.equal(validateSupabaseConfig('', ''), false);
  assert.equal(validateSupabaseConfig('https://test.supabase.co', 'sb_publishable_example'), true);
  for (const key of ['sb_secret_example', 'not-a-public-key']) assert.throws(() => validateSupabaseConfig('https://test.supabase.co', key));
  assert.throws(() => validateSupabaseConfig('http://test.supabase.co', 'sb_publishable_example'));
  assert.throws(() => validateSupabaseConfig('https://test.supabase.co', ''));
});
test('Supabase adapter sends membership and vote credentials to the right RPC only', async () => {
  const calls = [];
  const api = createSupabaseApi({ url: 'https://test.supabase.co', key: 'sb_publishable_example', getAccessToken: () => 'invitation-key', fetchImpl: async (url, init) => { calls.push({ url, ...init, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ ok: true }) }; } });
  await api('sessions/123456');
  await api('sessions/123456/action', { token: 'host-only', action: 'close' });
  await api('sessions/123456/vote', { participantId: 'participant', participantToken: 'personal-key', roleId: 'role', round: 1, scores: [1,2,3,4,5,1] });
  await api('current', { name: 'Участник', participantToken: 'personal-current-key' });
  assert.equal(calls[0].body.p_access_token, 'invitation-key');
  assert.equal(calls[1].body.p_host_token, 'host-only');
  assert.equal(calls[2].body.p_participant_token, 'personal-key');
  assert.equal(calls[0].headers.apikey, 'sb_publishable_example');
  assert.equal(JSON.stringify(calls[0]).includes('host-only'), false);
  assert.equal(calls[3].url.endsWith('/rolelab_enter_current'), true);
  assert.deepEqual(calls[3].body, { p_name: 'Участник', p_participant_token: 'personal-current-key' });
});

test('current meeting admits and resumes participants without exposing host access', async () => {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated;');
  for (const file of ['202611240001_rolelab.sql','202611240002_current_meeting.sql']) {
    await db.exec(await readFile(new URL('../supabase/migrations/'+file, import.meta.url), 'utf8'));
  }
  const rpc=async(name,args)=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args)).rows[0].value;
  const token='personal-current-token-12345678901234567890';
  const enter=(name='Участник',key=token)=>rpc('rolelab_enter_current',[name,key]);
  try {
    assert.deepEqual(await enter(),{active:false});
    const first=await rpc('rolelab_create',['Первая встреча',['Роль']]);
    await db.exec('set role anon');
    const person=await enter();
    assert.equal(person.code,first.code);
    assert.equal(person.active,true);
    assert.equal((await enter()).id,person.id);
    assert.equal(JSON.stringify(person).includes(first.token),false);
    assert.equal(JSON.stringify(person).includes(first.inviteToken),false);
    const state=await rpc('rolelab_snapshot',[person.code,person.token]);
    assert.equal(state.participants.length,1);
    assert.deepEqual(state.results,{});
    await assert.rejects(()=>rpc('rolelab_action',[person.code,person.token,'open',null]),/ведущему/);
    await assert.rejects(()=>enter('Другое имя'),/Смените имя/);
    await assert.rejects(()=>enter(''),/Введите имя/);
    await assert.rejects(()=>enter('Участник','short'),/Обновите страницу/);
    await assert.rejects(()=>db.query('select * from rolelab_private.current_meeting'),/permission denied/);
    const second=await rpc('rolelab_create',['Вторая встреча',['Роль']]);
    assert.equal((await enter()).code,second.code);
    await rpc('rolelab_action',[first.code,first.token,'finish',null]);
    assert.equal((await enter()).code,second.code);
    await rpc('rolelab_action',[second.code,second.token,'open',null]);
    const secondPerson=await enter();
    const secondState=await rpc('rolelab_snapshot',[second.code,secondPerson.token]);
    await rpc('rolelab_vote',[second.code,secondPerson.id,secondPerson.token,secondState.currentRoleId,1,[5,4,3,2,1,5]]);
    await rpc('rolelab_action',[second.code,second.token,'close',null]);
    await rpc('rolelab_action',[second.code,second.token,'finish',null]);
    assert.deepEqual(await enter(),{active:false});
    assert.equal((await rpc('rolelab_snapshot',[second.code,secondPerson.token])).leaderboard.length,1);
    const third=await rpc('rolelab_create',['Третья встреча',['Роль']]);
    assert.equal((await enter()).code,third.code);
    await db.exec('reset role');
    await db.query("insert into rolelab_private.participants(session_code,name,token_hash) select $1,'Заполнение',n::text from generate_series(1,199) n",[third.code]);
    await db.exec('set role anon');
    assert.equal((await enter()).code,third.code);
    await assert.rejects(()=>enter('Новый','other-person-token-12345678901234567890'),/200 участников/);
  } finally { await db.close(); }
});

test('PostgreSQL migration enforces session ownership, complete ballots and private aggregates', async () => {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated;');
  await db.exec(await readFile(new URL('../supabase/migrations/202611240001_rolelab.sql', import.meta.url), 'utf8'));
  const rpc = async (name, args) => {
    const placeholders = args.map((_,i) => '$'+(i+1)).join(',');
    return (await db.query(`select public.${name}(${placeholders}) as value`, args)).rows[0].value;
  };
  try {
    const created = await rpc('rolelab_create', ['Тест', ['Роль A', 'Роль B', 'Без ответов']]);
    const get = () => rpc('rolelab_snapshot', [created.code, created.inviteToken]);
    assert.equal(created.token.length, 64);
    assert.notEqual(created.token, created.inviteToken);
    await assert.rejects(() => rpc('rolelab_snapshot', [created.code, 'wrong-key']), /не найдена|неполная/);
    const role = (await get()).currentRoleId;
    const p1 = await rpc('rolelab_join', [created.code, created.inviteToken, 'Первый']);
    const p2 = await rpc('rolelab_join', [created.code, created.inviteToken, 'Второй']);
    const act = (action, id=null, token=created.token) => rpc('rolelab_action', [created.code, token, action, id]);
    const vote = (person, scores=[5,4,4,3,4,2], id=role, round=1) => rpc('rolelab_vote', [created.code, person.id, person.token, id, round, scores]);
    await assert.rejects(() => act('open', null, created.inviteToken), /ведущему/);
    await act('open');
    await assert.rejects(() => vote(p1,[1,2]), /шести/);
    await assert.rejects(() => vote(p1,[1,1,1,1,1,6]), /шести/);
    await assert.rejects(() => vote(p1,[1,1,1,1,1,null]), /шести/);
    await assert.rejects(() => vote(p1,undefined,role,2), /изменилось/);
    await assert.rejects(() => vote({...p1,token:p2.token}), /Войдите/);
    await vote(p1);
    await assert.rejects(() => vote(p1), /уже приняты/);
    await vote(p2,[1,1,1,1,1,1]);
    const open = await get();
    assert.deepEqual(open.results,{});
    assert.equal(open.currentCount,2);
    const next = open.roles[1].id;
    await assert.rejects(() => act('select',next), /Сначала/);
    await assert.rejects(() => act('finish'), /Сначала/);
    await act('close');
    await assert.rejects(() => vote(p2), /закрыто/);
    const closed = await get();
    assert.equal(closed.results[role].score,2.5);
    assert.deepEqual(closed.results[role].averages,[3,2.5,2.5,2,2.5,1.5]);
    for (const token of [created.token,created.inviteToken,p1.token,p2.token]) assert.equal(JSON.stringify(closed).includes(token),false);
    await act('select',next); await act('open'); await vote(p1,[5,5,5,5,5,5],next); await act('close');
    const third = (await get()).roles[2].id;
    await act('select',third); await act('open'); await act('close');
    assert.deepEqual((await get()).leaderboard.map(r=>r.score),[5,2.5]);
    await act('finish');
    await assert.rejects(() => rpc('rolelab_join',[created.code,created.inviteToken,'Поздний']),/завершена/);
    const other = await rpc('rolelab_create',['Другая сессия',['Чужая роль']]);
    await assert.rejects(() => rpc('rolelab_snapshot',[other.code,p1.token]));
    await db.exec('set role anon');
    await assert.rejects(() => db.query('select * from rolelab_private.votes'),/permission denied/);
    const anonymous = await get();
    assert.equal(anonymous.finished,true);
    await assert.rejects(() => rpc('rolelab_snapshot',[created.code,other.inviteToken]));
  } finally { await db.close(); }
});
