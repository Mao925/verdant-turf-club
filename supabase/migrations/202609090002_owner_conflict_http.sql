-- Business revision conflicts are HTTP 409, not PostgreSQL serialization failures.
begin;
create or replace function public.commit_owner_save(p_save_id uuid,p_command_id uuid,p_expected_revision bigint,p_core jsonb,p_upserts jsonb,p_replace boolean default false) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  uid uuid:=auth.uid(); head public.owner_saves; old_request jsonb; body jsonb; item jsonb; new_revision bigint; output jsonb;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_save_id is null or p_command_id is null or p_expected_revision is null or p_expected_revision<0 or p_replace is null then raise exception 'invalid command' using errcode='22023'; end if;
  if p_core is null or jsonb_typeof(p_core)<>'object' or p_upserts is null or jsonb_typeof(p_upserts)<>'array' then raise exception 'invalid payload' using errcode='22023'; end if;
  if (p_core->>'saveId') is distinct from p_save_id::text or (p_core->>'schemaVersion') is distinct from '1' or not (((p_core->>'engineVersion') is not distinct from 'owner-p1' and (p_core->>'rulesetVersion') is not distinct from 'foundation-2026') or ((p_core->>'engineVersion') is not distinct from 'owner-p2' and (p_core->>'rulesetVersion') is not distinct from 'prototype-2026')) then raise exception 'unsupported save version' using errcode='22023'; end if;
  if octet_length(p_core::text)>32768 or octet_length(p_upserts::text)>20000000 or jsonb_array_length(p_upserts)>100000 then raise exception 'payload too large' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_upserts) e group by e->>'id' having count(*)>1) then raise exception 'duplicate entities' using errcode='22023'; end if;
  -- A user has one active save in P1. The unique constraint also serializes two new tabs.
  select * into head from public.owner_saves where user_id=uid for update;
  if not found then
    if p_expected_revision<>0 then raise exception 'save no longer exists' using errcode='PT409'; end if;
    if exists(select 1 from public.owner_saves where id=p_save_id) then raise exception 'save inaccessible' using errcode='42501'; end if;
    insert into public.owner_saves(id,user_id,core) values(p_save_id,uid,p_core) on conflict(user_id) do nothing;
    select * into head from public.owner_saves where user_id=uid for update;
  end if;
  if head.id<>p_save_id then raise exception 'another save exists' using errcode='PT409'; end if;
  -- Store only a hash-sized canonical request fingerprint, not a duplicate of all changed entities.
  body=jsonb_build_object('core',encode(sha256(convert_to(p_core::text,'UTF8')),'hex'),'upserts',encode(sha256(convert_to(p_upserts::text,'UTF8')),'hex'),'expected',p_expected_revision,'replace',p_replace);
  select request_body into old_request from public.owner_commits where save_id=p_save_id and command_id=p_command_id;
  if found then
    if old_request<>body then raise exception 'command id reused with different content' using errcode='22023'; end if;
    return jsonb_build_object('revision',head.revision);
  end if;
  if head.revision<>p_expected_revision then raise exception 'revision conflict' using errcode='PT409'; end if;
  if head.revision=0 and jsonb_array_length(p_upserts)=0 then raise exception 'empty save' using errcode='22023'; end if;
  -- Every restore retains the current version; ordinary writes checkpoint at a bounded interval.
  if head.revision>0 and (p_replace or head.revision%20=0) then
    insert into public.owner_checkpoints(save_id,revision,state) values(head.id,head.revision,(public.load_owner_save()->'state')) on conflict do nothing;
  end if;
  if p_replace then delete from public.owner_entities where save_id=p_save_id; end if;
  for item in select value from jsonb_array_elements(p_upserts) loop
    if jsonb_typeof(item)<>'object' or item->>'id' is null or (item->>'id')!~'^[a-zA-Z0-9:_-]{1,150}$' or (item->>'id') in ('__proto__','constructor','prototype') or (item->>'kind') not in ('horse','contract','ledger','event','market','invoice','consultation','race') or item->>'kind' is null then raise exception 'invalid entity' using errcode='22023'; end if;
    insert into public.owner_entities(save_id,id,body) values(p_save_id,item->>'id',item) on conflict(save_id,id) do update set body=excluded.body;
  end loop;
  new_revision=head.revision+1;
  update public.owner_saves set revision=new_revision,core=p_core,updated_at=now() where id=p_save_id;
  insert into public.owner_commits(save_id,command_id,request_body,revision) values(p_save_id,p_command_id,body,new_revision);
  delete from public.owner_checkpoints where save_id=p_save_id and revision not in(select revision from public.owner_checkpoints where save_id=p_save_id order by revision desc limit 3);
  output=jsonb_build_object('revision',new_revision);
  return output;
end;
$$;
commit;
