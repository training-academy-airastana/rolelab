begin;

create table if not exists rolelab_private.current_meeting (
  singleton boolean primary key default true check (singleton),
  session_code text not null references rolelab_private.sessions(code) on delete cascade
);
alter table rolelab_private.current_meeting enable row level security;
revoke all on rolelab_private.current_meeting from public,anon,authenticated;

-- Newly created meetings become current. Finishing an older meeting must not
-- clear a newer one. Existing meetings are not activated during installation.
create or replace function rolelab_private.track_current_meeting() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP='INSERT' then
    insert into rolelab_private.current_meeting(singleton,session_code) values(true,NEW.code)
      on conflict(singleton) do update set session_code=excluded.session_code;
  elsif NEW.finished then
    delete from rolelab_private.current_meeting where session_code=NEW.code;
  end if;
  return NEW;
end $$;
revoke all on function rolelab_private.track_current_meeting() from public,anon,authenticated;
drop trigger if exists rolelab_track_current on rolelab_private.sessions;
create trigger rolelab_track_current after insert or update of finished on rolelab_private.sessions
  for each row execute function rolelab_private.track_current_meeting();

create or replace function public.rolelab_enter_current(p_name text,p_participant_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session rolelab_private.sessions%rowtype;
  v_name text := btrim(coalesce(p_name,''));
  v_hash text := rolelab_private.hash_token(p_participant_token);
  v_id uuid;
  v_stored_name text;
begin
  if length(v_name) not between 1 and 60 then raise exception 'Введите имя длиной от 1 до 60 символов.'; end if;
  if p_participant_token is null or length(p_participant_token) not between 32 and 128 then raise exception 'Обновите страницу и войдите заново.'; end if;
  select s.* into v_session from rolelab_private.sessions s
    join rolelab_private.current_meeting c on c.session_code=s.code for update of s;
  if not found or v_session.finished then return jsonb_build_object('active',false); end if;
  select id,name into v_id,v_stored_name from rolelab_private.participants
    where session_code=v_session.code and token_hash=v_hash limit 1;
  if found then
    if v_stored_name<>v_name then raise exception 'Смените имя и войдите заново.'; end if;
  else
    if (select count(*) from rolelab_private.participants where session_code=v_session.code)>=200 then raise exception 'Достигнут лимит в 200 участников.'; end if;
    insert into rolelab_private.participants(session_code,name,token_hash)
      values(v_session.code,v_name,v_hash) returning id into v_id;
  end if;
  return jsonb_build_object('active',true,'code',v_session.code,'id',v_id,'token',p_participant_token,'name',v_name);
end $$;
revoke all on function public.rolelab_enter_current(text,text) from public,anon,authenticated;
grant execute on function public.rolelab_enter_current(text,text) to anon,authenticated;
notify pgrst, 'reload schema';

commit;
