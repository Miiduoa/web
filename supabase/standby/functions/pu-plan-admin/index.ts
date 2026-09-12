import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL=Deno.env.get('SUPABASE_URL')!;
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const enc=new TextEncoder(),dec=new TextDecoder();
const ALLOWED=new Set(['https://miiduoa.github.io','https://nolu.tw','https://www.nolu.tw','http://localhost:3000','http://localhost:5173','http://127.0.0.1:5500']);
const READ_ONLY=new Set(['whoami','overview','users','user_detail','posts','conversations','conversation_detail']);

class ApiError extends Error{status:number;code:string;constructor(status:number,message:string,code='BAD_REQUEST'){super(message);this.status=status;this.code=code}}
function cors(req:Request){const o=req.headers.get('origin')||'';return {'Access-Control-Allow-Origin':ALLOWED.has(o)?o:'https://miiduoa.github.io','Vary':'Origin','Access-Control-Allow-Headers':'authorization, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'}}
const json=(req:Request,x:any,s=200)=>new Response(JSON.stringify({...x,cloud_tier:'standby'}),{status:s,headers:{...cors(req),'Content-Type':'application/json; charset=utf-8'}});
function b64d(v:string){let n=v.replace(/-/g,'+').replace(/_/g,'/');while(n.length%4)n+='=';const r=atob(n),o=new Uint8Array(r.length);for(let i=0;i<r.length;i++)o[i]=r.charCodeAt(i);return o}
function eq(a:Uint8Array,b:Uint8Array){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0}
async function hmac(m:string){const k=await crypto.subtle.importKey('raw',enc.encode(KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',k,enc.encode(m)))}
async function cv(salt:string){const d=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(`nolu-session-v4:${salt}`)));let x='';for(const b of d)x+=String.fromCharCode(b);return btoa(x).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'').slice(0,22)}
async function verify(token:string){const [p,s,...x]=String(token||'').split('.');if(!p||!s||x.length)throw new ApiError(401,'登入狀態無效，請重新登入','UNAUTHORIZED');let payload:any;try{if(!eq(await hmac(p),b64d(s)))throw 0;payload=JSON.parse(dec.decode(b64d(p)))}catch{throw new ApiError(401,'登入狀態無效，請重新登入','UNAUTHORIZED')}const now=Math.floor(Date.now()/1000);if(payload?.v!==4||!payload.uid||!payload.exp||!payload.cv||payload.exp<now)throw new ApiError(401,'登入已過期，請重新登入','UNAUTHORIZED');return payload}
async function admin(req:Request){const h=req.headers.get('authorization')||'',s=await verify(h.startsWith('Bearer ')?h.slice(7):'');const r=await db.from('puplan_app_users').select('id,email,display_name,username,role,password_salt').eq('id',s.uid).maybeSingle();if(r.error)throw r.error;if(!r.data)throw new ApiError(401,'找不到帳號','UNAUTHORIZED');if(s.cv!==await cv(r.data.password_salt||''))throw new ApiError(401,'登入憑證已變更，請重新登入','SESSION_REVOKED');if(r.data.role!=='admin')throw new ApiError(403,'你沒有管理權限','FORBIDDEN');return r.data}
const clean=(v:any,n=80)=>String(v??'').trim().slice(0,n);
async function count(t:string,f?:(q:any)=>any){let q=db.from(t).select('*',{count:'exact',head:true});if(f)q=f(q);const r=await q;if(r.error)throw r.error;return r.count||0}
async function userMap(ids:string[]){const u=[...new Set(ids.filter(Boolean))];if(!u.length)return new Map();const r=await db.from('puplan_app_users').select('id,display_name,username,email,avatar_data').in('id',u);if(r.error)throw r.error;return new Map((r.data||[]).map((x:any)=>[x.id,x]))}

