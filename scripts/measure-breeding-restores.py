"""Replay the synthetic P5 five years through the real SQL RPC in disposable PostgreSQL."""
from pathlib import Path
import json,re,subprocess,time,uuid,os
root=Path(__file__).resolve().parent.parent
name='verdant-p5-restore-'+uuid.uuid4().hex[:8]
def run(args,**kw):return subprocess.run(args,text=True,capture_output=True,**kw)
def sql(query):
 p=run(['docker','exec','-i',name,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1','-At'],input=query)
 if p.returncode:raise RuntimeError(p.stderr[:1000])
 return p.stdout
try:
 p=run(['docker','run','--rm','-d','--name',name,'--memory','512m','-e','POSTGRES_PASSWORD=synthetic-metrics-only','postgres:17-alpine'])
 if p.returncode:raise RuntimeError('Could not start test database')
 for _ in range(60):
  if run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']).returncode==0:break
  time.sleep(.5)
 sql("create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key);grant usage on schema auth,public to anon,authenticated;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant execute on function auth.uid() to anon,authenticated;")
 for m in sorted((root/'supabase/migrations').glob('*.sql')):sql(m.read_text())
 owner=str(uuid.uuid4());sql("insert into auth.users values ('"+owner+"')")
 w=json.loads((root/'artifacts/p5-five-year-world.json').read_text())
 patches=[{'core':w['core'],'upserts':list(w['entities'].values())} for _ in range(4)]
 def literal(value):
  tag='$p_'+uuid.uuid4().hex+'$';return tag+json.dumps(value,ensure_ascii=False)+tag+'::jsonb'
 calls=[]
 staged=not os.environ.get('P5_DIRECT_RESTORE')
 for i,p in enumerate(patches):
  cid=str(uuid.uuid4())
  if not staged:
   calls.append("select public.commit_owner_save('%s','%s',%d,%s,%s,true);"%(p['core']['saveId'],cid,i,literal(p['core']),literal(p['upserts'])))
   continue
  chunks=[];chunk=[];size=2
  for e in p['upserts']:
   n=len(json.dumps(e,ensure_ascii=False,separators=(',',':')).encode())+1
   if size+n>1000000:chunks.append(chunk);chunk=[];size=2
   chunk.append(e);size+=n
  if chunk:chunks.append(chunk)
  calls.append("select public.begin_owner_upload('%s','%s',%d,%s,true,%d);"%(p['core']['saveId'],cid,i,literal(p['core']),len(chunks)))
  for j,part in enumerate(chunks):calls.append("select public.append_owner_upload('%s',%d,%s);"%(cid,j,literal(part)))
  calls.append("select 'staged_bytes:'||sum(pg_total_relation_size(oid)) from pg_class where relnamespace='public'::regnamespace and relname in ('owner_uploads','owner_upload_chunks');")
  calls.append("select public.finish_owner_upload('%s');"%cid)
 output=sql("set role authenticated;select set_config('request.jwt.claim.sub','"+owner+"',false);\n\\timing on\n"+'\n'.join(calls))
 timed_output=re.sub(r'staged_bytes:\d+\nTime: [\d.]+ ms\n','',output)
 times=sorted(float(t) for t in re.findall(r'Time: ([\d.]+) ms',timed_output))
 def sizes():return json.loads(sql("select jsonb_object_agg(relname,pg_total_relation_size(oid)) from pg_class where relnamespace='public'::regnamespace and relname in ('owner_saves','owner_entities','owner_commits','owner_checkpoints','owner_uploads','owner_upload_chunks')").strip())
 allocated=sizes();sql('vacuum (full, analyze)');compacted=sizes()
 read=sql("set role authenticated;select set_config('request.jwt.claim.sub','"+owner+"',false);\n\\timing on\nselect octet_length(public.load_owner_save()::text);")
 out={'kind':'PostgreSQL 17 in local Docker, four full five-year restore RPCs, 512 MiB Docker limit, three retained checkpoints; excludes Supabase platform/Auth overhead','restores':len(patches),'rpcCalls':sum('select public.' in call for call in calls),'staged':staged,'temporaryAllocatedPeakBytes':max([int(t) for t in re.findall(r'staged_bytes:(\d+)',output)] or [0]),'finalizeMs':[float(t) for t in re.findall(r'\{"revision": \d+\}\nTime: ([\d.]+) ms',output)],'writeP95Ms':times[int(len(times)*.95)],'loadMs':float(re.findall(r'Time: ([\d.]+) ms',read)[0]),'allocatedBytes':allocated,'allocatedTotalBytes':sum(allocated.values()),'afterVacuumFullBytes':compacted,'afterVacuumFullTotalBytes':sum(compacted.values())}
 (root/('artifacts/p5-staged-restore-db-metrics.json' if staged else 'artifacts/p5-direct-restore-db-metrics.json')).write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
finally:run(['docker','stop',name])
