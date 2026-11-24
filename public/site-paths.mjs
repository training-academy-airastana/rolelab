export function siteUrl(href) { return new URL('./', href).href; }

export function invitationUrl(href, code, inviteToken = '') {
  const url = new URL('./', href);
  if (code !== 'demo') {
    url.searchParams.set('s', code);
    if (inviteToken) url.searchParams.set('key', inviteToken);
  }
  url.searchParams.set('view', 'participant');
  return url.href;
}
