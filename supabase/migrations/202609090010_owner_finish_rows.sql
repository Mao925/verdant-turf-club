-- Finalize staged rows without reconstructing a large JSONB entity array.
-- Keep the legacy commit fingerprint, CAS, exact checkpoints and one transaction.
begin;
create or replace function public.finish_owner_upload(p_command_id uuid) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='30s'
as $$
declare
 uid uuid:=auth.uid(); upload public.owner_uploads; head public.owner_saves;
 fingerprint jsonb; old_request jsonb; entity_count bigint; new_revision bigint;
begin
 if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,581));
 select * into upload from public.owner_uploads where user_id=uid for update;
 if not found or upload.command_id is distinct from p_command_id then raise exception 'upload replaced or missing' using errcode='PT409'; end if;
 if (select count(*) from public.owner_upload_chunks where user_id=uid)<>upload.chunk_count then raise exception 'upload incomplete' using errcode='22023'; end if;
 select sum(jsonb_array_length(body)) into entity_count from public.owner_upload_chunks where user_id=uid;
 if entity_count>100000 then raise exception 'too many entities' using errcode='22023'; end if;
  if (upload.core->>'saveId') is distinct from upload.save_id::text or (upload.core->>'schemaVersion') is distinct from '1' or not (((upload.core->>'engineVersion') is not distinct from 'owner-p1' and (upload.core->>'rulesetVersion') is not distinct from 'foundation-2026') or ((upload.core->>'engineVersion') is not distinct from 'owner-p2' and (upload.core->>'rulesetVersion') is not distinct from 'prototype-2026') or ((upload.core->>'engineVersion') is not distinct from 'owner-p3' and (upload.core->>'rulesetVersion') is not distinct from 'calendar-2026') or ((upload.core->>'engineVersion') is not distinct from 'owner-p4' and (upload.core->>'rulesetVersion') is not distinct from 'life-2026') or ((upload.core->>'engineVersion') is not distinct from 'owner-p5' and (upload.core->>'rulesetVersion') is not distinct from 'breeding-2026')) then raise exception 'unsupported save version' using errcode='22023'; end if;
 if exists(select 1 from public.owner_upload_chunks c cross join lateral jsonb_array_elements(c.body) e(item) where c.user_id=uid group by item->>'id' having count(*)>1) then raise exception 'duplicate entities' using errcode='22023'; end if;
 select * into head from public.owner_saves where user_id=uid for update;
 if not found then
   if upload.expected_revision<>0 then raise exception 'save no longer exists' using errcode='PT409'; end if;
   if exists(select 1 from public.owner_saves where id=upload.save_id) then raise exception 'save inaccessible' using errcode='42501'; end if;
   insert into public.owner_saves(id,user_id,core) values(upload.save_id,uid,upload.core) on conflict(user_id) do nothing;
   select * into head from public.owner_saves where user_id=uid for update;
 end if;
 if head.id<>upload.save_id then raise exception 'another save exists' using errcode='PT409'; end if;
 -- jsonb array text uses comma-space separators. Joining nonempty chunk interiors
 -- is byte-identical to the legacy full-array ::text, including escaped content.
 select jsonb_build_object(
   'core',encode(sha256(convert_to(upload.core::text,'UTF8')),'hex'),
   'upserts',encode(sha256(convert_to('['||coalesce(string_agg(substring(c.body::text from 2 for length(c.body::text)-2),', ' order by c.part) filter(where jsonb_array_length(c.body)>0),'')||']','UTF8')),'hex'),
   'expected',upload.expected_revision,'replace',upload.replace_save
 ) into fingerprint from public.owner_upload_chunks c where c.user_id=uid;
 select request_body into old_request from public.owner_commits where save_id=upload.save_id and command_id=p_command_id;
 if found then
   if old_request<>fingerprint then raise exception 'command id reused with different content' using errcode='22023'; end if;
   delete from public.owner_uploads where user_id=uid;
   return jsonb_build_object('revision',head.revision);
 end if;
 if head.revision<>upload.expected_revision then raise exception 'revision conflict' using errcode='PT409'; end if;
 if head.revision=0 and entity_count=0 then raise exception 'empty save' using errcode='22023'; end if;
 if exists (
   select 1 from public.owner_upload_chunks c cross join lateral jsonb_array_elements(c.body) e(item)
   where c.user_id=uid and (
     jsonb_typeof(item)<>'object' or item->>'id' is null
     or (item->>'id')!~'^[a-zA-Z0-9:_-]{1,150}$'
     or (item->>'id') in ('__proto__','constructor','prototype')
     or (item->>'kind') not in ('horse','contract','ledger','event','market','invoice','consultation','race','npc-owner','health','placement','scene','breeding')
     or item->>'kind' is null
   )
 ) then raise exception 'invalid entity' using errcode='22023'; end if;
 if head.revision>0 and (upload.replace_save or head.revision%20=0) then
   insert into public.owner_checkpoints(save_id,revision,state) values(head.id,head.revision,json_build_object('core',head.core,'entities',coalesce((select json_object_agg(e.id,e.body) from public.owner_entities e where e.save_id=head.id),'{}'::json))::jsonb) on conflict do nothing;
 end if;
 if upload.replace_save then
   with incoming as materialized (
     select item->>'id' as id from public.owner_upload_chunks c cross join lateral jsonb_array_elements(c.body) e(item) where c.user_id=uid
   )
   delete from public.owner_entities e where e.save_id=upload.save_id and not exists(select 1 from incoming n where n.id=e.id);
 end if;
 insert into public.owner_entities(save_id,id,body)
   select upload.save_id,item->>'id',item from public.owner_upload_chunks c cross join lateral jsonb_array_elements(c.body) e(item) where c.user_id=uid
   on conflict(save_id,id) do update set body=excluded.body where owner_entities.body is distinct from excluded.body;
 new_revision=head.revision+1;
 update public.owner_saves set revision=new_revision,core=upload.core,updated_at=now() where id=upload.save_id;
 insert into public.owner_commits(save_id,command_id,request_body,revision) values(upload.save_id,p_command_id,fingerprint,new_revision);
 delete from public.owner_checkpoints where save_id=upload.save_id and revision not in(select revision from public.owner_checkpoints where save_id=upload.save_id order by revision desc limit 3);
 delete from public.owner_uploads where user_id=uid;
 return jsonb_build_object('revision',new_revision);
end;
$$;
notify pgrst,'reload schema';
commit;
