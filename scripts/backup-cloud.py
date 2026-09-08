"""Encrypted game-table backup. Credentials and plaintext never enter logs or disk."""
from pathlib import Path
import argparse, datetime, json, os, secrets, subprocess, urllib.request, ssl
import certifi
REF = 'xkjyajarevvocitdgybk'
TABLES = ['owner_saves', 'owner_entities', 'owner_commits', 'owner_checkpoints']
ROOT = Path(__file__).resolve().parent.parent
DEST = Path.home() / 'Documents/Backups/verdant-owner'
def credential(service, account, create=False):
    p = subprocess.run(['security','find-generic-password','-s',service,'-a',account,'-w'],capture_output=True,text=True)
    if p.returncode == 0:
        value=p.stdout.strip()
        if value.startswith('go-keyring-base64:'):
            import base64
            value=base64.b64decode(value.split(':',1)[1]).decode()
        return value
    if not create: raise RuntimeError('Required Keychain credential unavailable: '+service)
    value = secrets.token_urlsafe(48)
    p = subprocess.run(['security','add-generic-password','-s',service,'-a',account,'-w',value],capture_output=True)
    if p.returncode: raise RuntimeError('Could not store backup key in Keychain')
    return value

def backup():
    token = credential('Supabase CLI','supabase')
    query = "select jsonb_build_object(" + ','.join("'%s',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.%s t)"%(t,t) for t in TABLES) + ",'auth_user_ids',(select coalesce(jsonb_agg(id),'[]'::jsonb) from auth.users)) as snapshot"
    request=urllib.request.Request('https://api.supabase.com/v1/projects/'+REF+'/database/query',data=json.dumps({'query':query}).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','User-Agent':'Supabase CLI/2.95.4'},method='POST')
    with urllib.request.urlopen(request,timeout=60,context=ssl.create_default_context(cafile=certifi.where())) as response: snapshot=json.load(response)[0]['snapshot']
    payload=json.dumps({'format':'verdant-operations-backup-v1','project':REF,'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'snapshot':snapshot},ensure_ascii=False).encode()
    if not snapshot['owner_saves'] and not snapshot['owner_entities']:
        raise RuntimeError('Unexpected empty backup; preserve the prior backup and inspect the project')
    key=credential('Verdant Owner Backup','verdant-owner',True)
    # Encrypt-then-MAC: AES-256-CBC/PBKDF2 plus HMAC-SHA256 authenticates ciphertext before decryption.
    env={**os.environ,'VERDANT_BACKUP_KEY':key}
    p=subprocess.run(['openssl','enc','-aes-256-cbc','-salt','-pbkdf2','-iter','200000','-pass','env:VERDANT_BACKUP_KEY'],input=payload,capture_output=True,env=env)
    if p.returncode: raise RuntimeError('Backup encryption failed')
    import hmac,hashlib
    mac=hmac.digest(hashlib.sha256(('mac:'+key).encode()).digest(),p.stdout,'sha256')
    DEST.mkdir(parents=True,exist_ok=True,mode=0o700)
    target=DEST/(datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'.vbackup')
    with target.open('xb') as f: os.chmod(target,0o600);f.write(b'VERDANT1'+mac+p.stdout)
    print(json.dumps({'encrypted_backup':str(target),'bytes':target.stat().st_size,'rows':{t:len(snapshot[t]) for t in TABLES}}))
    return target

def decrypt(path):
    import hmac,hashlib
    key=credential('Verdant Owner Backup','verdant-owner')
    raw=Path(path).read_bytes()
    if raw[:8]!=b'VERDANT1' or not hmac.compare_digest(raw[8:40],hmac.digest(hashlib.sha256(('mac:'+key).encode()).digest(),raw[40:],'sha256')): raise RuntimeError('Backup authentication failed')
    p=subprocess.run(['openssl','enc','-d','-aes-256-cbc','-pbkdf2','-iter','200000','-pass','env:VERDANT_BACKUP_KEY'],input=raw[40:],capture_output=True,env={**os.environ,'VERDANT_BACKUP_KEY':key})
    if p.returncode: raise RuntimeError('Backup decryption failed')
    data=json.loads(p.stdout)
    if data.get('format')!='verdant-operations-backup-v1' or data.get('project')!=REF: raise RuntimeError('Wrong backup project or format')
    return data

def verify(path):
    snapshot=decrypt(path)['snapshot']
    worlds=[]
    for save in snapshot['owner_saves']:
        entities={e['id']:e['body'] for e in snapshot['owner_entities'] if e['save_id']==save['id']}
        worlds.append({'core':save['core'],'entities':entities})
    code="import {validateWorld} from './src/domain/world.ts';let input='';for await(const chunk of process.stdin)input+=chunk;for(const w of JSON.parse(input))validateWorld(w);"
    p=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],input=json.dumps(worlds),text=True,capture_output=True,cwd=ROOT)
    if p.returncode:raise RuntimeError('Restored game-state validation failed')
    import uuid,time
    name='verdant-backup-check-'+uuid.uuid4().hex[:8]
    def run(args,**kw):return subprocess.run(args,capture_output=True,text=True,**kw)
    def sql(query):
        r=run(['docker','exec','-i',name,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1','-At'],input=query)
        if r.returncode:raise RuntimeError('Isolated database restore failed; plaintext error output suppressed')
        return r.stdout
    try:
        p=run(['docker','run','--rm','-d','--name',name,'-e','POSTGRES_PASSWORD=isolated-restore-only','postgres:17-alpine'])
        if p.returncode:raise RuntimeError('Restore-test database could not start')
        for _ in range(60):
            if run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']).returncode==0:break
            time.sleep(.5)
        sql("create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;")
        for m in sorted((ROOT/'supabase/migrations').glob('*.sql')):sql(m.read_text())
        for uid in snapshot['auth_user_ids']:
            uuid.UUID(uid)
            sql("insert into auth.users values ('"+uid+"')")
        for t in TABLES:
            # A fresh unpredictable dollar tag safely quotes arbitrary player text.
            literal=json.dumps(snapshot[t]);tag='$payload_'+uuid.uuid4().hex+'$'
            sql('insert into public.'+t+' select * from jsonb_populate_recordset(null::public.'+t+','+tag+literal+tag+'::jsonb)')
        for t in TABLES:
            if int(sql('select count(*) from public.'+t).strip())!=len(snapshot[t]):raise RuntimeError('Restored row count mismatch')
        print(json.dumps({'verified_backup':str(path),'valid_worlds':len(worlds),'database_restore':'passed','rows':{t:len(snapshot[t]) for t in TABLES}}))
    finally:run(['docker','stop',name])
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--verify');args=parser.parse_args()
    try: verify(args.verify) if args.verify else backup()
    except Exception as e: print(type(e).__name__+': backup operation failed; check service access/Keychain and retry');raise SystemExit(1)
