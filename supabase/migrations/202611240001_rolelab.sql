begin;

create schema if not exists rolelab_private;
revoke all on schema rolelab_private from public, anon, authenticated;

create table rolelab_private.sessions (
  code text primary key check (code ~ '^[0-9]{6}$'),
  title text not null check (length(title) between 1 and 100),
  host_hash text not null,
  invite_hash text not null,
  current_role_id uuid,
  finished boolean not null default false,
  created_at timestamptz not null default now()
);
create table rolelab_private.roles (
  id uuid primary key default gen_random_uuid(),
  session_code text not null references rolelab_private.sessions(code) on delete cascade,
  position integer not null,
  name text not null check (length(name) between 1 and 150),
  status text not null default 'pending' check (status in ('pending','open','closed')),
  round integer not null default 1,
  unique (session_code, position)
);
create table rolelab_private.participants (
  id uuid primary key default gen_random_uuid(),
  session_code text not null references rolelab_private.sessions(code) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  token_hash text not null,
  created_at timestamptz not null default now()
);
create index participants_session on rolelab_private.participants(session_code);
create table rolelab_private.votes (
  role_id uuid not null references rolelab_private.roles(id) on delete cascade,
  participant_id uuid not null references rolelab_private.participants(id) on delete cascade,
  scores integer[] not null check (array_ndims(scores) = 1 and array_lower(scores,1) = 1 and cardinality(scores) = 6 and array_position(scores,null) is null and scores <@ array[1,2,3,4,5]),
  created_at timestamptz not null default now(),
  primary key (role_id,participant_id)
);
alter table rolelab_private.sessions enable row level security;
alter table rolelab_private.roles enable row level security;
alter table rolelab_private.participants enable row level security;
alter table rolelab_private.votes enable row level security;
revoke all on all tables in schema rolelab_private from public, anon, authenticated;

create function rolelab_private.hash_token(p_token text) returns text
language sql immutable set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(p_token,''),'UTF8')),'hex')
$$;
create function rolelab_private.new_token() returns text
language sql volatile set search_path = '' as $$
  select pg_catalog.replace(pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text,'-','')
$$;
revoke all on all functions in schema rolelab_private from public, anon, authenticated;

create function public.rolelab_create(p_title text,p_roles text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
  v_host text := rolelab_private.new_token();
  v_invite text := rolelab_private.new_token();
  v_first uuid;
  v_title text := pg_catalog.btrim(coalesce(p_title,''));
begin
  if length(v_title) not between 1 and 100 then raise exception 'Название встречи: от 1 до 100 символов.'; end if;
  if p_roles is null or cardinality(p_roles) not between 1 and 100 or array_ndims(p_roles) <> 1
    or exists (select 1 from unnest(p_roles) n where n is null or length(btrim(n)) not between 1 and 150)
  then raise exception 'Добавьте от 1 до 100 ролей, каждая до 150 символов.'; end if;
  for attempt in 1..20 loop
    v_code := floor(100000 + random() * 900000)::integer::text;
    begin
      insert into rolelab_private.sessions(code,title,host_hash,invite_hash)
      values(v_code,v_title,rolelab_private.hash_token(v_host),rolelab_private.hash_token(v_invite));
      exit;
    exception when unique_violation then
      if attempt = 20 then raise exception 'Не удалось выделить код сессии. Повторите запрос.'; end if;
    end;
  end loop;
  insert into rolelab_private.roles(session_code,position,name)
    select v_code,ordinality::integer,btrim(name) from unnest(p_roles) with ordinality as names(name,ordinality);
  select id into v_first from rolelab_private.roles where session_code=v_code order by position limit 1;
  update rolelab_private.sessions set current_role_id=v_first where code=v_code;
  return jsonb_build_object('code',v_code,'token',v_host,'inviteToken',v_invite);
end $$;

create function public.rolelab_snapshot(p_code text,p_access_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_session rolelab_private.sessions%rowtype;
  v_hash text := rolelab_private.hash_token(p_access_token);
  v_result jsonb;
begin
  select * into v_session from rolelab_private.sessions where code=p_code;
  if not found or p_access_token is null or length(p_access_token)<32 then raise exception 'Сессия не найдена или ссылка неполная.'; end if;
  if v_hash<>v_session.host_hash and v_hash<>v_session.invite_hash and not exists(
    select 1 from rolelab_private.participants where session_code=p_code and token_hash=v_hash
  ) then raise exception 'Сессия не найдена или ссылка неполная.'; end if;
  with metrics as (
    select r.id,r.name,r.status,r.round,r.position,count(v.role_id)::integer as count,
      array[avg(v.scores[1]),avg(v.scores[2]),avg(v.scores[3]),avg(v.scores[4]),avg(v.scores[5]),avg(v.scores[6])] as averages,
      avg((v.scores[1]*25+v.scores[2]*25+v.scores[3]*20+v.scores[4]*15+v.scores[5]*10+v.scores[6]*5)/100.0) as score
    from rolelab_private.roles r left join rolelab_private.votes v on v.role_id=r.id
    where r.session_code=p_code and r.status='closed' group by r.id
  ), ranked as (
    select *,rank() over(order by score desc)::integer as place from metrics where count>0
  )
  select jsonb_build_object(
    'code',v_session.code,'title',v_session.title,'finished',v_session.finished,'currentRoleId',v_session.current_role_id,
    'roles',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status,'round',round) order by position) from rolelab_private.roles where session_code=p_code),'[]'::jsonb),
    'participants',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'voted',exists(select 1 from rolelab_private.votes v where v.participant_id=p.id and v.role_id=v_session.current_role_id)) order by p.created_at,p.id) from rolelab_private.participants p where p.session_code=p_code),'[]'::jsonb),
    'currentCount',(select count(*) from rolelab_private.votes where role_id=v_session.current_role_id),
    'results',coalesce((select jsonb_object_agg(id::text,jsonb_build_object('count',count,'averages',averages,'score',score)) from metrics),'{}'::jsonb),
    'leaderboard',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status,'round',round,'count',count,'averages',averages,'score',score,'place',place) order by score desc,name) from ranked),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

