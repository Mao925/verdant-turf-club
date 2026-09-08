begin;
insert into auth.users(id) values('10000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');
create function pg_temp.check_ok(ok boolean,message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception '%',message;end if; end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$
declare
 sid uuid:='30000000-0000-4000-8000-000000000003';cid uuid:='40000000-0000-4000-8000-000000000004';
 core jsonb:='{"saveId":"30000000-0000-4000-8000-000000000003","schemaVersion":1,"engineVersion":"owner-p1","rulesetVersion":"foundation-2026","date":"2026-05-01"}';
 entities jsonb:='[{"id":"horse-1","kind":"horse","name":"before"}]';r jsonb; failed boolean;
begin
 r:=public.commit_owner_save(sid,cid,0,core,entities,false);
 perform pg_temp.check_ok((r->>'revision')::int=1,'initial revision');
 r:=public.commit_owner_save(sid,cid,0,core,entities,false);
 perform pg_temp.check_ok((r->>'revision')::int=1,'idempotent command');
 perform pg_temp.check_ok((select count(*) from public.owner_commits)=1,'no duplicate commit');
 failed:=false;begin perform public.commit_owner_save(sid,cid,0,core,'[{"id":"different","kind":"horse"}]',false);exception when sqlstate '22023' then failed:=true;end;
 perform pg_temp.check_ok(failed,'reject changed content with same command id');
 failed:=false;begin perform public.commit_owner_save(sid,'50000000-0000-4000-8000-000000000005',0,core,entities,false);exception when sqlstate '40001' then failed:=true;end;
 perform pg_temp.check_ok(failed,'reject stale revision');
 failed:=false;begin perform public.commit_owner_save(sid,'50000000-0000-4000-8000-000000000005',1,core,'[{"id":"horse-1","kind":"horse","name":"after"},{"id":"bad","kind":"unsupported"}]',false);exception when sqlstate '22023' then failed:=true;end;
 perform pg_temp.check_ok(failed,'invalid batch is rejected');
 perform pg_temp.check_ok((select body->>'name' from public.owner_entities where id='horse-1')='before','rollback includes first changed entity');
 perform pg_temp.check_ok((public.load_owner_save()->>'revision')::int=1,'rollback includes revision');
 failed:=false;begin update public.owner_saves set revision=100 where id=sid;exception when insufficient_privilege then failed:=true;end;
 perform pg_temp.check_ok(failed,'direct update denied');
 failed:=false;begin delete from public.owner_entities where save_id=sid;exception when insufficient_privilege then failed:=true;end;
 perform pg_temp.check_ok(failed,'direct delete denied');
 perform public.commit_owner_save(sid,'50000000-0000-4000-8000-000000000005',1,core,'[{"id":"horse-1","kind":"horse","name":"restored"}]',true);
 perform pg_temp.check_ok((select state#>>'{entities,horse-1,name}' from public.owner_checkpoints where revision=1)='before','restore protects old state');
 r:=public.commit_owner_save(sid,cid,0,core,entities,false);
 perform pg_temp.check_ok((r->>'revision')::int=2,'retry returns current committed head');
 for i in 2..6 loop perform public.commit_owner_save(sid,gen_random_uuid(),i,core,entities,true);end loop;
 perform pg_temp.check_ok((select count(*) from public.owner_checkpoints)=3,'checkpoint retention bounded');
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select pg_temp.check_ok((select count(*) from public.owner_saves)=0,'other owner cannot read head');
select pg_temp.check_ok((select count(*) from public.owner_entities)=0,'other owner cannot read entities');
select pg_temp.check_ok((select count(*) from public.owner_commits)=0,'other owner cannot read commands');
select pg_temp.check_ok((select count(*) from public.owner_checkpoints)=0,'other owner cannot read history');
select pg_temp.check_ok(public.load_owner_save() is null,'other owner load is empty');
do $$declare failed boolean:=false;begin
 begin perform public.commit_owner_save('30000000-0000-4000-8000-000000000003',gen_random_uuid(),0,'{"saveId":"30000000-0000-4000-8000-000000000003","schemaVersion":1,"engineVersion":"owner-p1","rulesetVersion":"foundation-2026"}','[{"id":"h","kind":"horse"}]',false);exception when insufficient_privilege then failed:=true;end;
 perform pg_temp.check_ok(failed,'other owner cannot claim an existing save');
end $$;
set local role anon;
do $$declare failed boolean:=false;begin
 begin perform public.load_owner_save();exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'anonymous RPC permitted';end if;
end $$;
reset role;
commit;
