-- Bounded staging avoids transmitting a complete long history in one HTTP request.
-- Only finish_owner_upload changes the canonical save, through the existing atomic commit.
begin;
create table public.owner_uploads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  command_id uuid not null,
  save_id uuid not null,
  expected_revision bigint not null check(expected_revision>=0),
  core jsonb not null,
  replace_save boolean not null,
  chunk_count integer not null check(chunk_count between 1 and 32)
);
create table public.owner_upload_chunks (
  user_id uuid references public.owner_uploads(user_id) on delete cascade,
  part integer not null check(part between 0 and 31),
  body jsonb not null,
  bytes integer not null check(bytes between 0 and 2000000),
  primary key(user_id,part)
);
alter table public.owner_uploads enable row level security;
alter table public.owner_upload_chunks enable row level security;
revoke all on public.owner_uploads,public.owner_upload_chunks from public,anon,authenticated;

create function public.begin_owner_upload(p_save_id uuid,p_command_id uuid,p_expected_revision bigint,p_core jsonb,p_replace boolean,p_chunk_count integer) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='30s'
as $$
declare uid uuid:=auth.uid(); old public.owner_uploads;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_save_id is null or p_command_id is null or p_expected_revision is null or p_expected_revision<0 or p_replace is null or p_chunk_count is null or p_chunk_count not between 1 and 32 or p_core is null or jsonb_typeof(p_core)<>'object' or octet_length(p_core::text)>32768 or (p_core->>'saveId') is distinct from p_save_id::text then raise exception 'invalid upload' using errcode='22023'; end if;
  if exists(select 1 from public.owner_saves where id=p_save_id and user_id<>uid) then raise exception 'save inaccessible' using errcode='42501'; end if;
  -- Serialize staging changes for this user, including the initially absent row.
  perform pg_advisory_xact_lock(hashtextextended(uid::text,581));
  select * into old from public.owner_uploads where user_id=uid for update;
  if found and old.command_id=p_command_id then
    if old.save_id<>p_save_id or old.expected_revision<>p_expected_revision or old.core<>p_core or old.replace_save<>p_replace or old.chunk_count<>p_chunk_count then raise exception 'upload id reused with different metadata' using errcode='22023'; end if;
  else
    delete from public.owner_uploads where user_id=uid;
    insert into public.owner_uploads values(uid,p_command_id,p_save_id,p_expected_revision,p_core,p_replace,p_chunk_count);
  end if;
  return jsonb_build_object('ready',true);
end;
$$;

create function public.append_owner_upload(p_command_id uuid,p_part integer,p_entities jsonb) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='30s'
as $$
declare uid uuid:=auth.uid(); upload public.owner_uploads; old jsonb; size integer;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,581));
  select * into upload from public.owner_uploads where user_id=uid for update;
  if not found or upload.command_id is distinct from p_command_id then raise exception 'upload replaced or missing' using errcode='PT409'; end if;
  if p_part is null or p_part<0 or p_part>=upload.chunk_count or p_entities is null or jsonb_typeof(p_entities)<>'array' or jsonb_array_length(p_entities)>100000 then raise exception 'invalid chunk' using errcode='22023'; end if;
  size=octet_length(p_entities::text);
  if size>2000000 then raise exception 'chunk too large' using errcode='22023'; end if;
  select body into old from public.owner_upload_chunks where user_id=uid and part=p_part;
  if found then
    if old<>p_entities then raise exception 'chunk reused with different content' using errcode='22023'; end if;
  else
    if size+(select coalesce(sum(bytes),0) from public.owner_upload_chunks where user_id=uid)>20000000 then raise exception 'upload too large' using errcode='22023'; end if;
    insert into public.owner_upload_chunks values(uid,p_part,p_entities,size);
  end if;
  return jsonb_build_object('part',p_part);
end;
$$;

create function public.finish_owner_upload(p_command_id uuid) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='30s'
as $$
declare uid uuid:=auth.uid(); upload public.owner_uploads; entities jsonb; result jsonb;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,581));
  select * into upload from public.owner_uploads where user_id=uid for update;
  if not found or upload.command_id is distinct from p_command_id then raise exception 'upload replaced or missing' using errcode='PT409'; end if;
  if (select count(*) from public.owner_upload_chunks where user_id=uid)<>upload.chunk_count then raise exception 'upload incomplete' using errcode='22023'; end if;
  if (select sum(jsonb_array_length(body)) from public.owner_upload_chunks where user_id=uid)>100000 then raise exception 'too many entities' using errcode='22023'; end if;
  select coalesce(jsonb_agg(e.item order by c.part,e.ordinality),'[]'::jsonb) into entities
    from public.owner_upload_chunks c cross join lateral jsonb_array_elements(c.body) with ordinality as e(item,ordinality) where c.user_id=uid;
  result=public.commit_owner_save(upload.save_id,upload.command_id,upload.expected_revision,upload.core,entities,upload.replace_save);
  delete from public.owner_uploads where user_id=uid;
  return result;
end;
$$;
revoke all on function public.begin_owner_upload(uuid,uuid,bigint,jsonb,boolean,integer),public.append_owner_upload(uuid,integer,jsonb),public.finish_owner_upload(uuid) from public,anon;
grant execute on function public.begin_owner_upload(uuid,uuid,bigint,jsonb,boolean,integer),public.append_owner_upload(uuid,integer,jsonb),public.finish_owner_upload(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