Deno.serve(async req=>{
  const o=req.headers.get('origin')||'';
  if(req.method==='OPTIONS'){if(o&&!ALLOWED.has(o))return new Response('forbidden',{status:403});return new Response('ok',{headers:cors(req)})}
  if(req.method!=='POST')return json(req,{message:'不支援這個操作'},405);
  if(o&&!ALLOWED.has(o))return json(req,{message:'來源不允許'},403);
  try{
    const b=await req.json().catch(()=>({})),a=String(b.action||''),me=await admin(req);
    if(!READ_ONLY.has(a))throw new ApiError(503,'備援區管理模式目前為唯讀；修改操作需由主雲端完成','PRIMARY_REQUIRED');
    if(a==='whoami')return json(req,{is_admin:true,read_only:true,profile:{id:me.id,email:me.email,display_name:me.display_name,username:me.username,role:me.role}});
    if(a==='overview'){
      const [users,posts,replies,messages,conversations,friendships,semesters,media]=await Promise.all([
        count('puplan_app_users'),count('puplan_app_posts',q=>q.is('parent_id',null).is('deleted_at',null)),count('puplan_app_posts',q=>q.not('parent_id','is',null).is('deleted_at',null)),count('puplan_app_messages'),count('puplan_app_conversations'),count('puplan_app_friendships',q=>q.eq('status','accepted')),count('puplan_app_semesters'),count('puplan_app_post_media')
      ]);
      return json(req,{read_only:true,stats:{users,posts,replies,messages,conversations,friendships,semesters,media}})
    }
    if(a==='users'){
      const term=clean(b.query,80).replace(/[%,()]/g,''),limit=Math.min(100,Math.max(1,Number(b.limit)||50)),offset=Math.max(0,Number(b.offset)||0);
      let q=db.from('puplan_app_users').select('id,email,display_name,username,created_at,updated_at,avatar_data,bio,discoverable,role,profile_visibility',{count:'exact'}).order('created_at',{ascending:false}).range(offset,offset+limit-1);
      if(term)q=q.or(`email.ilike.%${term}%,display_name.ilike.%${term}%,username.ilike.%${term}%`);
      const r=await q;if(r.error)throw r.error;return json(req,{read_only:true,users:r.data||[],total:r.count||0})
    }
    if(a==='user_detail'){
      const id=String(b.user_id||''),u=await db.from('puplan_app_users').select('id,email,display_name,username,created_at,updated_at,avatar_data,bio,discoverable,role,profile_visibility').eq('id',id).maybeSingle();if(u.error)throw u.error;if(!u.data)throw new ApiError(404,'找不到這位會員');
      const [semesters,friendships,posts,memberships]=await Promise.all([db.from('puplan_app_semesters').select('*').eq('user_id',id).order('updated_at',{ascending:false}),db.from('puplan_app_friendships').select('*').or(`requester_id.eq.${id},addressee_id.eq.${id}`).order('created_at',{ascending:false}),db.from('puplan_app_posts').select('id,parent_id,body,visibility,created_at,updated_at,deleted_at').eq('author_id',id).order('created_at',{ascending:false}).limit(100),db.from('puplan_app_conversation_members').select('conversation_id,joined_at,last_read_at').eq('user_id',id)]);
      return json(req,{read_only:true,user:u.data,semesters:semesters.data||[],friendships:friendships.data||[],posts:posts.data||[],memberships:memberships.data||[]})
    }
    if(a==='posts'){
      const kind=b.kind==='reply'?'reply':'post',limit=Math.min(100,Math.max(1,Number(b.limit)||50)),offset=Math.max(0,Number(b.offset)||0);let q=db.from('puplan_app_posts').select('id,author_id,parent_id,body,visibility,created_at,updated_at,deleted_at',{count:'exact'}).order('created_at',{ascending:false}).range(offset,offset+limit-1);q=kind==='reply'?q.not('parent_id','is',null):q.is('parent_id',null);const r=await q;if(r.error)throw r.error;const m=await userMap((r.data||[]).map((x:any)=>x.author_id));return json(req,{read_only:true,items:(r.data||[]).map((x:any)=>({...x,author:m.get(x.author_id)||null})),total:r.count||0})
    }
    if(a==='conversations'){
      const limit=Math.min(100,Math.max(1,Number(b.limit)||50)),offset=Math.max(0,Number(b.offset)||0),r=await db.from('puplan_app_conversations').select('id,kind,title,created_by,created_at,updated_at',{count:'exact'}).order('updated_at',{ascending:false}).range(offset,offset+limit-1);if(r.error)throw r.error;const ids=(r.data||[]).map((x:any)=>x.id);let members:any[]=[],messages:any[]=[];if(ids.length){const m=await db.from('puplan_app_conversation_members').select('conversation_id,user_id').in('conversation_id',ids),s=await db.from('puplan_app_messages').select('conversation_id,id').in('conversation_id',ids);if(m.error)throw m.error;if(s.error)throw s.error;members=m.data||[];messages=s.data||[]}return json(req,{read_only:true,items:(r.data||[]).map((c:any)=>({...c,member_count:members.filter(x=>x.conversation_id===c.id).length,message_count:messages.filter(x=>x.conversation_id===c.id).length})),total:r.count||0})
    }
    if(a==='conversation_detail'){
      const id=String(b.id||''),c=await db.from('puplan_app_conversations').select('*').eq('id',id).maybeSingle();if(c.error)throw c.error;if(!c.data)throw new ApiError(404,'找不到這個聊天室');const m=await db.from('puplan_app_conversation_members').select('user_id,joined_at,last_read_at').eq('conversation_id',id),s=await db.from('puplan_app_messages').select('id,sender_id,body,created_at,edited_at').eq('conversation_id',id).order('created_at',{ascending:true}).limit(500);if(m.error)throw m.error;if(s.error)throw s.error;const u=await userMap([...(m.data||[]).map((x:any)=>x.user_id),...(s.data||[]).map((x:any)=>x.sender_id)]);return json(req,{read_only:true,conversation:c.data,members:(m.data||[]).map((x:any)=>({...x,user:u.get(x.user_id)||null})),messages:(s.data||[]).map((x:any)=>({...x,sender:u.get(x.sender_id)||null}))})
    }
    throw new ApiError(400,'找不到這個管理功能')
  }catch(e){console.error(e);if(e instanceof ApiError)return json(req,{error:e.code,message:e.message},e.status);return json(req,{error:'SERVER_ERROR',message:'備援管理功能暫時無法使用'},500)}
});
