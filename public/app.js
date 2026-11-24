import { CRITERIA, publicSnapshot, submitVote, transition } from './domain.mjs';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.mjs';
import { createSupabaseApi, validateSupabaseConfig } from './supabase-api.mjs';
import { siteUrl } from './site-paths.mjs';
import { qrSvg } from './qr.mjs';
import { errorMessage } from './error-messages.mjs';
import { entryProfile, isAdministrator, waitsForInvitation } from './entry.mjs';

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
  qr: '<path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM21 15v6h-6m2-10v2m-6 2h2m-2 4v2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a19 19 0 0 1 0 18 19 19 0 0 1 0-18Z"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.chart}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = value => value == null ? '—' : value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Meetings created before the English interface retain the old default title.
const workshopTitle = value => value?.trim() === 'Калибровка бизнес-ролей' ? 'Business-Critical Roles Workshop' : value;
const newId = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), n=>n.toString(16).padStart(2,'0')).join('');
const peopleLabel = count => `${count} participant${count === 1 ? '' : 's'}`;
const params = new URLSearchParams(location.search);
const ENTRY_KEY = 'rolelab-entry-v1';
const AUTO_PERSON_KEY = 'rolelab-current-person-v1';
const LAST_HOST_KEY = 'rolelab-last-host-v1';
const demoRequested = params.get('demo') === '1';
let profile = null;
try { const saved = JSON.parse(sessionStorage.getItem(ENTRY_KEY)); if (saved?.name) profile = entryProfile(saved.name); } catch {}
let invitedToDemo = params.get('view') === 'participant';
let automaticSession = !params.has('s') && !invitedToDemo;
let waitingForCurrent = true;
let waitingError = '';
let refreshTask = null;
let automaticPerson = null;
let joining = null;
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
function writeLocal(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast('This browser could not save your data.'); } }
function demoInitial() {
  const names = ['Director of Flight Operations', 'Head of Engineering', 'Head of Safety', 'Director of Network Planning', 'Chief Financial Officer'];
  return { code: 'demo', title: 'Business-Critical Roles Workshop', roles: names.map((name,i) => ({ id: `r${i+1}`, name, status: 'pending', round: 1 })), currentRoleId: 'r1', participants: [], votes: [], finished: false };
}
function demoGet() { return readLocal(DEMO_KEY) || demoInitial(); }
function demoSet(state) { writeLocal(DEMO_KEY, state); snapshot = publicSnapshot(state); lastSignature = JSON.stringify(snapshot); }
function identity() { const person = usesCurrentMeeting() ? automaticPerson : readLocal(`rolelab-person-${code}`); return isAdministrator(profile) || person?.name === profile?.name ? person : null; }
function hostToken() { return readLocal(`rolelab-host-${code}`); }
function inviteToken() { return readLocal(`rolelab-invite-${code}`) || linkAccessKey; }
function accessToken() { return (isAdministrator(profile) ? hostToken() : '') || identity()?.token || inviteToken() || ''; }
function isHost() { return isAdministrator(profile) && (code === 'demo' ? demoRequested : !!hostToken()); }
function needsHostSetup() { return isAdministrator(profile) && code === 'demo' && !demoRequested; }
function restoreHostMeeting() {
  if(!needsHostSetup())return;
  const previous=readLocal(LAST_HOST_KEY);
  if(previous&&readLocal(`rolelab-host-${previous}`)){
    code=previous;const url=new URL(location.href);url.search='';url.searchParams.set('s',code);history.replaceState({},'',url);
  }
}
function usesCurrentMeeting() { return automaticSession && !isAdministrator(profile) && !invitedToDemo; }
function currentRole() { return snapshot?.roles.find(r => r.id === snapshot.currentRoleId); }
function route(nextView, nextTab = 'session') {
  if (!isAdministrator(profile)) nextView = 'participant';
  if (code === 'demo' && nextView === 'participant' && isAdministrator(profile)) invitedToDemo = true;
  view = nextView; tab = nextTab;
  const url = new URL(location.href); url.search = ''; if (code !== 'demo' && !usesCurrentMeeting()) url.searchParams.set('s', code);
  if(demoRequested)url.searchParams.set('demo','1');
  if (linkAccessKey && code !== 'demo' && !usesCurrentMeeting()) url.searchParams.set('key', linkAccessKey);
  if (view !== 'host' && !usesCurrentMeeting() && (code !== 'demo' || invitedToDemo)) url.searchParams.set('view', view);
  if (tab !== 'session') url.searchParams.set('tab', tab);
  history.pushState({}, '', url); render();
}
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 4500); }
function entryHeader() {
  return `<header class="topbar"><div class="container topbar-inner"><a class="brand" href="./" aria-label="Rolelab, home"><span class="brand-mark">${icon('chart')}</span>Rolelab</a>${profile?`<div class="header-actions"><span class="badge">${esc(profile.name)}</span><button class="btn btn-link" data-action="change-name" aria-label="Change name">${icon('users')}<span>Change name</span></button></div>`:''}</div></header>`;
}
function entryPage() {
  return `${entryHeader()}<main class="mobile-page entry-page"><h1>Join the workshop</h1><p class="entry-intro">Enter your name to join the Business-Critical Roles Workshop.</p><form id="entry-form" class="join-form"><label class="form-group" for="entry-name">Your name<input id="entry-name" name="name" autocomplete="given-name" maxlength="60" required placeholder="Enter your name" aria-describedby="entry-hint"></label><p class="form-hint" id="entry-hint">The facilitator will see this name.</p><p class="form-error" id="form-error" role="alert"></p><button class="btn btn-primary btn-wide" type="submit">Join ${icon('arrow')}</button></form><p class="entry-footnote">Business-Critical Roles Workshop</p></main>`;
}
function waitingRoom() {
  return `${entryHeader()}<main class="mobile-page" id="waiting-room"><div class="wait-block"><div class="success-icon">${icon('clock')}</div><p class="entry-greeting">${esc(profile.name)}, you are ready.</p><h1>Waiting for the workshop</h1><p class="entry-intro">You will join automatically when the facilitator starts the workshop.</p>${waitingError?`<p class="live-error" role="alert">${esc(waitingError)}</p><button class="btn" data-action="retry">Try again</button>`:''}</div><p class="entry-footnote">Keep this page open.</p></main>`;
}
async function api(path, data) {
  if (cloudApi) return cloudApi(path, data);
  const response = await fetch(new URL(`./api/${path}`, location.href), { method: data ? 'POST' : 'GET', headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(10000) });
  const result = await response.json(); if (!response.ok) throw new Error(errorMessage(result.error || 'Unable to complete the request.')); return result;
}
function refresh(force = false) {
  if(refreshTask)return force?refreshTask.then(()=>refresh(true)):refreshTask;
  refreshTask=refreshNow(force).finally(()=>{refreshTask=null;});
  return refreshTask;
}
async function refreshNow(force = false) {
  if (!profile) { if (!$('#entry-form')) render(); return; }
  if (needsHostSetup()) { if (force || !$('#host-setup')) render(); return; }
  if (!usesCurrentMeeting() && waitsForInvitation(profile, code, invitedToDemo)) { if (force || !$('#waiting-room')) render(); return; }
  const entry = profile; const sessionCode = code;
  try {
    if (usesCurrentMeeting()) {
      let person=automaticPerson || readLocal(AUTO_PERSON_KEY);
      if(person?.name!==entry.name){person={name:entry.name,token:newId()};writeLocal(AUTO_PERSON_KEY,person);}
      automaticPerson=person;
      const current=await api('current',{name:entry.name,participantToken:person.token});
      if(profile!==entry || !usesCurrentMeeting())return;
      const hadError=!!waitingError;waitingError='';
      if(current.active){
        if(code!==current.code){snapshot=null;lastSignature='';voteDraft={};}
        code=current.code;waitingForCurrent=false;
        automaticPerson={code:current.code,id:current.id,token:current.token,name:current.name};
        if(person.code!==current.code||person.id!==current.id)writeLocal(AUTO_PERSON_KEY,automaticPerson);
        writeLocal(`rolelab-person-${code}`,automaticPerson);
      }else if(!snapshot){
        if(person.code){code=person.code;waitingForCurrent=false;}
        else {waitingForCurrent=true;if(force||hadError||!$('#waiting-room'))render();return;}
      }
    }
    let next = code === 'demo' ? publicSnapshot(demoGet()) : await api(`sessions/${encodeURIComponent(code)}`);
    if (profile !== entry || (!usesCurrentMeeting() && code !== sessionCode)) return;
    if (!isAdministrator(profile) && code === 'demo' && invitedToDemo && !next.participants.some(p=>p.id===identity()?.id)) {
      const state=demoGet();const person={id:newId(),token:newId(),name:profile.name};state.participants.push(person);
      writeLocal(`rolelab-person-${code}`,person);demoSet(state);next=publicSnapshot(state);
    }
    if (!isAdministrator(profile) && code !== 'demo' && !next.finished && !next.participants.some(p => p.id === identity()?.id)) {
      if (!joining) joining = api(`sessions/${sessionCode}/join`, { name: entry.name }).then(person => {
        if (profile === entry && code === sessionCode) writeLocal(`rolelab-person-${sessionCode}`, person);
      });
      const request = joining;
      try { await request; } finally { if (joining === request) joining = null; }
      if (profile !== entry || code !== sessionCode) return;
      next = await api(`sessions/${encodeURIComponent(code)}`);
    }
    if (profile !== entry || (!usesCurrentMeeting() && code !== sessionCode)) return;
    if(isAdministrator(profile)&&code!=='demo'&&hostToken())writeLocal(LAST_HOST_KEY,code);
    const signature = JSON.stringify(next);
    if (force || signature !== lastSignature || disconnected) { snapshot = next; lastSignature = signature; disconnected = false; render(); }
  } catch (error) {
    if(profile===entry && usesCurrentMeeting() && !snapshot){waitingForCurrent=true;waitingError=error.message;render();}
    else if (profile === entry && code === sessionCode && (!disconnected || !snapshot)) { disconnected = true; renderError(error.message); }
  }
}
function renderError(message) {
  if (!snapshot) $('#app').innerHTML = `${header()}<main class="container page"><div class="empty">${icon('globe')}<h1>Unable to open the workshop</h1><p>${esc(message)}</p><button class="btn btn-primary" data-action="retry">Try again</button><a class="btn" href="./">Home</a></div></main>`;
  else { render(); const errorEl = $('#connection-error'); if (errorEl) errorEl.textContent = 'Connection lost. Reconnecting; score submission is temporarily unavailable.'; }
}
function header() {
  if (!isAdministrator(profile) || needsHostSetup()) return entryHeader();
  return `<header class="topbar"><div class="container topbar-inner"><a class="brand" href="./" aria-label="Rolelab, home"><span class="brand-mark">${icon('chart')}</span>Rolelab<span class="brand-sub">AIR ASTANA | SUCCESSION PLANNING</span></a><div class="header-actions"><button class="btn btn-link" data-action="change-name" aria-label="Change name">${icon('users')}<span>Change name</span></button>${code === 'demo' ? '<span class="badge">Demo</span>' : `<span class="badge ${disconnected ? 'badge-amber' : 'badge-green'}">${disconnected ? 'Reconnecting' : 'Connected'}</span>`}${view === 'host' ? `<button class="btn" data-action="present" aria-label="Open presentation view">${icon('monitor')}<span>Presentation view</span></button><button class="btn" data-action="invite" aria-label="Show QR code">${icon('qr')}<span>QR code</span></button>` : `<button class="btn btn-link" data-action="${isHost() ? 'host-view' : 'invite'}">${icon(isHost() ? 'settings' : 'link')}<span>${isHost() ? 'Facilitator' : 'Invite'}</span></button>`}</div></div></header>`;
}
function demoNote() { return code === 'demo' ? `<div class="demo-note"><span><strong>Demo mode.</strong> Sample roles for preview. <button class="btn btn-link" data-action="reset-demo">Reset demo</button></span><button class="btn" data-action="create">Start workshop ${icon('plus')}</button></div>` : ''; }
function viewSwitcher() {
  if (!isAdministrator(profile)) return '';
  return `<div class="view-switch" aria-label="View">${[['host','settings','Facilitator'],['participant','phone','Participant'],['present','monitor','Presentation view']].map(([v,ic,title])=>`<button type="button" class="${view === v ? 'active' : ''}" data-view="${v}" aria-pressed="${view === v}">${icon(ic)}${title}</button>`).join('')}</div>`;
}
function statusBadge(role) {
  if (snapshot.finished) return '<span class="badge badge-green">Workshop complete</span>';
  if (role?.status === 'open') return `<span class="badge badge-blue">${icon('activity')}Scoring is open</span>`;
  if (role?.status === 'closed') return `<span class="badge badge-green">${icon('check')}Scoring complete</span>`;
  return '<span class="badge">Ready to score</span>';
}
function progress(value, total) { return `<div class="progress" role="progressbar" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="${Math.max(1,total)}" aria-label="Responses received"><span class="progress-fill" style="--progress:${total ? value/total : 0}"></span></div>`; }
function hostSetup() {
  return `${header()}<main class="mobile-page host-setup" id="host-setup"><span class="section-label">Facilitator dashboard</span><h1>Start a workshop</h1><p class="entry-intro">Add the role titles and start the workshop. Participants on this site will join automatically.</p><form id="create-form" class="join-form"><label class="form-group">Workshop title<input name="title" value="Business-Critical Roles Workshop" maxlength="100" required></label><label class="form-group">Role longlist<textarea name="roles" rows="7" required maxlength="20000" placeholder="One role title per line"></textarea><span class="form-hint">Up to 100 roles. A role title is all you need.</span></label><p class="form-error" role="alert"></p><button class="btn btn-primary btn-wide" type="submit">Start workshop ${icon('arrow')}</button></form><button class="btn btn-link btn-wide" data-action="invite">${icon('qr')}Show QR code to participants</button></main>`;
}
function hostPage() {
  const done = snapshot.roles.filter(r=>r.status === 'closed').length;
  return `${header()}<main class="container page host-page">${demoRequested?demoNote():''}${disconnected?'<div id="connection-error" class="live-error" role="alert">Reconnecting…</div>':''}<div class="page-heading"><div><h1>${esc(workshopTitle(snapshot.title))}</h1><p>${peopleLabel(snapshot.participants.length)} · ${done} of ${snapshot.roles.length} roles scored</p></div>${snapshot.finished?'<button class="btn btn-primary" data-action="create">Start a new workshop</button>':''}</div><div class="tabbar"><nav class="tabs" aria-label="Workshop sections">${[['session','list','Facilitate'],['ranking','trophy','Prioritised role list']].map(([t,ic,label])=>`<a href="?${new URLSearchParams({...(code!=='demo'?{s:code}:{}),tab:t})}" class="tab ${tab===t?'active':''}" data-tab="${t}" ${tab===t?'aria-current="page"':''}>${icon(ic)}${label}</a>`).join('')}</nav></div>${tab==='ranking'?leaderboard():hostWorkspace()}<footer class="bottom-bar"><span class="small muted">Participants will see the results when scoring closes.</span><button class="btn btn-link" data-action="finish" ${snapshot.finished?'disabled':''}>${icon('trophy')}Finish workshop</button></footer></main>`;
}
function hostWorkspace() {
  const role = currentRole();
  return `<div class="workspace host-workspace"><aside class="role-nav" aria-label="Role longlist"><div class="section-label"><h2>Role longlist</h2><span class="badge">${snapshot.roles.length}</span></div><div class="role-list">${snapshot.roles.map((r,i)=>`<button type="button" class="role-item ${r.id===role?.id?'active':''}" data-role="${esc(r.id)}" ${snapshot.finished?'disabled':''} aria-pressed="${r.id===role?.id}"><span class="role-number">${r.status==='closed'?icon('check'):String(i+1).padStart(2,'0')}</span><span><strong>${esc(r.name)}</strong><small>${r.status==='open'?'Scoring in progress':r.status==='closed'?(snapshot.results[r.id]?.count?`${fmt(snapshot.results[r.id].score)} out of 5`:'No responses'):'Not yet scored'}</small></span></button>`).join('')}</div><button class="btn btn-link add-role" data-action="add-role" ${snapshot.finished?'disabled':''}>${icon('plus')}Add role</button></aside><section class="host-main" aria-label="Current role"><div class="evaluation"><div class="evaluation-head">${statusBadge(role)}<h2>${esc(role?.name||'Select a role')}</h2></div>${controlBox()}${role?.status==='closed'&&snapshot.results[role.id]?.count?`<div class="score-summary"><span>Weighted score</span><strong class="score-large">${fmt(snapshot.results[role.id].score)} <small>/ 5</small></strong></div>`:''}</div><details class="host-details" open><summary>Participants (${snapshot.participants.length})</summary>${participants()}</details><details class="host-details"><summary>Dimensions and weights</summary>${criteriaPage()}</details></section></div>`;
}
function criterionRows(role, generic=false) {
  return CRITERIA.map((c,i)=>`<div class="criterion"><span class="criterion-icon">${icon(c.icon)}</span><div><h3>${esc(c.title)}</h3><p>${esc(c.description)}</p></div><div class="criterion-weight">${!generic && role?.status==='closed'?`<span class="result-average">${fmt(snapshot.results[role.id]?.averages[i])}</span><span class="small muted">${c.weight}%</span>`:`${c.weight}%`}</div></div>`).join('');
}
function controlBox() {
  const role=currentRole(); const count=snapshot.currentCount; const total=snapshot.participants.length;
  let action='open', label='Open scoring', ic='play', hint='Submit all six dimension scores together';
  if(role?.status==='open'){action='close';label='Close scoring and show results';ic='lock';hint='Participants will see the results';}
  if(role?.status==='closed'){action='next';label='Next role';ic='arrow';hint='The facilitator opens scoring';}
  if(snapshot.finished){action='ranking';label='View prioritised role list';ic='trophy';hint='Workshop complete';}
  return `<section class="control-box"><h2>${role?.status==='closed'?'Scoring complete':'Participant responses'}</h2><div class="answer-count"><strong>${count}</strong><span>/ ${total}</span></div><p>${total ? `${count===total?'All participants have submitted scores':'Responses received'}`:'Invite participants to the workshop'}</p>${progress(count,total)}<button class="btn" data-action="${action}" ${busy || disconnected || !role?'disabled':''}>${icon(ic)}${busy?'Saving…':label}</button><div class="control-hint">${hint}</div></section>`;
}
function participants() {
  return `<section class="participants"><div class="row spread"><h2>Participants</h2><span class="small muted">${snapshot.participants.length}</span></div>${snapshot.participants.length?snapshot.participants.map(p=>`<div class="person"><span class="person-info"><span class="avatar">${esc(p.name.slice(0,2).toLocaleUpperCase('en-GB'))}</span><span class="person-name">${esc(p.name)}</span></span><span class="person-status ${p.voted?'done':''}">${p.voted?'Submitted':currentRole()?.status==='open'?'Scoring':'Waiting'}</span></div>`).join(''):'<p class="participant-empty">Participants appear here after opening the link and entering their name.</p>'}<button class="invite-link" data-action="invite" aria-label="Show QR code">${icon('qr')}Show QR code</button></section>`;
}
function leaderboard() {
  const rows=snapshot.leaderboard;
  return `<section><div class="results-intro"><div><h2>Prioritised role list</h2><p>Average participant scores, weighted by dimension.</p></div><button class="btn" data-action="export" ${rows.length?'':'disabled'}>${icon('download')}Download CSV</button></div>${rows.length?`<table class="leader-table"><thead><tr><th>Rank</th><th>Role title</th><th class="votes-col">Responses</th><th>Weighted score (1–5)</th></tr></thead><tbody>${rows.map((r,i)=>`<tr class="${i===0?'rank-first':''}"><td class="rank">${r.place}</td><td><strong>${esc(r.name)}</strong></td><td class="votes-col">${r.count}</td><td><div class="score-line"><span class="score">${fmt(r.score)} <small>/ 5</small></span>${progress(r.score,5)}</div></td></tr>`).join('')}</tbody></table>`:`<div class="empty">${icon('trophy')}<h2>The prioritised role list will appear after scoring</h2><p>Close scoring for at least one role with submitted scores.</p><button class="btn" data-action="session-tab">Back to workshop ${icon('arrow')}</button></div>`}<p class="small muted" style="margin-top:var(--space-lg)">Weighted score = the sum of each dimension average multiplied by its weight. Roles without responses are excluded.</p></section>`;
}
function criteriaPage() {
  return `<section class="evaluation"><div class="evaluation-head"><h2>Scoring and calibration</h2><p>The score supports discussion. It does not replace judgement or functional evidence.</p></div><div class="criteria">${criterionRows(null,true)}</div><div class="evaluation-foot">${icon('info')}Score each dimension from 1 to 5. The score supports discussion. It does not replace judgement or functional evidence.</div></section>`;
}
function participantPage() {
  const person=identity(); const role=currentRole();
  const known=person && snapshot.participants.some(p=>p.id===person.id);
  const voted=known && snapshot.participants.find(p=>p.id===person.id)?.voted;
  if (!known && profile && !isAdministrator(profile)) {
    if (snapshot.finished) return `${entryHeader()}<main class="mobile-page"><span class="badge badge-green">Workshop complete</span><h1>Workshop results</h1>${leaderboard()}</main>`;
    return `${entryHeader()}<main class="mobile-page"><div class="wait-block"><h1>Joining the workshop</h1><p class="entry-intro">${esc(profile.name)}, your name has been saved.</p></div></main>`;
  }
  if(!known) return `${header()}<main class="mobile-page">${code==='demo'?'<span class="badge">Participant preview</span>':''}<h1>Your input matters.</h1><p class="muted" style="margin-top:var(--space-sm)">Join the Business-Critical Roles Workshop.</p><form id="join-form" class="join-form"><label class="form-group">Your name<input name="name" autocomplete="given-name" maxlength="60" required placeholder="Enter your name"></label><p class="form-hint">The facilitator sees your name. Scores are reported as group averages.</p><p class="form-error" id="form-error" role="alert"></p><button class="btn btn-primary btn-wide" type="submit">Join workshop ${icon('arrow')}</button></form>${code==='demo'?`<div style="margin-top:var(--space-xl)">${viewSwitcher()}</div>`:''}</main>`;
  if(snapshot.finished) return `${header()}<main class="mobile-page"><span class="badge badge-green">Workshop complete</span><h1>Thank you for your scores.</h1>${leaderboard()}${code==='demo'?viewSwitcher():''}</main>`;
  if(role?.status==='closed') return `${header()}<main class="mobile-page"><div class="row spread"><span class="small muted">${esc(person.name)}</span>${statusBadge(role)}</div><div class="evaluation"><div class="evaluation-head"><h2>${esc(role.name)}</h2><p>Scoring and calibration results</p></div>${snapshot.results[role.id]?.count?`<div class="score-summary"><span>Weighted score (1–5)</span><strong class="score-large">${fmt(snapshot.results[role.id].score)}</strong></div><div class="criteria">${CRITERIA.map((c,i)=>`<div class="criterion-result"><span>${esc(c.title)}</span><strong>${fmt(snapshot.results[role.id].averages[i])}</strong></div>`).join('')}</div>`:'<div class="empty"><p>No scores were submitted for this role.</p></div>'}</div><p class="small muted" style="margin-top:var(--space-lg);text-align:center">The facilitator will select the next role. This page updates automatically.</p>${code==='demo'?`<div style="margin-top:var(--space-xl)">${viewSwitcher()}</div>`:''}</main>`;
  if(voted || role?.status!=='open') return `${header()}<main class="mobile-page"><span class="small muted">${esc(person.name)}</span><div class="wait-block"><div class="success-icon">${icon(voted?'check':'clock')}</div><h2>${voted?'Scores submitted':'You have joined the workshop'}</h2><p>${voted?'Thank you. Waiting for the other participants.':'The facilitator will open scoring shortly.'}</p><p style="margin-top:var(--space-lg)"><strong>${esc(role?.name||'')}</strong></p><p style="margin-top:var(--space-sm)">${snapshot.currentCount} of ${snapshot.participants.length} participants have submitted scores</p></div><p class="small muted" style="text-align:center">This page updates automatically.</p>${code==='demo'?`<div style="margin-top:var(--space-xl)">${viewSwitcher()}</div>`:''}</main>`;
  const key=`${code}-${role.id}-${role.round}`; const scores=voteDraft[key]||[];
  return `${header()}<main class="mobile-page">${disconnected?'<div id="connection-error" class="live-error" role="alert">Reconnecting…</div>':''}<div class="row spread"><span class="small muted">${esc(person.name)}</span><span class="badge badge-blue">Scoring is open</span></div><form id="vote-form" data-key="${esc(key)}"><section class="evaluation"><div class="evaluation-head"><span class="small muted">Scoring and calibration</span><h2>${esc(role.name)}</h2><p>Score each dimension from 1 to 5.</p></div><div class="criteria">${CRITERIA.map((c,i)=>`<div class="criterion" role="group" aria-labelledby="criterion-${i}"><div><h3 id="criterion-${i}">${esc(c.title)}</h3><p>${esc(c.description)}</p></div><span class="criterion-weight">${c.weight}%</span><div class="score-options">${[1,2,3,4,5].map(n=>`<label><input type="radio" name="score${i}" value="${n}" ${scores[i]===n?'checked':''} required aria-label="${n} out of 5: ${esc(c.title)}"><span>${n}</span></label>`).join('')}</div><div class="scale-labels"><span>Low impact</span><span>High impact</span></div></div>`).join('')}</div></section><div class="submit-area"><p class="form-error" id="form-error" role="alert"></p><button class="btn btn-primary btn-wide" type="submit" ${disconnected?'disabled':''}>Submit scores ${icon('arrow')}</button><p>After submitting, wait for the other participants and the facilitator.</p></div></form>${code==='demo'?`<div style="margin-top:var(--space-xl)">${viewSwitcher()}</div>`:''}</main>`;
}
function presentPage() {
  const role=currentRole();
  return `${header()}<main class="present-page">${code==='demo'?'<span class="badge">Presentation preview</span>':''}${snapshot.finished?leaderboard():`<div class="present-role">${statusBadge(role)}<h1 style="margin-top:var(--space-lg)">${esc(role?.name||'Waiting for the workshop')}</h1></div><div class="present-grid"><section><div class="criteria">${criterionRows(role)}</div></section><aside><div class="present-count">${snapshot.currentCount}<small> / ${snapshot.participants.length}</small></div><p class="muted">participants have submitted scores</p>${progress(snapshot.currentCount,snapshot.participants.length)}${role?.status==='closed'&&snapshot.results[role.id]?.count?`<div style="margin-top:var(--space-xl)"><span class="small muted">Weighted score (1–5)</span><p class="score-large">${fmt(snapshot.results[role.id].score)}</p></div>`:''}<div class="present-invite"><p class="small muted">Join on your phone</p><div class="present-qr">${qrSvg(joinUrl(),'present-qr')}</div><p class="join-url">${esc(joinUrl())}</p><button class="btn" data-action="invite">${icon('qr')}Enlarge QR code</button></div></aside></div>`}<footer class="bottom-bar"><span>Business-Critical Roles Workshop</span>${code==='demo'||isHost()?viewSwitcher():''}</footer></main>`;
}
function render() {
  if (!profile) { $('#app').innerHTML = entryPage(); return; }
  if (needsHostSetup()) { $('#app').innerHTML = hostSetup(); return; }
  if ((usesCurrentMeeting() && waitingForCurrent) || (!usesCurrentMeeting() && waitsForInvitation(profile, code, invitedToDemo))) { $('#app').innerHTML = waitingRoom(); return; }
  if(!snapshot) return;
  if (!isAdministrator(profile)) view = 'participant';
  if(!isHost()&&view==='host') view='participant';
  // Keep the voting form intact when other participants send their answers.
  const focused=document.activeElement; const focusName=focused?.getAttribute('name'); const selection=focused?.selectionStart; const inputValue=focused?.value;
  $('#app').innerHTML=view==='participant'?participantPage():view==='present'?presentPage():hostPage();
  if(disconnected&&!$('#connection-error'))$('#app main')?.insertAdjacentHTML('afterbegin','<div id="connection-error" class="live-error" role="alert">Connection lost. Reconnecting…</div>');
  if(focusName){ const next=document.getElementsByName(focusName)[0]; if(next && next.type!=='radio'){if(inputValue!==undefined)next.value=inputValue;next.focus({preventScroll:true});if(typeof selection==='number')try{next.setSelectionRange(selection,selection);}catch{}} }
}
function joinUrl() { return siteUrl(location.href); }
function showDialog(content, className = '') { const dialog=$('#dialog');dialog.className=className;dialog.removeAttribute('aria-labelledby');dialog.innerHTML=content; if(!dialog.open)dialog.showModal(); }
function dialogHeader(title) { return `<div class="dialog-title"><h2>${title}</h2><button class="btn btn-link icon-btn" data-action="close-dialog" aria-label="Close">${icon('close')}</button></div>`; }
async function copy(text) {
  try { await navigator.clipboard.writeText(text);const feedback=$('#invite-feedback');if(feedback)feedback.textContent='Link copied. Share it with participants.';else toast('Link copied'); }
  catch {
    const field=$('#invite-url');
    if(field){field.focus();field.select();$('#invite-feedback').textContent='Link selected. Copy it and share it with participants.';}
    else showDialog(`${dialogHeader('Participant link')}<p>Copy the link and share it with participants.</p><div class="copy-field">${esc(text)}</div>`);
  }
}
function showInvitation() {
  const url=joinUrl();
  showDialog(`<div class="invitation-screen" id="invitation-screen"><div class="invitation-top"><span class="brand">${icon('chart')}Rolelab</span><div class="row"><button class="btn" data-action="invite-fullscreen" aria-label="Full screen">${icon('monitor')}<span>Full screen</span></button><button class="btn icon-btn" data-action="close-dialog" aria-label="Close QR code">${icon('close')}</button></div></div><div class="invitation-body"><div class="qr-code">${qrSvg(url)}</div><div class="invitation-info"><span class="section-label">Join the workshop</span><h1 id="invitation-title">Scan the QR code.<br>Enter your name.<br>Join the workshop.</h1><p class="invitation-description">Scan the QR code with your phone to open the current workshop.</p><div class="invitation-share"><label class="form-group" for="invite-url">Joining on a computer? Use the same link.<input id="invite-url" readonly value="${esc(url)}" spellcheck="false"></label><button class="btn btn-primary" data-action="copy-invite">${icon('copy')}Copy link</button><p id="invite-feedback" class="invitation-feedback" role="status" aria-live="polite"></p></div></div></div></div>`, 'invitation-dialog');
  $('#dialog').setAttribute('aria-labelledby','invitation-title');
}
async function toggleInviteFullscreen() {
  try { if(document.fullscreenElement?.id==='invitation-screen')await document.exitFullscreen();else await $('#invitation-screen').requestFullscreen(); }
  catch { $('#invite-feedback').textContent='The QR code already fills this page. Press F11 to enter browser full screen.'; }
}
async function act(action,roleId) {
  if(busy || !isHost())return;
  busy=true;render();
  try {
    if(code==='demo'){const state=demoGet();transition(state,{action,roleId});demoSet(state);}
    else {await api(`sessions/${code}/action`,{token:hostToken(),action,roleId});await refresh(true);}
    render();
  } catch(error){toast(error.message);} finally{busy=false;render();}
}
function createDialog() {
  if(!backend) return showDialog(`${dialogHeader('Interface preview')}<p>Preview the facilitator view, participant view and prioritised role list. Demo scores are saved only in this browser.</p><p>Connect the workshop database to collect scores from participants on separate phones.</p><div class="actions"><button class="btn btn-primary" data-action="close-dialog">Continue preview</button></div>`);
  showDialog(`${dialogHeader('Start workshop')}<p>Add your role titles. Everyone who has entered their name on this site will join automatically.</p><form id="create-form"><label class="form-group">Workshop title<input name="title" value="Business-Critical Roles Workshop" maxlength="100" required></label><label class="form-group">Role titles<textarea name="roles" placeholder="One role title per line" required maxlength="20000"></textarea><span class="form-hint">Up to 100 roles. You can add more during the workshop.</span></label><p class="form-error" id="dialog-error" role="alert"></p><div class="actions"><button class="btn" type="button" data-action="close-dialog">Cancel</button><button class="btn btn-primary" type="submit">Start workshop</button></div></form>`);
}
function exportResults() {
  const cell=value=>`"${String(value??'').replace(/"/g,'""')}"`;
  const rows=[['Rank','Role title','Weighted score (1–5)','Responses',...CRITERIA.map(c=>`${c.title} (${c.weight}%)`)],...snapshot.leaderboard.map(r=>[r.place, /^[=+@-]/.test(r.name)?`'${r.name}`:r.name,fmt(r.score),r.count,...r.averages.map(fmt)])];
  const blob=new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`rolelab-${code}-results.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-action],[data-view],[data-tab],[data-role]');if(!el)return;
  if(el.dataset.view){route(el.dataset.view);return;}
  if(el.dataset.tab){event.preventDefault();route('host',el.dataset.tab);return;}
  if(el.dataset.role){await act('select',el.dataset.role);return;}
  const action=el.dataset.action;
  if(action==='change-name'){
    profile=null;joining=null;automaticPerson=null;voteDraft={};waitingForCurrent=true;waitingError='';snapshot=null;lastSignature='';try{sessionStorage.removeItem(ENTRY_KEY);}catch{}
    $('#dialog').close();render();return;
  }
  if(!profile || (!isAdministrator(profile) && !['retry','invite','copy-invite','invite-fullscreen','export','close-dialog'].includes(action)))return;
  if(action==='close-dialog')$('#dialog').close();
  else if(action==='create')createDialog();
  else if(action==='reset-demo')showDialog(`${dialogHeader('Reset the demo?')}<p>Sample scores and participants will be cleared only in this browser.</p><div class="actions"><button class="btn" data-action="close-dialog">Cancel</button><button class="btn btn-primary" data-action="confirm-reset">Reset demo</button></div>`);
  else if(action==='confirm-reset'){demoSet(demoInitial());try{localStorage.removeItem('rolelab-person-demo');}catch{}voteDraft={};$('#dialog').close();route('host');}
  else if(action==='retry')refresh(true);
  else if(action==='host-view')route('host');
  else if(action==='session-tab')route('host','session');
  else if(action==='ranking')route('host','ranking');
  else if(action==='present'){const url=new URL(location.href);url.searchParams.set('view','present');url.searchParams.delete('tab');window.open(url.href,'rolelab-present','noopener');}
  else if(action==='invite')showInvitation();
  else if(action==='copy-invite')await copy(joinUrl());
  else if(action==='invite-fullscreen')await toggleInviteFullscreen();
  else if(action==='export')exportResults();
  else if(action==='open'||action==='close')await act(action);
  else if(action==='next'){const next=snapshot.roles.find(r=>r.status==='pending');if(next)await act('select',next.id);else route('host','ranking');}
  else if(action==='finish')showDialog(`${dialogHeader('Finish the workshop?')}<p>Participants will see the final prioritised role list. No further scores will be accepted. Unscored roles will have no weighted score.</p><div class="actions"><button class="btn" data-action="close-dialog">Continue workshop</button><button class="btn btn-primary" data-action="confirm-finish">Finish and show results</button></div>`);
  else if(action==='confirm-finish'){await act('finish');if(snapshot.finished){$('#dialog').close();route('host','ranking');}}
  else if(action==='add-role')showDialog(`${dialogHeader('Add a business-critical role')}<form id="add-role-form"><label class="form-group">Role title<input name="role" maxlength="150" required placeholder="Enter a role title"></label><p class="form-error" id="dialog-error" role="alert"></p><div class="actions"><button class="btn btn-primary" type="submit">Add role</button></div></form>`);
});
document.addEventListener('change',event=>{if(event.target.closest('#vote-form')){const form=$('#vote-form');voteDraft[form.dataset.key]=CRITERIA.map((_,i)=>Number(new FormData(form).get(`score${i}`))||null);}});
document.addEventListener('submit',async event=>{
  const form=event.target;if(!['entry-form','create-form','join-form','vote-form','add-role-form'].includes(form.id))return;event.preventDefault();if(busy)return;
  const button=form.querySelector('[type="submit"]');const originalLabel=button.innerHTML;button.disabled=true;button.textContent='Saving…';busy=true;
  try {
    const data=new FormData(form);
    if(form.id==='entry-form'){
      profile=entryProfile(data.get('name'));try{sessionStorage.setItem(ENTRY_KEY,JSON.stringify(profile));}catch{}
      if(!isAdministrator(profile)&&automaticSession){code='demo';linkAccessKey='';snapshot=null;lastSignature='';}
      if(isAdministrator(profile)){
        if(code!=='demo'&&!hostToken()){code='demo';linkAccessKey='';snapshot=null;lastSignature='';}
        restoreHostMeeting();
        route('host');
      }else route('participant');
      await refresh(true);
    } else if(form.id==='create-form'){
      if(!isAdministrator(profile))throw new Error('Only the facilitator can start a workshop.');
      const result=await api('sessions',{title:data.get('title'),roles:String(data.get('roles')).split(/\r?\n/).map(s=>s.trim()).filter(Boolean)});
      code=result.code;linkAccessKey='';writeLocal(`rolelab-host-${code}`,result.token);writeLocal(LAST_HOST_KEY,code);if(result.inviteToken)writeLocal(`rolelab-invite-${code}`,result.inviteToken);$('#dialog').close();snapshot=null;lastSignature='';route('host');await refresh(true);
    } else if(form.id==='join-form'){
      const name=String(data.get('name')).trim();if(!name)throw new Error('Enter your name.');
      let person;
      if(code==='demo'){const state=demoGet();person={id:newId(),token:newId(),name};state.participants.push(person);demoSet(state);}
      else person=await api(`sessions/${code}/join`,{name});
      writeLocal(`rolelab-person-${code}`,person);await refresh(true);
    } else if(form.id==='vote-form'){
      const role=currentRole();const person=identity();const scores=CRITERIA.map((_,i)=>Number(data.get(`score${i}`)));const vote={participantId:person.id,participantToken:person.token,roleId:role.id,round:role.round,scores};
      if(code==='demo'){const state=demoGet();submitVote(state,vote);demoSet(state);}else await api(`sessions/${code}/vote`,vote);
      delete voteDraft[form.dataset.key];await refresh(true);
    } else if(form.id==='add-role-form'){
      if(!isAdministrator(profile))throw new Error('Only the facilitator can add a role.');
      const name=String(data.get('role')).trim();if(!name)throw new Error('Enter a role title.');
      if(code==='demo'){const state=demoGet();if(state.finished)throw new Error('This workshop has finished.');state.roles.push({id:newId(),name,status:'pending',round:1});demoSet(state);}else await api(`sessions/${code}/roles`,{token:hostToken(),name});
      $('#dialog').close();await refresh(true);
    }
    render();
  }catch(error){const target=form.querySelector('.form-error');if(target)target.textContent=error.message;else toast(error.message);}
  finally{busy=false;if(button.isConnected){button.disabled=false;button.innerHTML=originalLabel;}}
});
window.addEventListener('storage',event=>{if(event.key===DEMO_KEY&&code==='demo')refresh();});
window.addEventListener('popstate',()=>{const query=new URLSearchParams(location.search);view=query.get('view')||'host';tab=query.get('tab')||'session';code=query.get('s')||'demo';linkAccessKey=query.get('key')||'';invitedToDemo=query.get('view')==='participant';automaticSession=!query.has('s')&&!invitedToDemo;waitingForCurrent=true;waitingError='';snapshot=null;lastSignature='';refresh(true);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('focus',()=>refresh());
$('#dialog').addEventListener('close',()=>{if(document.fullscreenElement?.id==='invitation-screen')document.exitFullscreen().catch(()=>{});});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('#dialog').open&&$('#dialog').classList.contains('invitation-dialog')){event.preventDefault();$('#dialog').close();}});
document.addEventListener('fullscreenchange',()=>{
  const button=$('[data-action="invite-fullscreen"]');
  if(button){const label=document.fullscreenElement?.id==='invitation-screen'?'Exit full screen':'Full screen';button.querySelector('span').textContent=label;button.setAttribute('aria-label',label);}
});
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
  restoreHostMeeting();await refresh(true);
  let lastPoll=0;pollTimer=setInterval(()=>{if(!busy&&(!document.hidden||Date.now()-lastPoll>=5000)){lastPoll=Date.now();refresh();}},1500);
}
init();
