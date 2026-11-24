export function entryProfile(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 60) throw new Error('Enter a name between 1 and 60 characters.');
  return { name };
}
export function isAdministrator(profile) { return profile?.name === 'admin1'; }
export function waitsForInvitation(profile, code, requestedParticipantView) {
  return !!profile && !isAdministrator(profile) && code === 'demo' && !requestedParticipantView;
}
