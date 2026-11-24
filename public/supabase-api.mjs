export function validateSupabaseConfig(url, key) {
  if (!url && !key) return false;
  if (!url || !key) throw new Error('Укажите адрес проекта и публичный ключ Supabase.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('Адрес Supabase должен быть HTTPS-адресом проекта.');
  if (key.startsWith('sb_publishable_')) return true;
  // Legacy anon keys are accepted; privileged keys must never reach GitHub Pages.
  if (key.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role === 'anon') return true;
    } catch {}
  }
  throw new Error('Нужен publishable key Supabase. Секретный ключ использовать нельзя.');
}

export function createSupabaseApi({ url, key, getAccessToken = () => '', fetchImpl = fetch }) {
  validateSupabaseConfig(url, key);
  const root = url.replace(/\/$/, '');
  async function rpc(name, args) {
    const response = await fetchImpl(`${root}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || result.error || 'Не удалось связаться с Supabase.');
    return result;
  }
  return async (path, data) => {
    const [resource, code, operation] = path.split('/');
    if (resource !== 'sessions') throw new Error('Неизвестный запрос.');
    if (!code && data) return rpc('rolelab_create', { p_title: data.title, p_roles: data.roles });
    if (!operation && !data) return rpc('rolelab_snapshot', { p_code: decodeURIComponent(code), p_access_token: getAccessToken() });
    if (operation === 'join') return rpc('rolelab_join', { p_code: code, p_invite_token: getAccessToken(), p_name: data.name });
    if (operation === 'vote') return rpc('rolelab_vote', {
      p_code: code, p_participant_id: data.participantId, p_participant_token: data.participantToken,
      p_role_id: data.roleId, p_round: data.round, p_scores: data.scores,
    });
    if (operation === 'action') return rpc('rolelab_action', { p_code: code, p_host_token: data.token, p_action: data.action, p_role_id: data.roleId || null });
    if (operation === 'roles') return rpc('rolelab_add_role', { p_code: code, p_host_token: data.token, p_name: data.name });
    throw new Error('Неизвестный запрос.');
  };
}
