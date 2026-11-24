export const CRITERIA = [
  { id: 'safety', title: 'Safety, security and regulatory impact', weight: 25, description: 'Approval, licence, audit or safety consequence', icon: 'shield' },
  { id: 'continuity', title: 'Operational continuity', weight: 25, description: 'Clear disruption to flight or critical process', icon: 'activity' },
  { id: 'scarcity', title: 'Scarcity and replaceability', weight: 20, description: 'Small labour market or limited internal bench', icon: 'users' },
  { id: 'competence', title: 'Time to competence', weight: 15, description: 'Long qualification, experience or approval pathway', icon: 'clock' },
  { id: 'financial', title: 'Financial / commercial impact', weight: 10, description: 'Material revenue, cost or cash exposure', icon: 'chart' },
  { id: 'strategy', title: 'Strategic / future capability', weight: 5, description: 'Direct link to fleet, network or growth plan', icon: 'compass' },
];
export function resultsFor(session, roleId) {
  const votes = session.votes.filter(v => v.roleId === roleId);
  const averages = CRITERIA.map((_, i) => votes.length ? votes.reduce((sum, vote) => sum + vote.scores[i], 0) / votes.length : null);
  const score = votes.length ? averages.reduce((sum, avg, i) => sum + avg * CRITERIA[i].weight / 100, 0) : null;
  return { count: votes.length, averages, score };
}
export function ranking(session) {
  let last = null;
  let place = 0;
  return session.roles.filter(r => r.status === 'closed').map(role => ({ ...role, ...resultsFor(session, role.id) }))
    .filter(r => r.count > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'en'))
    .map((role, i) => { if (last === null || Math.abs(last - role.score) > 1e-10) place = i + 1; last = role.score; return { ...role, place }; });
}
export function submitVote(session, { participantId, participantToken, roleId, scores, round }) {
  const person = session.participants.find(p => p.id === participantId && p.token === participantToken);
  if (!person) throw new Error('Join the workshop to submit scores.');
  const role = session.roles.find(r => r.id === roleId);
  if (session.finished || session.currentRoleId !== roleId || !role || role.status !== 'open' || role.round !== round) throw new Error('Scoring has changed or closed. Refresh the page.');
  if (!Array.isArray(scores) || scores.length !== 6 || scores.some(v => !Number.isInteger(v) || v < 1 || v > 5)) throw new Error('Score all six dimensions from 1 to 5.');
  if (session.votes.some(v => v.roleId === roleId && v.participantId === participantId)) throw new Error('Your scores have already been submitted.');
  session.votes.push({ participantId, roleId, scores: [...scores] });
}
export function transition(session, { action, roleId }) {
  if (session.finished) throw new Error('This workshop has finished. Start a new workshop to continue.');
  const current = session.roles.find(r => r.id === session.currentRoleId);
  const target = session.roles.find(r => r.id === roleId);
  if (action === 'select') {
    if (!target) throw new Error('Role not found.');
    if (current?.status === 'open' && current.id !== roleId) throw new Error('Close the current scoring round first.');
    session.currentRoleId = roleId;
  } else if (action === 'open') {
    if (!current || current.status !== 'pending') throw new Error('Select a role that has not yet been scored.');
    current.status = 'open';
  } else if (action === 'close') {
    if (current?.status !== 'open') throw new Error('Scoring is not open.');
    current.status = 'closed';
  } else if (action === 'finish') {
    if (current?.status === 'open') throw new Error('Close the current scoring round first.');
    session.finished = true;
  } else throw new Error('Unknown action.');
}
export function publicSnapshot(session) {
  const current = session.roles.find(r => r.id === session.currentRoleId);
  const votedIds = session.votes.filter(v => v.roleId === current?.id).map(v => v.participantId);
  return {
    code: session.code, title: session.title, roles: session.roles, currentRoleId: session.currentRoleId,
    finished: session.finished, participants: session.participants.map(p => ({ id: p.id, name: p.name, voted: votedIds.includes(p.id) })),
    currentCount: votedIds.length,
    results: Object.fromEntries(session.roles.filter(r => r.status === 'closed').map(r => [r.id, resultsFor(session, r.id)])),
    leaderboard: ranking(session),
  };
}
