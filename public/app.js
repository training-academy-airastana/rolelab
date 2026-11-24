import { CRITERIA, publicSnapshot, submitVote, transition } from './domain.mjs';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.mjs';
import { createSupabaseApi, validateSupabaseConfig } from './supabase-api.mjs';
import { invitationUrl } from './site-paths.mjs';

const $ = selector => document.querySelector(selector);
const icons = {
  chart: '<path d="M4 19V11m8 8V5m8 14V9"/>',
  shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z"/>',
  monitor: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8m-4-5v5"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  play: '<path d="m8 4 12 8-12 8V4Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  trophy: '<path d="M8 3h8v6a4 4 0 0 1-8 0V3Zm0 2H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 2v6m-4 2h8"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  link: '<path d="m10 13 4-4m-6 6-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 2 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0)"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a19 19 0 0 1 0 18 19 19 0 0 1 0-18Z"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.chart}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = value => value == null ? '—' : value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const newId = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), n=>n.toString(16).padStart(2,'0')).join('');
const peopleLabel = count => `${count} ${{one:'участник',few:'участника',many:'участников',other:'участника'}[new Intl.PluralRules('ru').select(count)]}`;
const params = new URLSearchParams(location.search);
let view = params.get('view') || 'host';
let tab = params.get('tab') || 'session';
let code = params.get('s') || 'demo';
let linkAccessKey = params.get('key') || '';
let cloudApi = null;
let snapshot;
let backend = false;
let disconnected = false;
let busy = false;
let voteDraft = {};
let lastSignature = '';
let pollTimer;
let toastTimer;
const DEMO_KEY = 'rolelab-demo-v1';
function readLocal(key, fallback = null) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function writeLocal(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast('Браузер не разрешил сохранить данные.'); } }
function demoInitial() {
  const names = ['Директор по лётной эксплуатации', 'Руководитель инженерной службы', 'Руководитель службы безопасности', 'Директор по управлению сетью', 'Финансовый директор'];
  return { code: 'demo', title: 'Калибровка бизнес-ролей', roles: names.map((name,i) => ({ id: `r${i+1}`, name, status: 'pending', round: 1 })), currentRoleId: 'r1', participants: [], votes: [], finished: false };
}
function demoGet() { return readLocal(DEMO_KEY) || demoInitial(); }
function demoSet(state) { writeLocal(DEMO_KEY, state); snapshot = publicSnapshot(state); lastSignature = JSON.stringify(snapshot); }
function identity() { return readLocal(`rolelab-person-${code}`); }
function hostToken() { return readLocal(`rolelab-host-${code}`); }
function inviteToken() { return readLocal(`rolelab-invite-${code}`) || linkAccessKey; }
function accessToken() { return hostToken() || identity()?.token || inviteToken() || ''; }
function isHost() { return code === 'demo' || !!hostToken(); }
function currentRole() { return snapshot?.roles.find(r => r.id === snapshot.currentRoleId); }
function route(nextView, nextTab = 'session') {
  view = nextView; tab = nextTab;
  const url = new URL(location.href); url.search = ''; if (code !== 'demo') url.searchParams.set('s', code);
  if (linkAccessKey && code !== 'demo') url.searchParams.set('key', linkAccessKey);
  if (view !== 'host') url.searchParams.set('view', view);
  if (tab !== 'session') url.searchParams.set('tab', tab);
  history.pushState({}, '', url); render();
}
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 4500); }
async function api(path, data) {
  if (cloudApi) return cloudApi(path, data);
  const response = await fetch(new URL(`./api/${path}`, location.href), { method: data ? 'POST' : 'GET', headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(10000) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Не удалось выполнить запрос.'); return result;
}
async function refresh(force = false) {
  try {
    const next = code === 'demo' ? publicSnapshot(demoGet()) : await api(`sessions/${encodeURIComponent(code)}`);
    const signature = JSON.stringify(next);
    if (force || signature !== lastSignature || disconnected) { snapshot = next; lastSignature = signature; disconnected = false; render(); }
  } catch (error) { if (!disconnected || !snapshot) { disconnected = true; renderError(error.message); } }
}
function renderError(message) {
  if (!snapshot) $('#app').innerHTML = `${header()}<main class="container page"><div class="empty">${icon('globe')}<h1>Не удалось открыть сессию</h1><p>${esc(message)}</p><button class="btn btn-primary" data-action="retry">Попробовать снова</button><a class="btn" href="./">На главную</a></div></main>`;
  else { render(); const errorEl = $('#connection-error'); if (errorEl) errorEl.textContent = 'Связь прервана. Восстанавливаем подключение; отправка временно недоступна.'; }
}
function header() {
  return `<header class="topbar"><div class="container topbar-inner"><a class="brand" href="./" aria-label="Rolelab, главная"><span class="brand-mark">${icon('chart')}</span>Rolelab<span class="brand-sub">Совместная оценка критичности ролей</span></a><div class="header-actions">${code === 'demo' ? '<span class="badge">Демо-интерфейс</span>' : `<span class="badge ${disconnected ? 'badge-amber' : 'badge-green'}">${disconnected ? 'Переподключение' : 'Подключено'}</span>`}${view === 'host' ? `<button class="btn" data-action="present" aria-label="Открыть общий экран">${icon('monitor')}<span>Общий экран</span></button><button class="btn" data-action="invite" aria-label="Пригласить участников">${icon('link')}<span>Пригласить</span></button>` : `<button class="btn btn-link" data-action="${isHost() ? 'host-view' : 'invite'}">${icon(isHost() ? 'settings' : 'link')}<span>${isHost() ? 'Ведущий' : 'Пригласить'}</span></button>`}</div></div></header>`;
}
function demoNote() { return code === 'demo' ? `<div class="demo-note"><span><strong>Режим знакомства.</strong> Роли приведены для примера. <button class="btn btn-link" data-action="reset-demo">Сбросить демо</button></span><button class="btn" data-action="create">Создать сессию ${icon('plus')}</button></div>` : ''; }
function viewSwitcher() {
  return `<div class="view-switch" aria-label="Вид интерфейса">${[['host','settings','Ведущий'],['participant','phone','Участник'],['present','monitor','Общий экран']].map(([v,ic,title])=>`<button type="button" class="${view === v ? 'active' : ''}" data-view="${v}" aria-pressed="${view === v}">${icon(ic)}${title}</button>`).join('')}</div>`;
}
function statusBadge(role) {
  if (snapshot.finished) return '<span class="badge badge-green">Сессия завершена</span>';
  if (role?.status === 'open') return `<span class="badge badge-blue">${icon('activity')}Голосование открыто</span>`;
  if (role?.status === 'closed') return `<span class="badge badge-green">${icon('check')}Оценивание завершено</span>`;
  return '<span class="badge">Ожидает старта</span>';
}
function progress(value, total) { return `<div class="progress" role="progressbar" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="${Math.max(1,total)}" aria-label="Получено ответов"><span class="progress-fill" style="--progress:${total ? value/total : 0}"></span></div>`; }
function hostPage() {
  const done = snapshot.roles.filter(r=>r.status === 'closed').length;
  return `${header()}<main class="container page">${demoNote()}${disconnected ? '<div id="connection-error" class="live-error" role="alert">Восстанавливаем подключение…</div>' : ''}<div class="page-heading"><div><h1>${esc(snapshot.title)}</h1><p>Шесть критериев. Независимые оценки. Общая картина.</p></div><div class="session-meta"><div><span class="small muted">Код сессии&nbsp; </span><span class="code">${code === 'demo' ? 'ДЕМО' : esc(code)}</span></div><span class="divider"></span><span class="row small muted">${icon('users')}${peopleLabel(snapshot.participants.length)}</span></div></div><div class="tabbar"><nav class="tabs" aria-label="Разделы сессии">${[['session','list','Сессия'],['ranking','trophy','Рейтинг ролей'],['criteria','settings','Критерии']].map(([t,ic,label])=>`<a href="?${new URLSearchParams({...(code!=='demo'?{s:code}:{}),tab:t})}" class="tab ${tab===t?'active':''}" data-tab="${t}" ${tab===t?'aria-current="page"':''}>${icon(ic)}${label}${t==='ranking'?`<span class="tab-count">${snapshot.leaderboard.length}</span>`:''}</a>`).join('')}</nav><span class="small muted">${done} из ${snapshot.roles.length} ролей оценено</span></div>${tab==='ranking'?leaderboard():tab==='criteria'?criteriaPage():hostWorkspace()}<footer class="bottom-bar"><span class="row">${icon('lock')}Оценки скрыты до закрытия голосования</span>${viewSwitcher()}<button class="btn btn-link" data-action="finish" ${snapshot.finished?'disabled':''}>${icon('trophy')}Завершить сессию</button></footer></main>`;
}
function hostWorkspace() {
  const role = currentRole();
  const done = snapshot.roles.filter(r=>r.status==='closed').length;
  return `<div class="workspace"><aside class="role-nav" aria-label="Роли для оценки"><div class="section-label"><h2>Роли для оценки</h2><span class="badge">${snapshot.roles.length}</span></div><div class="role-list">${snapshot.roles.map((r,i)=>`<button type="button" class="role-item ${r.id===role?.id?'active':''}" data-role="${esc(r.id)}" ${snapshot.finished?'disabled':''} aria-pressed="${r.id===role?.id}"><span class="role-number">${r.status==='closed'?icon('check'):String(i+1).padStart(2,'0')}</span><span><strong>${esc(r.name)}</strong><small>${r.status==='open'?'Идёт голосование':r.status==='closed'?(snapshot.results[r.id]?.count?`${fmt(snapshot.results[r.id].score)} из 5`:'Нет ответов'):'Ещё не оценена'}</small></span></button>`).join('')}</div><button class="btn btn-link add-role" data-action="add-role" ${snapshot.finished?'disabled':''}>${icon('plus')}Добавить роль</button><div class="role-progress"><div class="row spread"><span>Прогресс сессии</span><span>${done}/${snapshot.roles.length}</span></div>${progress(done,snapshot.roles.length)}<p>Каждая роль оценивается по всем шести критериям.</p></div></aside><section class="evaluation" aria-label="Текущая роль"><div class="evaluation-head"><div class="row spread">${statusBadge(role)}<span class="small muted">Роль ${snapshot.roles.indexOf(role)+1} из ${snapshot.roles.length}</span></div><h2>${esc(role?.name || 'Добавьте первую роль')}</h2><p>${role?.status==='closed'?'Средние оценки участников по каждому критерию.':'Участники оценивают все критерии по шкале от 1 до 5.'}</p></div><div class="criterion-table-head"><span>Критерий оценки</span><span>${role?.status==='closed'?'Среднее / вес':'Вес'}</span></div><div class="criteria">${criterionRows(role)}</div>${role?.status==='closed' && snapshot.results[role.id]?.count?`<div class="score-summary"><div><strong>Итоговая оценка роли</strong><p class="small muted">С учётом весов шести критериев</p></div><span class="score-large">${fmt(snapshot.results[role.id].score)}</span></div>`:''}<div class="evaluation-foot">${icon('info')}Оценка поддерживает обсуждение и не заменяет профессиональное суждение.</div></section><aside class="session-rail">${controlBox()}${participants()}<div class="help-box"><h3>Один темп для всей встречи</h3><p>Только ведущий открывает голосование, показывает результаты и выбирает следующую роль.</p></div></aside></div>`;
}
function criterionRows(role, generic=false) {
  return CRITERIA.map((c,i)=>`<div class="criterion"><span class="criterion-icon">${icon(c.icon)}</span><div><h3>${esc(c.title)}</h3><p>${esc(c.description)}</p></div><div class="criterion-weight">${!generic && role?.status==='closed'?`<span class="result-average">${fmt(snapshot.results[role.id]?.averages[i])}</span><span class="small muted">${c.weight}%</span>`:`${c.weight}%`}</div></div>`).join('');
}
function controlBox() {
  const role=currentRole(); const count=snapshot.currentCount; const total=snapshot.participants.length;
  let action='open', label='Открыть голосование', ic='play', hint='Все шесть оценок отправляются вместе';
  if(role?.status==='open'){action='close';label='Закрыть и показать итог';ic='lock';hint='Результаты станут видны участникам';}
  if(role?.status==='closed'){action='next';label='Следующая роль';ic='arrow';hint='Голосование открывает ведущий';}
  if(snapshot.finished){action='ranking';label='Посмотреть рейтинг';ic='trophy';hint='Сессия завершена';}
  return `<section class="control-box"><h2>${role?.status==='closed'?'Оценивание завершено':'Ответы участников'}</h2><div class="answer-count"><strong>${count}</strong><span>/ ${total}</span></div><p>${total ? `${count===total?'Все участники ответили':'Получено ответов'}`:'Пригласите участников в сессию'}</p>${progress(count,total)}<button class="btn" data-action="${action}" ${disconnected || !role?'disabled':''}>${icon(ic)}${label}</button><div class="control-hint">${hint}</div></section>`;
}
function participants() {
  return `<section class="participants"><div class="row spread"><h2>Участники</h2><span class="small muted">${snapshot.participants.length}</span></div>${snapshot.participants.length?snapshot.participants.map(p=>`<div class="person"><span class="person-info"><span class="avatar">${esc(p.name.slice(0,2).toLocaleUpperCase('ru'))}</span><span class="person-name">${esc(p.name)}</span></span><span class="person-status ${p.voted?'done':''}">${p.voted?'Ответил':currentRole()?.status==='open'?'Оценивает':'Ожидает'}</span></div>`).join(''):'<p class="participant-empty">Здесь появятся участники, когда присоединятся по ссылке и введут своё имя.</p>'}<button class="invite-link" data-action="invite" aria-label="Пригласить участников">${icon('link')}Скопировать приглашение</button></section>`;
}
function leaderboard() {
  const rows=snapshot.leaderboard;
  return `<section><div class="results-intro"><div><h2>Самые бизнес-критичные роли</h2><p>Средние оценки участников с учётом весов критериев.</p></div><button class="btn" data-action="export" ${rows.length?'':'disabled'}>${icon('download')}Скачать CSV</button></div>${rows.length?`<table class="leader-table"><thead><tr><th>Место</th><th>Бизнес-роль</th><th class="votes-col">Ответов</th><th>Итог из 5</th></tr></thead><tbody>${rows.map((r,i)=>`<tr class="${i===0?'rank-first':''}"><td class="rank">${r.place}</td><td><strong>${esc(r.name)}</strong></td><td class="votes-col">${r.count}</td><td><div class="score-line"><span class="score">${fmt(r.score)} <small>/ 5</small></span>${progress(r.score,5)}</div></td></tr>`).join('')}</tbody></table>`:`<div class="empty">${icon('trophy')}<h2>Рейтинг появится после оценивания</h2><p>Закройте голосование хотя бы по одной роли с полученными ответами.</p><button class="btn" data-action="session-tab">Вернуться к сессии ${icon('arrow')}</button></div>`}<p class="small muted" style="margin-top:var(--space-lg)">Итог = среднее по каждому критерию × его вес, затем сумма. Роли без ответов в рейтинг не входят.</p></section>`;
}
function criteriaPage() {
  return `<section class="evaluation"><div class="evaluation-head"><h2>Шесть критериев критичности</h2><p>Веса взяты из вашей методики. В сумме 100%.</p></div><div class="criteria">${criterionRows(null,true)}</div><div class="evaluation-foot">${icon('info')}1 — низкое влияние, 5 — высокое влияние. Более подробные определения можно уточнить перед встречей.</div></section>`;
}
function participantPage() {
  const person=identity(); const role=currentRole();
  const known=person && snapshot.participants.some(p=>p.id===person.id);
  const voted=known && snapshot.participants.find(p=>p.id===person.id)?.voted;
  if(!known) return `${header()}<main class="mobile-page">${code==='demo'?'<span class="badge">Проверка мобильного интерфейса</span>':''}<h1>Ваше мнение имеет вес.</h1><p class="muted" style="margin-top:var(--space-sm)">Присоединитесь к оценке бизнес-ролей.</p><form id="join-form" class="join-form"><label class="form-group">Ваше имя<input name="name" autocomplete="given-name" maxlength="60" required placeholder="Как к вам обращаться"></label><p class="form-hint">Имя увидит ведущий. Оценки показываются в общей статистике.</p><p class="form-error" id="form-error" role="alert"></p><button class="btn btn-primary btn-wide" type="submit">Присоединиться ${icon('arrow')}</button></form>${code==='demo'?`<div style="margin-top:var(--space-xl)">${viewSwitcher()}</div>`:''}</main>`;
  if(snapshot.finished) return `${header()}<main class="mobile-page"><span class="badge badge-green">Сессия завершена</span><h1>Спасибо за ваши оценки.</h1>${leaderboard()}${code==='demo'?viewSwitcher():''}</main>`;
  if(role?.status==='closed') return `${header()}<main class="mobile-page"><div class="row spread"><span class="small muted">${esc(person.name)}</span>${statusBadge(role)}</div><div class="evaluation"><div class="evaluation-head"><h2>${esc(role.name)}</h2><p>Результат совместной оценки</p></div>${snapshot.results[role.id]?.count?`<div class="score-summary"><span>Итог из 5</span><strong class="score-large">${fmt(snapshot.results[role.id].score)}</strong></div><div class="criteria">${CRITERIA.map((c,i)=>`<div class="criterion-result"><span>${esc(c.title)}</span><strong>${fmt(snapshot.results[role.id].averages[i])}</strong></div>`).join('')}</div>`:'<div class="empty"><p>По этой роли нет ответов.</p></div>'}</div><p class="small muted" style="margin-top:var(--space-lg);text-align:center">Ведущий выберет следующую роль. Страница обновится автоматически.</p>${code==='demo'?`<div style="margin-top:var(--space-xl)">${viewSwitcher()}</div>`:''}</main>`;
  if(voted || role?.status!=='open') return `${header()}<main class="mobile-page"><span class="small muted">${esc(person.name)}</span><div class="wait-block"><div class="success-icon">${icon(voted?'check':'clock')}</div><h2>${voted?'Ваши оценки приняты':'Вы в сессии'}</h2><p>${voted?'Спасибо! Ждём остальных участников.':'Ведущий скоро откроет голосование.'}</p><p style="margin-top:var(--space-lg)"><strong>${esc(role?.name||'')}</strong></p><p style="margin-top:var(--space-sm)">${snapshot.currentCount} из ${snapshot.participants.length} участников ответили</p></div><p class="small muted" style="text-align:center">Страница обновится автоматически.</p>${code==='demo'?`<div style="margin-top:var(--space-xl)">${viewSwitcher()}</div>`:''}</main>`;
  const key=`${code}-${role.id}-${role.round}`; const scores=voteDraft[key]||[];
  return `${header()}<main class="mobile-page">${disconnected?'<div id="connection-error" class="live-error" role="alert">Восстанавливаем подключение…</div>':''}<div class="row spread"><span class="small muted">${esc(person.name)}</span><span class="badge badge-blue">Голосование открыто</span></div><form id="vote-form" data-key="${esc(key)}"><section class="evaluation"><div class="evaluation-head"><span class="small muted">Оценка бизнес-критичности</span><h2>${esc(role.name)}</h2><p>Оцените каждый критерий от 1 до 5.</p></div><div class="criteria">${CRITERIA.map((c,i)=>`<div class="criterion" role="group" aria-labelledby="criterion-${i}"><div><h3 id="criterion-${i}">${esc(c.title)}</h3><p>${esc(c.description)}</p></div><span class="criterion-weight">${c.weight}%</span><div class="score-options">${[1,2,3,4,5].map(n=>`<label><input type="radio" name="score${i}" value="${n}" ${scores[i]===n?'checked':''} required aria-label="${n} из 5: ${esc(c.title)}"><span>${n}</span></label>`).join('')}</div><div class="scale-labels"><span>Низкое влияние</span><span>Высокое влияние</span></div></div>`).join('')}</div></section><div class="submit-area"><p class="form-error" id="form-error" role="alert"></p><button class="btn btn-primary btn-wide" type="submit" ${disconnected?'disabled':''}>Отправить все оценки ${icon('arrow')}</button><p>После отправки ждём остальных и действий ведущего.</p></div></form>${code==='demo'?`<div style="margin-top:var(--space-xl)">${viewSwitcher()}</div>`:''}</main>`;
}
function presentPage() {
  const role=currentRole();
  return `${header()}<main class="present-page">${code==='demo'?'<span class="badge">Демонстрация общего экрана</span>':''}${snapshot.finished?leaderboard():`<div class="present-role">${statusBadge(role)}<h1 style="margin-top:var(--space-lg)">${esc(role?.name||'Ожидаем начала сессии')}</h1></div><div class="present-grid"><section><div class="criteria">${criterionRows(role)}</div></section><aside><div class="present-count">${snapshot.currentCount}<small> / ${snapshot.participants.length}</small></div><p class="muted">участников отправили оценки</p>${progress(snapshot.currentCount,snapshot.participants.length)}${role?.status==='closed'&&snapshot.results[role.id]?.count?`<div style="margin-top:var(--space-xl)"><span class="small muted">Итог роли из 5</span><p class="score-large">${fmt(snapshot.results[role.id].score)}</p></div>`:''}<div class="present-invite"><p class="small muted">Присоединяйтесь с телефона</p><strong>${code==='demo'?'ДЕМО':esc(code)}</strong><p class="join-url">${esc(joinUrl())}</p></div></aside></div>`}<footer class="bottom-bar"><span>Калибровка бизнес-ролей</span>${code==='demo'||isHost()?viewSwitcher():''}</footer></main>`;
}
function render() {
  if(!snapshot) return;
  if(!isHost()&&view==='host') view='participant';
  // Keep the voting form intact when other participants send their answers.
  const focused=document.activeElement; const focusName=focused?.getAttribute('name'); const selection=focused?.selectionStart; const inputValue=focused?.value;
  $('#app').innerHTML=view==='participant'?participantPage():view==='present'?presentPage():hostPage();
  if(focusName){ const next=document.getElementsByName(focusName)[0]; if(next && next.type!=='radio'){if(inputValue!==undefined)next.value=inputValue;next.focus({preventScroll:true});if(typeof selection==='number')try{next.setSelectionRange(selection,selection);}catch{}} }
}
function joinUrl() { return invitationUrl(location.href, code, inviteToken()); }
function showDialog(content) { const dialog=$('#dialog'); dialog.innerHTML=content; if(!dialog.open)dialog.showModal(); }
function dialogHeader(title) { return `<div class="dialog-title"><h2>${title}</h2><button class="btn btn-link icon-btn" data-action="close-dialog" aria-label="Закрыть">${icon('close')}</button></div>`; }
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Ссылка скопирована'); } catch { showDialog(`${dialogHeader('Ссылка для участников')}<p>Скопируйте ссылку и отправьте участникам.</p><div class="copy-field">${esc(text)}</div>`); } }
async function act(action,roleId) {
  if(busy)return;
  busy=true;
  try {
    if(code==='demo'){const state=demoGet();transition(state,{action,roleId});demoSet(state);}
    else {await api(`sessions/${code}/action`,{token:hostToken(),action,roleId});await refresh(true);}
    render();
  } catch(error){toast(error.message);} finally{busy=false;}
}
function createDialog() {
  if(!backend) return showDialog(`${dialogHeader('Онлайн-просмотр интерфейса')}<p>Здесь можно проверить экраны ведущего, участника и рейтинг. Голоса демонстрации сохраняются только в этом браузере.</p><p>Для совместной встречи нужно подключить базу сессий. После подключения участники смогут оценивать роли с разных телефонов.</p><div class="actions"><button class="btn btn-primary" data-action="close-dialog">Продолжить просмотр</button></div>`);
  showDialog(`${dialogHeader('Новая сессия')}<p>Добавьте ваши роли. Участники смогут подключиться по отдельной ссылке.</p><form id="create-form"><label class="form-group">Название встречи<input name="title" value="Калибровка бизнес-ролей" maxlength="100" required></label><label class="form-group">Бизнес-роли<textarea name="roles" placeholder="По одной роли на строку" required maxlength="20000"></textarea><span class="form-hint">До 100 ролей. Список можно дополнить во время встречи.</span></label><p class="form-error" id="dialog-error" role="alert"></p><div class="actions"><button class="btn" type="button" data-action="close-dialog">Отмена</button><button class="btn btn-primary" type="submit">Создать сессию</button></div></form>`);
}
function exportResults() {
  const cell=value=>`"${String(value??'').replace(/"/g,'""')}"`;
  const rows=[['Место','Роль','Итог из 5','Ответов',...CRITERIA.map(c=>`${c.title} (${c.weight}%)`)],...snapshot.leaderboard.map(r=>[r.place, /^[=+@-]/.test(r.name)?`'${r.name}`:r.name,fmt(r.score),r.count,...r.averages.map(fmt)])];
  const blob=new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`rolelab-${code}-results.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-action],[data-view],[data-tab],[data-role]');if(!el)return;
  if(el.dataset.view){route(el.dataset.view);return;}
  if(el.dataset.tab){event.preventDefault();route('host',el.dataset.tab);return;}
  if(el.dataset.role){await act('select',el.dataset.role);return;}
  const action=el.dataset.action;
  if(action==='close-dialog')$('#dialog').close();
  else if(action==='create')createDialog();
  else if(action==='reset-demo')showDialog(`${dialogHeader('Начать демонстрацию заново?')}<p>Примеры оценок и участников будут очищены только в этом браузере.</p><div class="actions"><button class="btn" data-action="close-dialog">Отмена</button><button class="btn btn-primary" data-action="confirm-reset">Начать заново</button></div>`);
  else if(action==='confirm-reset'){demoSet(demoInitial());try{localStorage.removeItem('rolelab-person-demo');}catch{}voteDraft={};$('#dialog').close();route('host');}
  else if(action==='retry')refresh(true);
  else if(action==='host-view')route('host');
  else if(action==='session-tab')route('host','session');
  else if(action==='ranking')route('host','ranking');
  else if(action==='present'){const url=new URL(location.href);url.searchParams.set('view','present');url.searchParams.delete('tab');window.open(url.href,'rolelab-present','noopener');}
  else if(action==='invite')await copy(joinUrl());
  else if(action==='export')exportResults();
  else if(action==='open'||action==='close')await act(action);
  else if(action==='next'){const next=snapshot.roles.find(r=>r.status==='pending');if(next)await act('select',next.id);else route('host','ranking');}
  else if(action==='finish')showDialog(`${dialogHeader('Завершить сессию?')}<p>После завершения участники увидят итоговый рейтинг. Новые оценки больше не принимаются. Неоценённые роли останутся без итогового балла.</p><div class="actions"><button class="btn" data-action="close-dialog">Продолжить встречу</button><button class="btn btn-primary" data-action="confirm-finish">Завершить и показать рейтинг</button></div>`);
  else if(action==='confirm-finish'){await act('finish');if(snapshot.finished){$('#dialog').close();route('host','ranking');}}
  else if(action==='add-role')showDialog(`${dialogHeader('Добавить бизнес-роль')}<form id="add-role-form"><label class="form-group">Название роли<input name="role" maxlength="150" required placeholder="Введите название роли"></label><p class="form-error" id="dialog-error" role="alert"></p><div class="actions"><button class="btn btn-primary" type="submit">Добавить роль</button></div></form>`);
});
document.addEventListener('change',event=>{if(event.target.closest('#vote-form')){const form=$('#vote-form');voteDraft[form.dataset.key]=CRITERIA.map((_,i)=>Number(new FormData(form).get(`score${i}`))||null);}});
document.addEventListener('submit',async event=>{
  const form=event.target;if(!['create-form','join-form','vote-form','add-role-form'].includes(form.id))return;event.preventDefault();if(busy)return;
  const button=form.querySelector('[type="submit"]');const originalLabel=button.innerHTML;button.disabled=true;button.textContent='Сохраняем…';busy=true;
  try {
    const data=new FormData(form);
    if(form.id==='create-form'){
      const result=await api('sessions',{title:data.get('title'),roles:String(data.get('roles')).split(/\r?\n/).map(s=>s.trim()).filter(Boolean)});
      code=result.code;linkAccessKey='';writeLocal(`rolelab-host-${code}`,result.token);if(result.inviteToken)writeLocal(`rolelab-invite-${code}`,result.inviteToken);$('#dialog').close();snapshot=null;lastSignature='';route('host');await refresh(true);
    } else if(form.id==='join-form'){
      const name=String(data.get('name')).trim();if(!name)throw new Error('Введите ваше имя.');
      let person;
      if(code==='demo'){const state=demoGet();person={id:newId(),token:newId(),name};state.participants.push(person);demoSet(state);}
      else person=await api(`sessions/${code}/join`,{name});
      writeLocal(`rolelab-person-${code}`,person);await refresh(true);
    } else if(form.id==='vote-form'){
      const role=currentRole();const person=identity();const scores=CRITERIA.map((_,i)=>Number(data.get(`score${i}`)));const vote={participantId:person.id,participantToken:person.token,roleId:role.id,round:role.round,scores};
      if(code==='demo'){const state=demoGet();submitVote(state,vote);demoSet(state);}else await api(`sessions/${code}/vote`,vote);
      delete voteDraft[form.dataset.key];await refresh(true);
    } else if(form.id==='add-role-form'){
      const name=String(data.get('role')).trim();if(!name)throw new Error('Введите название роли.');
      if(code==='demo'){const state=demoGet();if(state.finished)throw new Error('Сессия завершена.');state.roles.push({id:newId(),name,status:'pending',round:1});demoSet(state);}else await api(`sessions/${code}/roles`,{token:hostToken(),name});
      $('#dialog').close();await refresh(true);
    }
    render();
  }catch(error){const target=form.querySelector('.form-error');if(target)target.textContent=error.message;else toast(error.message);}
  finally{busy=false;if(button.isConnected){button.disabled=false;button.innerHTML=originalLabel;}}
});
window.addEventListener('storage',event=>{if(event.key===DEMO_KEY&&code==='demo')refresh();});
window.addEventListener('popstate',()=>{const query=new URLSearchParams(location.search);view=query.get('view')||'host';tab=query.get('tab')||'session';code=query.get('s')||'demo';linkAccessKey=query.get('key')||'';snapshot=null;lastSignature='';refresh(true);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
async function init(){
  try {
    if (validateSupabaseConfig(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)) {
      cloudApi=createSupabaseApi({url:SUPABASE_URL,key:SUPABASE_PUBLISHABLE_KEY,getAccessToken:accessToken});
      backend=true;
    } else if (['localhost','127.0.0.1','[::1]'].includes(location.hostname)) {
      try{const response=await fetch(new URL('./api/config',location.href),{signal:AbortSignal.timeout(3000)});if(response.ok){const config=await response.json();backend=config.live===true;}}catch{}
    }
  } catch(error) { renderError(error.message);return; }
  if(!['host','participant','present'].includes(view))view='host';
  if(!['session','ranking','criteria'].includes(tab))tab='session';
  await refresh(true);pollTimer=setInterval(()=>{if(!document.hidden&&!busy)refresh();},1500);
}
init();
