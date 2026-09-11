import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  assertCredentialCurrent,
  SessionError,
  signSessionV4,
  verifySignedSessionV4,
} from '../_shared/session-v4.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const PBKDF2_ITERATIONS = 210_000;
const COLORS = new Set(['violet','blue','mint','orange','pink','lime','gray']);
const ALLOWED_ORIGINS = new Set([
  'https://miiduoa.github.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5500',
]);

class ApiError extends Error { status:number; code:string; constructor(status:number, message:string, code='BAD_REQUEST'){ super(message); this.status=status; this.code=code; } }
function cors(req:Request){ const origin=req.headers.get('origin')||''; return {
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://miiduoa.github.io',
  'Vary':'Origin',
  'Access-Control-Allow-Headers':'authorization, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Cache-Control':'no-store',
}; }

function b64url(bytes: Uint8Array) { let s=''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function fromB64url(s:string) { s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; const raw=atob(s), out=new Uint8Array(raw.length); for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i); return out; }
async function hmac(message:string) { const key=await crypto.subtle.importKey('raw',enc.encode(SERVICE_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(message))); }
function equalBytes(a:Uint8Array,b:Uint8Array){ if(a.length!==b.length)return false; let diff=0; for(let i=0;i<a.length;i++)diff|=a[i]^b[i]; return diff===0; }
function sessionApiError(error:unknown):ApiError{ if(error instanceof SessionError)return new ApiError(401,error.message,error.code); return new ApiError(401,'登入狀態無效，請重新登入','UNAUTHORIZED'); }
async function requireUser(req:Request){
  const auth=req.headers.get('authorization')||''; const token=auth.startsWith('Bearer ')?auth.slice(7):'';
  let session; try{ session=await verifySignedSessionV4(token,SERVICE_KEY); }catch(error){ throw sessionApiError(error); }
  const {data:user,error}=await db.from('puplan_app_users').select('id,email,display_name,username,avatar_data,bio,discoverable,password_salt,password_hash,recovery_salt,recovery_hash').eq('id',session.uid).maybeSingle();
  if(error)throw error; if(!user)throw new ApiError(401,'找不到帳號','UNAUTHORIZED');
  try{ await assertCredentialCurrent(session,user.password_salt||''); }catch(credentialError){ throw sessionApiError(credentialError); }
  return user;
}
function randomSalt(){ const x=new Uint8Array(16); crypto.getRandomValues(x); return b64url(x); }
async function passwordHash(password:string,salt:string){ const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']); const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:fromB64url(salt),iterations:PBKDF2_ITERATIONS},key,256); return b64url(new Uint8Array(bits)); }
async function checkPassword(password:string,salt:string,expected:string){ if(!salt||!expected)return false; const got=fromB64url(await passwordHash(password,salt)); return equalBytes(got,fromB64url(expected)); }
async function rateLimit(req:Request,action:string,limit:number,minutes:number){
  const ip=(req.headers.get('x-forwarded-for')||req.headers.get('cf-connecting-ip')||'unknown').split(',')[0].trim();
  const rateKey=b64url(await hmac(`rate:${ip}`)); const since=new Date(Date.now()-minutes*60_000).toISOString();
  const {count,error}=await db.from('puplan_app_rate_limits').select('id',{count:'exact',head:true}).eq('rate_key',rateKey).eq('action',action).gte('created_at',since);
  if(error)throw error;
  if((count||0)>=limit)throw new ApiError(429,'操作太頻繁，請稍後再試','RATE_LIMITED');
  const inserted=await db.from('puplan_app_rate_limits').insert({rate_key:rateKey,action});
  if(inserted.error)throw inserted.error;
}
function cleanUsername(v:any){ return String(v||'').trim().replace(/^@/,'').toLowerCase(); }
function cleanName(v:any){ return String(v||'').trim().slice(0,24); }
function cleanEmail(v:any){ return String(v||'').trim().toLowerCase().slice(0,254); }
function cleanBio(v:any){ return String(v||'').trim().slice(0,120); }
function cleanText(v:any,n=80){ return String(v||'').trim().slice(0,n); }
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validUuid(v:any){ return UUID_RE.test(String(v||'')); }
function cleanAvatar(v:any){ const s=String(v||''); if(!s)return ''; if(!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(s))throw new ApiError(400,'頭像格式不正確'); if(s.length>180000)throw new ApiError(400,'頭像檔案太大'); return s; }
function publicProfile(u:any){ return {id:u.id,display_name:u.display_name,username:u.username,avatar_data:u.avatar_data||'',bio:u.bio||'',discoverable:u.discoverable!==false}; }
function validateCourses(value:any){
  if(!Array.isArray(value)||value.length>80)throw new ApiError(400,'課表資料格式不正確');
  return value.map((c:any)=>{ let day=Number(c.day),start=Number(c.start),end=Number(c.end); if(!Number.isInteger(day)||day<0||day>5)throw new ApiError(400,'課程星期格式不正確'); if(day===0){start=0;end=0}else if(!Number.isInteger(start)||start<1||start>13||!Number.isInteger(end)||end<start||end>13)throw new ApiError(400,'課程時間格式不正確'); const name=String(c.name||'').trim().slice(0,100); if(!name)throw new ApiError(400,'課程名稱不能空白'); return {id:String(c.id||crypto.randomUUID()).slice(0,80),name,day,start,end,teacher:String(c.teacher||'').trim().slice(0,80),room:String(c.room||'').trim().slice(0,80),color:COLORS.has(c.color)?c.color:'gray'}; });
}
function defaultSemester(){ const d=new Date(); const y=d.getUTCFullYear(),m=d.getUTCMonth()+1; const roc=(m>=8?y-1911:y-1912); const sem=(m>=8||m===1)?1:2; return {semester_key:`${roc}-${sem}`,label:`${roc} 學年度・第 ${sem} 學期`}; }
function semesterPublic(s:any){ return {id:s.id,semester_key:s.semester_key,label:s.label,school:s.school||'',department:s.department||'',class_name:s.class_name||'',credits:Number(s.credits||0),is_current:!!s.is_current,updated_at:s.updated_at,courses:Array.isArray(s.courses)?s.courses:[]}; }
async function semesterRows(uid:string){ const {data,error}=await db.from('puplan_app_semesters').select('id,user_id,semester_key,label,school,department,class_name,credits,courses,is_current,updated_at').eq('user_id',uid).order('is_current',{ascending:false}).order('updated_at',{ascending:false}); if(error)throw error; return data||[]; }
async function ensureCurrentSemester(uid:string, legacyCourses:any[]=[]){ let rows=await semesterRows(uid); if(!rows.length){ const d=defaultSemester(); const {data,error}=await db.from('puplan_app_semesters').insert({user_id:uid,...d,courses:Array.isArray(legacyCourses)?legacyCourses:[],is_current:true}).select('*').single(); if(error)throw error; rows=[data]; }
  let active=rows.find((s:any)=>s.is_current); if(!active){ const fallback=rows[0]; if(!fallback)throw new ApiError(500,'無法建立目前學期','SEMESTER_STATE_INVALID'); active=fallback; await db.from('puplan_app_semesters').update({is_current:false}).eq('user_id',uid); await db.from('puplan_app_semesters').update({is_current:true,updated_at:new Date().toISOString()}).eq('id',active.id); active={...active,is_current:true}; const activeId=active.id; rows=rows.map((s:any)=>({...s,is_current:s.id===activeId})); }
  return {rows,active};
}
async function semesterBundle(uid:string){ const {data:legacy}=await db.from('puplan_app_schedules').select('courses').eq('user_id',uid).maybeSingle(); const {rows,active}=await ensureCurrentSemester(uid,legacy?.courses||[]); return {semesters:rows.map(semesterPublic),active_semester:semesterPublic(active),courses:Array.isArray(active.courses)?active.courses:[]}; }
async function mirrorLegacy(uid:string,courses:any[]){ await db.from('puplan_app_schedules').upsert({user_id:uid,courses,updated_at:new Date().toISOString()},{onConflict:'user_id'}); }
async function areFriends(a:string,b:string){
  const [outgoing,incoming]=await Promise.all([
    db.from('puplan_app_friendships').select('id').eq('status','accepted').eq('requester_id',a).eq('addressee_id',b).limit(1),
    db.from('puplan_app_friendships').select('id').eq('status','accepted').eq('requester_id',b).eq('addressee_id',a).limit(1),
  ]);
  if(outgoing.error)throw outgoing.error;
  if(incoming.error)throw incoming.error;
  return !!outgoing.data?.length||!!incoming.data?.length;
}
async function social(uid:string){
  const {data:rels,error}=await db.from('puplan_app_friendships').select('id,requester_id,addressee_id,status,created_at,updated_at').or(`requester_id.eq.${uid},addressee_id.eq.${uid}`).order('created_at',{ascending:false}); if(error)throw error;
  const relationships=rels||[]; const ids=[...new Set(relationships.flatMap((r:any)=>[r.requester_id,r.addressee_id]).filter((id:string)=>id!==uid))];
  const profiles:any[]=[]; if(ids.length){ const {data,error}=await db.from('puplan_app_users').select('id,display_name,username,avatar_data,bio,discoverable').in('id',ids); if(error)throw error; profiles.push(...(data||[])); }
  const accepted=relationships.filter((r:any)=>r.status==='accepted'); const friendIds=accepted.map((r:any)=>r.requester_id===uid?r.addressee_id:r.requester_id); const schedules:any[]=[];
  if(friendIds.length){ const {data,error}=await db.from('puplan_app_semesters').select('user_id,courses,updated_at,semester_key,label').in('user_id',friendIds).eq('is_current',true); if(error)throw error; schedules.push(...(data||[])); }
  const {data:meetupRows,error:meetErr}=await db.from('puplan_app_meetups').select('id,creator_id,invitee_id,kind,day,start_period,end_period,note,status,created_at,updated_at').or(`creator_id.eq.${uid},invitee_id.eq.${uid}`).order('created_at',{ascending:false}).limit(100); if(meetErr)throw meetErr;
  const pmap=new Map(profiles.map((p:any)=>[p.id,p])); const smap=new Map(schedules.map((s:any)=>[s.user_id,s]));
  const friends=friendIds.map((id:string)=>{const p:any=pmap.get(id)||{display_name:'好友',username:'',avatar_data:'',bio:''}; const s:any=smap.get(id); return {id,name:p.display_name,username:p.username,avatar:p.avatar_data||'',bio:p.bio||'',courses:Array.isArray(s?.courses)?s.courses:[],semester_key:s?.semester_key||'',semester_label:s?.label||'',t:s?.updated_at||new Date().toISOString(),cloud:true};});
  return {relationships,profiles:profiles.map(publicProfile),friends,meetups:meetupRows||[]};
}
function recoveryCode(){ const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const bytes=new Uint8Array(16); crypto.getRandomValues(bytes); let s=''; for(let i=0;i<16;i++){ if(i&&i%4===0)s+='-'; s+=alphabet[bytes[i]%alphabet.length]; } return s; }

Deno.serve(async (req:Request)=>{
  const origin=req.headers.get('origin')||'';
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors(req),'Content-Type':'application/json; charset=utf-8'}});
  if(req.method==='OPTIONS'){ if(origin&&!ALLOWED_ORIGINS.has(origin))return new Response('forbidden',{status:403}); return new Response('ok',{headers:cors(req)}); }
  if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  if(origin&&!ALLOWED_ORIGINS.has(origin))return json({error:'ORIGIN_NOT_ALLOWED',message:'來源不允許'},403);
  try{
    const body=await req.json().catch(()=>({})); const action=String(body.action||'');
    if(action==='signup'){
      await rateLimit(req,'signup',5,10); const display_name=cleanName(body.display_name),username=cleanUsername(body.username),email=cleanEmail(body.email),password=String(body.password||'');
      if(!display_name)throw new ApiError(400,'請輸入顯示名稱'); if(!/^[a-z0-9_.]{2,24}$/.test(username))throw new ApiError(400,'@帳號需 2–24 字，只能英文、數字、底線、句點'); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new ApiError(400,'Email 格式不正確'); if(password.length<8||password.length>128)throw new ApiError(400,'密碼至少 8 個字元');
      const [ue,ee]=await Promise.all([db.from('puplan_app_users').select('id').ilike('username',username).maybeSingle(),db.from('puplan_app_users').select('id').ilike('email',email).maybeSingle()]); if(ue.data)throw new ApiError(409,'這個 @帳號已有人使用','USERNAME_TAKEN'); if(ee.data)throw new ApiError(409,'這個 Email 已註冊','EMAIL_TAKEN');
      const salt=randomSalt(),hash=await passwordHash(password,salt); const {data:u,error}=await db.from('puplan_app_users').insert({email,display_name,username,password_salt:salt,password_hash:hash,avatar_data:'',bio:'',discoverable:true}).select('id,email,display_name,username,avatar_data,bio,discoverable').single(); if(error){ if(error.code==='23505')throw new ApiError(409,'Email 或 @帳號已被使用','DUPLICATE'); throw error; }
      const d=defaultSemester(); await Promise.all([db.from('puplan_app_schedules').insert({user_id:u.id,courses:[]}),db.from('puplan_app_semesters').insert({user_id:u.id,...d,courses:[],is_current:true})]); const token=await signSessionV4(u.id,salt,SERVICE_KEY); const bundle=await semesterBundle(u.id); return json({token,profile:publicProfile(u),...bundle,social:{relationships:[],profiles:[],friends:[],meetups:[]}});
    }
    if(action==='login'){
      await rateLimit(req,'login',20,5); const email=cleanEmail(body.email),password=String(body.password||'');
      if(!password||password.length>128)throw new ApiError(401,'Email 或密碼錯誤','INVALID_LOGIN');
      const {data:u,error}=await db.from('puplan_app_users').select('id,email,display_name,username,avatar_data,bio,discoverable,password_salt,password_hash').ilike('email',email).maybeSingle();
      if(!u||!(await checkPassword(password,u.password_salt,u.password_hash)))throw new ApiError(401,'Email 或密碼錯誤','INVALID_LOGIN'); const token=await signSessionV4(u.id,u.password_salt,SERVICE_KEY); const bundle=await semesterBundle(u.id); return json({token,profile:publicProfile(u),...bundle,social:await social(u.id)});
    }
    if(action==='recover_password'){
      await rateLimit(req,'recover',8,15); const email=cleanEmail(body.email),code=String(body.recovery_code||'').trim().toUpperCase(),newPassword=String(body.new_password||''); if(newPassword.length<8||newPassword.length>128)throw new ApiError(400,'新密碼至少 8 個字元'); if(!code||code.length>64)throw new ApiError(400,'Email 或救援碼不正確','INVALID_RECOVERY'); const {data:u}=await db.from('puplan_app_users').select('id,recovery_salt,recovery_hash').ilike('email',email).maybeSingle(); if(!u||!u.recovery_salt||!u.recovery_hash||!(await checkPassword(code,u.recovery_salt,u.recovery_hash)))throw new ApiError(400,'Email 或救援碼不正確','INVALID_RECOVERY'); const salt=randomSalt(),hash=await passwordHash(newPassword,salt); await db.from('puplan_app_users').update({password_salt:salt,password_hash:hash,recovery_salt:null,recovery_hash:null,recovery_created_at:null,updated_at:new Date().toISOString()}).eq('id',u.id); return json({ok:true,message:'密碼已重設，請使用新密碼登入'});
    }
    const user=await requireUser(req);
    if(action==='bootstrap'){ const bundle=await semesterBundle(user.id); return json({profile:publicProfile(user),...bundle,social:await social(user.id)}); }
    if(action==='update_profile'){
      const display_name=cleanName(body.display_name),username=cleanUsername(body.username),bio=cleanBio(body.bio),discoverable=body.discoverable!==false; const avatar_data=body.avatar_data===undefined?user.avatar_data:cleanAvatar(body.avatar_data);
      if(!display_name)throw new ApiError(400,'請輸入顯示名稱'); if(!/^[a-z0-9_.]{2,24}$/.test(username))throw new ApiError(400,'@帳號格式不正確');
      const {data:u,error}=await db.from('puplan_app_users').update({display_name,username,bio,avatar_data,discoverable,updated_at:new Date().toISOString()}).eq('id',user.id).select('id,display_name,username,avatar_data,bio,discoverable').single(); if(error){if(error.code==='23505')throw new ApiError(409,'這個 @帳號已有人使用','USERNAME_TAKEN');throw error;} return json({profile:publicProfile(u)});
    }
    if(action==='semesters'){ return json(await semesterBundle(user.id)); }
    if(action==='upsert_semester'){
      const key=cleanText(body.semester_key,24); if(!/^[0-9A-Za-z_-]{2,24}$/.test(key))throw new ApiError(400,'學期代碼格式不正確'); const label=cleanText(body.label,60)||key,school=cleanText(body.school,80),department=cleanText(body.department,80),class_name=cleanText(body.class_name,80),credits=Math.max(0,Math.min(60,Number(body.credits)||0)),setCurrent=body.set_current!==false;
      const {data:existing}=await db.from('puplan_app_semesters').select('id,courses').eq('user_id',user.id).eq('semester_key',key).maybeSingle(); if(setCurrent)await db.from('puplan_app_semesters').update({is_current:false}).eq('user_id',user.id);
      let row:any; if(existing){ const {data,error}=await db.from('puplan_app_semesters').update({label,school,department,class_name,credits,is_current:setCurrent,updated_at:new Date().toISOString()}).eq('id',existing.id).select('*').single(); if(error)throw error; row=data; } else { const {data,error}=await db.from('puplan_app_semesters').insert({user_id:user.id,semester_key:key,label,school,department,class_name,credits,courses:[],is_current:setCurrent}).select('*').single(); if(error)throw error; row=data; }
      const bundle=await semesterBundle(user.id); if(setCurrent)await mirrorLegacy(user.id,bundle.courses); return json({...bundle,semester:semesterPublic(row)});
    }
    if(action==='switch_semester'){
      const key=cleanText(body.semester_key,24); const {data:s}=await db.from('puplan_app_semesters').select('id').eq('user_id',user.id).eq('semester_key',key).maybeSingle(); if(!s)throw new ApiError(404,'找不到這個學期'); await db.from('puplan_app_semesters').update({is_current:false}).eq('user_id',user.id); await db.from('puplan_app_semesters').update({is_current:true,updated_at:new Date().toISOString()}).eq('id',s.id); const bundle=await semesterBundle(user.id); await mirrorLegacy(user.id,bundle.courses); return json(bundle);
    }
    if(action==='delete_semester'){
      const key=cleanText(body.semester_key,24); const rows=await semesterRows(user.id); if(rows.length<=1)throw new ApiError(400,'至少要保留一個學期'); const target=rows.find((x:any)=>x.semester_key===key); if(!target)throw new ApiError(404,'找不到這個學期'); await db.from('puplan_app_semesters').delete().eq('id',target.id).eq('user_id',user.id); if(target.is_current){ const remaining=(await semesterRows(user.id))[0]; await db.from('puplan_app_semesters').update({is_current:true}).eq('id',remaining.id); }
      const bundle=await semesterBundle(user.id); await mirrorLegacy(user.id,bundle.courses); return json(bundle);
    }
    if(action==='save_schedule'){ const courses=validateCourses(body.courses); const key=cleanText(body.semester_key,24); let target:any=null; if(key){ const {data}=await db.from('puplan_app_semesters').select('id').eq('user_id',user.id).eq('semester_key',key).maybeSingle(); target=data; } if(!target){ const {active}=await ensureCurrentSemester(user.id); target=active; } const {error}=await db.from('puplan_app_semesters').update({courses,updated_at:new Date().toISOString()}).eq('id',target.id).eq('user_id',user.id); if(error)throw error; if(target.is_current!==false)await mirrorLegacy(user.id,courses); return json({ok:true}); }
    if(action==='change_password'){ const current=String(body.current_password||''),next=String(body.new_password||''); if(next.length<8||next.length>128)throw new ApiError(400,'新密碼至少 8 個字元'); if(!current||current.length>128||!(await checkPassword(current,user.password_salt,user.password_hash)))throw new ApiError(400,'目前密碼不正確'); const salt=randomSalt(),hash=await passwordHash(next,salt); await db.from('puplan_app_users').update({password_salt:salt,password_hash:hash,updated_at:new Date().toISOString()}).eq('id',user.id); return json({ok:true,token:await signSessionV4(user.id,salt,SERVICE_KEY)}); }
    if(action==='rotate_recovery_code'){ const code=recoveryCode(),salt=randomSalt(),hash=await passwordHash(code,salt); await db.from('puplan_app_users').update({recovery_salt:salt,recovery_hash:hash,recovery_created_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',user.id); return json({recovery_code:code}); }
    if(action==='search_people'){
      await rateLimit(req,'search',120,5); const term=String(body.query||'').trim().replace(/^@/,'').replace(/[%,()]/g,'').slice(0,24); if(term.length<2)return json({people:[]});
      const columns='id,display_name,username,avatar_data,bio,discoverable'; const [a,b]=await Promise.all([db.from('puplan_app_users').select(columns).eq('discoverable',true).ilike('display_name',`%${term}%`).neq('id',user.id).limit(10),db.from('puplan_app_users').select(columns).eq('discoverable',true).ilike('username',`%${term}%`).neq('id',user.id).limit(10)]); const map=new Map<string,any>(); [...(a.data||[]),...(b.data||[])].forEach((p:any)=>map.set(p.id,p)); return json({people:[...map.values()].slice(0,10).map(publicProfile)});
    }
    if(action==='social')return json({social:await social(user.id)});
    if(action==='send_request'){
      const target=String(body.user_id||''); if(!validUuid(target)||target===user.id)throw new ApiError(400,'好友資料不正確'); const {data:targetUser}=await db.from('puplan_app_users').select('id,discoverable').eq('id',target).maybeSingle(); if(!targetUser||targetUser.discoverable===false)throw new ApiError(404,'找不到這個使用者');
      const {error}=await db.from('puplan_app_friendships').insert({requester_id:user.id,addressee_id:target,status:'pending'}); if(error){if(error.code==='23505')throw new ApiError(409,'你們已經有好友關係或邀請','RELATION_EXISTS');throw error;} return json({ok:true,social:await social(user.id)});
    }
    if(action==='accept_request'){
      const id=Number(body.friendship_id); const {data:r}=await db.from('puplan_app_friendships').select('id').eq('id',id).eq('addressee_id',user.id).eq('status','pending').maybeSingle(); if(!r)throw new ApiError(404,'找不到這筆好友邀請'); const {error}=await db.from('puplan_app_friendships').update({status:'accepted',updated_at:new Date().toISOString()}).eq('id',id); if(error)throw error; return json({ok:true,social:await social(user.id)});
    }
    if(action==='decline_request'){
      const id=Number(body.friendship_id); const {error}=await db.from('puplan_app_friendships').delete().eq('id',id).eq('addressee_id',user.id).eq('status','pending'); if(error)throw error; return json({ok:true,social:await social(user.id)});
    }
    if(action==='remove_friend'){
      const target=String(body.user_id||'');
      if(!validUuid(target)||target===user.id)throw new ApiError(400,'好友資料不正確');
      const [outgoing,incoming]=await Promise.all([
        db.from('puplan_app_friendships').select('id').eq('requester_id',user.id).eq('addressee_id',target),
        db.from('puplan_app_friendships').select('id').eq('requester_id',target).eq('addressee_id',user.id),
      ]);
      if(outgoing.error)throw outgoing.error;
      if(incoming.error)throw incoming.error;
      const ids=[...(outgoing.data||[]),...(incoming.data||[])].map((r:any)=>r.id);
      if(ids.length){const removed=await db.from('puplan_app_friendships').delete().in('id',ids);if(removed.error)throw removed.error;}
      return json({ok:true,social:await social(user.id)});
    }
    if(action==='create_meetup'){
      await rateLimit(req,'meetup',30,10); const target=String(body.user_id||''); if(!validUuid(target)||target===user.id)throw new ApiError(400,'好友資料不正確'); if(!(await areFriends(user.id,target)))throw new ApiError(403,'只有好友可以互相發邀約');
      const kind=String(body.kind||''); const day=Number(body.day),start=Number(body.start_period),end=Number(body.end_period),note=String(body.note||'').trim().slice(0,120); if(!['meal','study'].includes(kind))throw new ApiError(400,'邀約類型不正確'); if(!Number.isInteger(day)||day<1||day>5||!Number.isInteger(start)||start<1||start>13||!Number.isInteger(end)||end<start||end>13)throw new ApiError(400,'邀約時間不正確');
      const {error}=await db.from('puplan_app_meetups').insert({creator_id:user.id,invitee_id:target,kind,day,start_period:start,end_period:end,note,status:'pending'}); if(error)throw error; return json({ok:true,social:await social(user.id)});
    }
    if(action==='respond_meetup'){
      const id=String(body.meetup_id||''),decision=String(body.decision||''); if(!['accepted','declined'].includes(decision))throw new ApiError(400,'回覆不正確'); const {data:m}=await db.from('puplan_app_meetups').select('id').eq('id',id).eq('invitee_id',user.id).eq('status','pending').maybeSingle(); if(!m)throw new ApiError(404,'找不到這筆邀約'); const {error}=await db.from('puplan_app_meetups').update({status:decision,updated_at:new Date().toISOString()}).eq('id',id); if(error)throw error; return json({ok:true,social:await social(user.id)});
    }
    if(action==='cancel_meetup'){
      const id=String(body.meetup_id||''); const {error}=await db.from('puplan_app_meetups').update({status:'cancelled',updated_at:new Date().toISOString()}).eq('id',id).eq('creator_id',user.id).in('status',['pending','accepted']); if(error)throw error; return json({ok:true,social:await social(user.id)});
    }
    throw new ApiError(400,'未知操作');
  }catch(err){ console.error(err); if(err instanceof ApiError)return json({error:err.code,message:err.message},err.status); return json({error:'SERVER_ERROR',message:'伺服器暫時忙碌，請稍後再試'},500); }
});