create function public.rolelab_join(p_code text,p_invite_token text,p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session rolelab_private.sessions%rowtype;
  v_hash text := rolelab_private.hash_token(p_invite_token);
  v_token text := rolelab_private.new_token();
  v_id uuid;
  v_name text := btrim(coalesce(p_name,''));
begin
  select * into v_session from rolelab_private.sessions where code=p_code for update;
  if not found then raise exception 'Сессия не найдена.'; end if;
  if v_hash<>v_session.invite_hash and v_hash<>v_session.host_hash and not exists(
    select 1 from rolelab_private.participants where session_code=p_code and token_hash=v_hash
  ) then raise exception 'Приглашение недействительно.'; end if;
  if v_session.finished then raise exception 'Эта сессия завершена.'; end if;
  if length(v_name) not between 1 and 60 then raise exception 'Введите имя длиной от 1 до 60 символов.'; end if;
  if (select count(*) from rolelab_private.participants where session_code=p_code)>=200 then raise exception 'Достигнут лимит в 200 участников.'; end if;
  insert into rolelab_private.participants(session_code,name,token_hash) values(p_code,v_name,rolelab_private.hash_token(v_token)) returning id into v_id;
  return jsonb_build_object('id',v_id,'token',v_token,'name',v_name);
end $$;

create function public.rolelab_vote(p_code text,p_participant_id uuid,p_participant_token text,p_role_id uuid,p_round integer,p_scores integer[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session rolelab_private.sessions%rowtype;
  v_role rolelab_private.roles%rowtype;
begin
  -- The same lock is taken by closing and voting: a late vote cannot enter a closed round.
  select * into v_session from rolelab_private.sessions where code=p_code for update;
  if not found then raise exception 'Сессия не найдена.'; end if;
  if not exists(select 1 from rolelab_private.participants where id=p_participant_id and session_code=p_code and token_hash=rolelab_private.hash_token(p_participant_token)) then raise exception 'Войдите в сессию, чтобы отправить оценки.'; end if;
  select * into v_role from rolelab_private.roles where id=p_role_id and session_code=p_code;
  if not found or v_session.finished or v_session.current_role_id<>p_role_id or v_role.status<>'open' or p_round is distinct from v_role.round then raise exception 'Голосование изменилось или уже закрыто.'; end if;
  if p_scores is null or array_ndims(p_scores)<>1 or array_lower(p_scores,1)<>1 or cardinality(p_scores)<>6 or array_position(p_scores,null) is not null or not p_scores <@ array[1,2,3,4,5] then raise exception 'Поставьте оценку от 1 до 5 по всем шести критериям.'; end if;
  begin
    insert into rolelab_private.votes(role_id,participant_id,scores) values(p_role_id,p_participant_id,p_scores);
  exception when unique_violation then raise exception 'Ваши оценки уже приняты.';
  end;
  return jsonb_build_object('ok',true);
end $$;

create function public.rolelab_action(p_code text,p_host_token text,p_action text,p_role_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session rolelab_private.sessions%rowtype;
  v_role rolelab_private.roles%rowtype;
begin
  select * into v_session from rolelab_private.sessions where code=p_code for update;
  if not found or rolelab_private.hash_token(p_host_token)<>v_session.host_hash then raise exception 'Управление доступно только ведущему.'; end if;
  if v_session.finished then raise exception 'Сессия завершена.'; end if;
  select * into v_role from rolelab_private.roles where id=v_session.current_role_id;
  if p_action='select' then
    if not exists(select 1 from rolelab_private.roles where id=p_role_id and session_code=p_code) then raise exception 'Роль не найдена.'; end if;
    if v_role.status='open' and v_role.id<>p_role_id then raise exception 'Сначала закройте текущее голосование.'; end if;
    update rolelab_private.sessions set current_role_id=p_role_id where code=p_code;
  elsif p_action='open' then
    if v_role.status is distinct from 'pending' then raise exception 'Выберите ещё не оценённую роль.'; end if;
    update rolelab_private.roles set status='open' where id=v_role.id;
  elsif p_action='close' then
    if v_role.status is distinct from 'open' then raise exception 'Голосование не открыто.'; end if;
    update rolelab_private.roles set status='closed' where id=v_role.id;
  elsif p_action='finish' then
    if v_role.status='open' then raise exception 'Сначала закройте текущее голосование.'; end if;
    update rolelab_private.sessions set finished=true where code=p_code;
  else raise exception 'Неизвестное действие.';
  end if;
  return jsonb_build_object('ok',true);
end $$;

create function public.rolelab_add_role(p_code text,p_host_token text,p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session rolelab_private.sessions%rowtype;
  v_position integer;
  v_name text := btrim(coalesce(p_name,''));
begin
  select * into v_session from rolelab_private.sessions where code=p_code for update;
  if not found or rolelab_private.hash_token(p_host_token)<>v_session.host_hash then raise exception 'Управление доступно только ведущему.'; end if;
  if v_session.finished then raise exception 'Сессия завершена.'; end if;
  select coalesce(max(position),0)+1 into v_position from rolelab_private.roles where session_code=p_code;
  if v_position>100 or length(v_name) not between 1 and 150 then raise exception 'Название до 150 символов; не более 100 ролей.'; end if;
  insert into rolelab_private.roles(session_code,position,name) values(p_code,v_position,v_name);
  return jsonb_build_object('ok',true);
end $$;

revoke all on function public.rolelab_create(text,text[]) from public,anon,authenticated;
revoke all on function public.rolelab_snapshot(text,text) from public,anon,authenticated;
revoke all on function public.rolelab_join(text,text,text) from public,anon,authenticated;
revoke all on function public.rolelab_vote(text,uuid,text,uuid,integer,integer[]) from public,anon,authenticated;
revoke all on function public.rolelab_action(text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.rolelab_add_role(text,text,text) from public,anon,authenticated;
grant execute on function public.rolelab_create(text,text[]) to anon,authenticated;
grant execute on function public.rolelab_snapshot(text,text) to anon,authenticated;
grant execute on function public.rolelab_join(text,text,text) to anon,authenticated;
grant execute on function public.rolelab_vote(text,uuid,text,uuid,integer,integer[]) to anon,authenticated;
grant execute on function public.rolelab_action(text,text,text,uuid) to anon,authenticated;
grant execute on function public.rolelab_add_role(text,text,text) to anon,authenticated;

commit;
