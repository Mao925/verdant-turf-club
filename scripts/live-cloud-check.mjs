// Uses only a temporary test account, deletes it in finally, and never outputs credentials.
import { execFileSync, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
const ref='xkjyajarevvocitdgybk';
let token=execFileSync('security',['find-generic-password','-s','Supabase CLI','-a','supabase','-w'],{encoding:'utf8'}).trim();
if(token.startsWith('go-keyring-base64:'))token=Buffer.from(token.split(':')[1],'base64').toString();
async function management(path,method='GET',body){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw new Error(`Management request failed (${r.status})`);return r.json();}
const keys=await management('api-keys');
const serviceKey=keys.find(k=>k.name==='service_role')?.api_key;
if(!serviceKey)throw new Error('Service credential unavailable');
const url=`https://${ref}.supabase.co`;
const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
let uid;
try{
 const email=`p2-check-${crypto.randomUUID()}@example.invalid`;
 const {data,error}=await admin.auth.admin.createUser({email,password:crypto.randomUUID()+crypto.randomUUID(),email_confirm:true});
 if(error||!data.user)throw new Error('Could not create isolated test account');uid=data.user.id;
 const generated=await admin.auth.admin.generateLink({type:'magiclink',email});
 if(generated.error||!generated.data.properties?.hashed_token)throw new Error('Could not create isolated verification token');
 const client=createClient(url,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const verified=await client.auth.verifyOtp({token_hash:generated.data.properties.hashed_token,type:'magiclink'});
 if(verified.error||!verified.data.session)throw new Error('Could not establish isolated test session');
 console.log('Temporary real Supabase Auth session established (test email identity, not Google).');
 const result=spawnSync('npx',['playwright','test',process.env.P5_STORAGE_ONLY?'e2e/storage-live.spec.ts':'e2e/live.spec.ts'],{stdio:'inherit',env:{...process.env,P2_LIVE_URL:url,P2_LIVE_KEY:process.env.VITE_SUPABASE_PUBLISHABLE_KEY,P2_LIVE_SESSION:JSON.stringify(verified.data.session)}});
 if(result.status!==0)throw new Error('Live browser validation failed');
 console.log('Real service/browser checks passed.');
}finally{
 if(uid){
  let error;
  for(let attempt=0;attempt<3;attempt++){
   ({error}=await admin.auth.admin.deleteUser(uid));
   if(!error||error.status===404){error=null;break;}
   console.log('Temporary account cleanup retry:',attempt+1,'status:',error.status,'code:',error.code);
   if(attempt<2)await new Promise(resolve=>setTimeout(resolve,3000));
  }
  if(error)throw new Error('Test-account cleanup failed; targeted cleanup is required');
  console.log('Temporary account and its save removed.');
 }
}
