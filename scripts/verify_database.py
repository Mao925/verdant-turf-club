"""Test a dedicated, disposable PostgreSQL container. No cloud credentials."""
from pathlib import Path
import concurrent.futures, json, subprocess, time, uuid
root=Path(__file__).resolve().parent.parent
name='horse-p1-test-'+uuid.uuid4().hex[:10]
def run(args,**kwargs):
    return subprocess.run(args,text=True,capture_output=True,**kwargs)
def sql(text):
    return run(['docker','exec','-i',name,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1','-At'],input=text)
try:
    p=run(['docker','run','--rm','-d','--name',name,'-e','POSTGRES_PASSWORD=local-validation-only','postgres:17-alpine'])
    if p.returncode:raise RuntimeError(p.stderr)
    for _ in range(60):
        if run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']).returncode==0:break
        time.sleep(.5)
    else:raise RuntimeError('PostgreSQL did not start')
    bootstrap="""create role anon nologin;create role authenticated nologin;create schema auth;
create table auth.users(id uuid primary key);grant usage on schema auth,public to anon,authenticated;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant execute on function auth.uid() to anon,authenticated;"""
    for label,script in [('bootstrap',bootstrap),('migrations','\n'.join(p.read_text() for p in sorted((root/'supabase/migrations').glob('*.sql')))),('permissions, atomicity, idempotency, checkpoints',(root/'supabase/tests/owner_save.sql').read_text())]:
        p=sql(script)
        if p.returncode:raise RuntimeError(label+': '+p.stderr)
        print('PASS:',label,flush=True)
    core=json.dumps({'saveId':'30000000-0000-4000-8000-000000000003','schemaVersion':1,'engineVersion':'owner-p1','rulesetVersion':'foundation-2026','date':'2026-05-01'})
    def concurrent_command():
        cmd=str(uuid.uuid4())
        return sql(f"begin;set local role authenticated;select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);select public.commit_owner_save('30000000-0000-4000-8000-000000000003','{cmd}',7,'{core}','[]',false);commit;")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:concurrent_command(),range(2)))
    assert sum(r.returncode==0 for r in results)==1,'exactly one concurrent writer must win'
    assert any('revision conflict' in r.stderr for r in results),'losing writer must detect conflict'
    print('PASS: two concurrent database writers, exactly one revision accepted',flush=True)
finally:
    run(['docker','stop',name])
