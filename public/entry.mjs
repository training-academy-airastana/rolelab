export function entryProfile(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 60) throw new Error('Введите имя длиной от 1 до 60 символов.');
  return { name };
}
export function isAdministrator(profile) { return profile?.name === 'admin1'; }
export function waitsForInvitation(profile, code, requestedParticipantView) {
  return !!profile && !isAdministrator(profile) && code === 'demo' && !requestedParticipantView;
}
