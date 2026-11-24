export const CRITERIA = [
  { id: 'safety', title: 'Безопасность и регуляторное влияние', weight: 25, description: 'Последствия для безопасности, лицензий и соответствия требованиям', icon: 'shield' },
  { id: 'continuity', title: 'Непрерывность деятельности', weight: 25, description: 'Влияние на полёты и критически важные бизнес-процессы', icon: 'activity' },
  { id: 'scarcity', title: 'Дефицитность и сложность замены', weight: 20, description: 'Доступность специалистов на рынке и внутреннего кадрового резерва', icon: 'users' },
  { id: 'competence', title: 'Время до достижения компетентности', weight: 15, description: 'Длительность подготовки, получения опыта и необходимых допусков', icon: 'clock' },
  { id: 'financial', title: 'Финансовое и коммерческое влияние', weight: 10, description: 'Масштаб влияния на выручку, затраты и денежные потоки', icon: 'chart' },
  { id: 'strategy', title: 'Стратегические и будущие возможности', weight: 5, description: 'Связь с развитием флота, маршрутной сети и планами роста', icon: 'compass' },
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
    .filter(r => r.count > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'))
    .map((role, i) => { if (last === null || Math.abs(last - role.score) > 1e-10) place = i + 1; last = role.score; return { ...role, place }; });
}
export function submitVote(session, { participantId, participantToken, roleId, scores, round }) {
  const person = session.participants.find(p => p.id === participantId && p.token === participantToken);
  if (!person) throw new Error('Войдите в сессию, чтобы отправить оценки.');
  const role = session.roles.find(r => r.id === roleId);
  if (session.finished || session.currentRoleId !== roleId || !role || role.status !== 'open' || role.round !== round) throw new Error('Голосование изменилось или уже закрыто. Обновите страницу.');
  if (!Array.isArray(scores) || scores.length !== 6 || scores.some(v => !Number.isInteger(v) || v < 1 || v > 5)) throw new Error('Поставьте оценку от 1 до 5 по каждому из шести критериев.');
  if (session.votes.some(v => v.roleId === roleId && v.participantId === participantId)) throw new Error('Ваши оценки уже приняты.');
  session.votes.push({ participantId, roleId, scores: [...scores] });
}
export function transition(session, { action, roleId }) {
  if (session.finished) throw new Error('Сессия завершена. Создайте новую сессию для следующей встречи.');
  const current = session.roles.find(r => r.id === session.currentRoleId);
  const target = session.roles.find(r => r.id === roleId);
  if (action === 'select') {
    if (!target) throw new Error('Роль не найдена.');
    if (current?.status === 'open' && current.id !== roleId) throw new Error('Сначала закройте текущее голосование.');
    session.currentRoleId = roleId;
  } else if (action === 'open') {
    if (!current || current.status !== 'pending') throw new Error('Выберите ещё не оценённую роль.');
    current.status = 'open';
  } else if (action === 'close') {
    if (current?.status !== 'open') throw new Error('Голосование не открыто.');
    current.status = 'closed';
  } else if (action === 'finish') {
    if (current?.status === 'open') throw new Error('Сначала закройте текущее голосование.');
    session.finished = true;
  } else throw new Error('Неизвестное действие.');
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
