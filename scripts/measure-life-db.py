"""Replay the synthetic P4 three years through the real SQL RPC in disposable PostgreSQL."""
from pathlib import Path
import json,re,subprocess,time,uuid
root=Path(__file__).resolve().parent.parent
name='verdant-p4-size-'+uuid.uuid4().hex[:8]
def run(args,**kw):return subprocess.run(args,text=True,capture_output=True,**kw)
def sql(query):
 p=run(['docker','exec','-i',name,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1','-At'],input=query)
 if p.returncode:raise RuntimeError(p.stderr[:1000])
 return p.stdout
try:
 p=run(['docker','run','--rm','-d','--name',name,'-e','POSTGRES_PASSWORD=synthetic-metrics-only','postgres:17-alpine'])
 if p.returncode:raise RuntimeError('Could not start test database')
 for _ in range(60):
  if run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']).returncode==0:break
  time.sleep(.5)
 sql("create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key);grant usage on schema auth,public to anon,authenticated;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant execute on function auth.uid() to anon,authenticated;")
 for m in sorted((root/'supabase/migrations').glob('*.sql')):sql(m.read_text())
 owner=str(uuid.uuid4());sql("insert into auth.users values ('"+owner+"')")
 patches=[json.loads(line) for line in (root/'artifacts/p4-three-year-patches.ndjson').read_text().splitlines()]
 def literal(value):
  tag='$p_'+uuid.uuid4().hex+'$';return tag+json.dumps(value,ensure_ascii=False)+tag+'::jsonb'
 calls=[]
 for i,p in enumerate(patches):calls.append("select public.commit_owner_save('%s','%s',%d,%s,%s,false);"%(p['core']['saveId'],uuid.uuid4(),i,literal(p['core']),literal(p['upserts'])))
 output=sql("set role authenticated;select set_config('request.jwt.claim.sub','"+owner+"',false);\n\\timing on\n"+'\n'.join(calls))
 times=sorted(float(t) for t in re.findall(r'Time: ([\d.]+) ms',output))
 def sizes():return json.loads(sql("select jsonb_object_agg(relname,pg_total_relation_size(oid)) from pg_class where relnamespace='public'::regnamespace and relname in ('owner_saves','owner_entities','owner_commits','owner_checkpoints')").strip())
 allocated=sizes();sql('vacuum (full, analyze)');compacted=sizes()
 read=sql("set role authenticated;select set_config('request.jwt.claim.sub','"+owner+"',false);\n\\timing on\nselect octet_length(public.load_owner_save()::text);")
 out={'kind':'PostgreSQL 17 in local Docker, actual three-year delta RPCs, three retained checkpoints; excludes Supabase platform/Auth overhead','commands':len(patches),'writeP95Ms':times[int(len(times)*.95)],'loadMs':float(re.findall(r'Time: ([\d.]+) ms',read)[0]),'allocatedBytes':allocated,'allocatedTotalBytes':sum(allocated.values()),'afterVacuumFullBytes':compacted,'afterVacuumFullTotalBytes':sum(compacted.values())}
 (root/'artifacts/p4-database-metrics.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
finally:run(['docker','stop',name])
