import { errorMessage } from './error-messages.mjs';

export function validateSupabaseConfig(url, key) {
  if (!url && !key) return false;
  if (!url || !key) throw new Error('Set the Supabase project URL and publishable key.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('The Supabase project URL must use HTTPS.');
  if (key.startsWith('sb_publishable_')) return true;
  // Legacy anon keys are accepted; privileged keys must never reach GitHub Pages.
  if (key.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role === 'anon') return true;
    } catch {}
  }
  throw new Error('Use a Supabase publishable key. Secret keys are not allowed.');
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
    if (!response.ok) {
      if(name==='rolelab_enter_current'&&result.code==='PGRST202')throw new Error('Automatic joining is not available yet. Please try again shortly.');
      throw new Error(errorMessage(result.message || result.error || 'Unable to connect to the workshop.'));
    }
    return result;
  }
  return async (path, data) => {
    const [resource, code, operation] = path.split('/');
    if(resource==='current')return rpc('rolelab_enter_current',{p_name:data.name,p_participant_token:data.participantToken});
    if (resource !== 'sessions') throw new Error('Unknown request.');
    if (!code && data) return rpc('rolelab_create', { p_title: data.title, p_roles: data.roles });
    if (!operation && !data) return rpc('rolelab_snapshot', { p_code: decodeURIComponent(code), p_access_token: getAccessToken() });
    if (operation === 'join') return rpc('rolelab_join', { p_code: code, p_invite_token: getAccessToken(), p_name: data.name });
    if (operation === 'vote') return rpc('rolelab_vote', {
      p_code: code, p_participant_id: data.participantId, p_participant_token: data.participantToken,
      p_role_id: data.roleId, p_round: data.round, p_scores: data.scores,
    });
    if (operation === 'action') return rpc('rolelab_action', { p_code: code, p_host_token: data.token, p_action: data.action, p_role_id: data.roleId || null });
    if (operation === 'roles') return rpc('rolelab_add_role', { p_code: code, p_host_token: data.token, p_name: data.name });
    throw new Error('Unknown request.');
  };
}
