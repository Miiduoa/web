import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  assertCredentialCurrent,
  SessionError,
  verifySignedSessionV4,
} from '../_shared/session-v4.ts';

const URL=Deno.env.get('SUPABASE_URL')!;
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const enc=new TextEncoder();
const ALLOWED=new Set([
  'https://miiduoa.github.io','https://nolu.tw','https://www.nolu.tw','https://nolu-8r2.pages.dev',
  'http://localhost:3000','http://localhost:5173','http://127.0.0.1:5500'
]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ApiError extends Error{
  status:number;code:string;
  constructor(status:number,message:string,code='BAD_REQUEST'){super(message);this.status=status;this.code=code}
}
function cors(req:Request){const o=req.headers.get('origin')||'';return {
  'Access-Control-Allow-Origin':ALLOWED.has(o)?o:'https://miiduoa.github.io','Vary':'Origin',
  'Access-Control-Allow-Headers':'authorization, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'
}}
const json=(req:Request,x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors(req),'Content-Type':'application/json; charset=utf-8'}});
const clean=(v:any,n:number)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,n);
const validUuid=(v:any)=>UUID.test(String(v||''));
function b64url(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
async function hmac(m:string){const k=await crypto.subtle.importKey('raw',enc.encode(KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',k,enc.encode(m)))}
function sessionApiError(error:unknown){return error instanceof SessionError?new ApiError(401,error.message,error.code):new ApiError(401,'登入狀態無效，請重新登入','UNAUTHORIZED')}

async function user(req:Request){
  const auth=req.headers.get('authorization')||'',token=auth.startsWith('Bearer ')?auth.slice(7):'';
  let session;try{session=await verifySignedSessionV4(token,KEY)}catch(error){throw sessionApiError(error)}
  const {data,error}=await db.from('puplan_app_users').select('id,email,display_name,username,avatar_data,bio,discoverable,role,profile_visibility,created_at,password_salt').eq('id',session.uid).maybeSingle();
  if(error)throw error;if(!data)throw new ApiError(401,'找不到帳號','UNAUTHORIZED');
  try{await assertCredentialCurrent(session,data.password_salt||'')}catch(error){throw sessionApiError(error)}
  return data;
}
const profile=(u:any)=>({id:u.id,display_name:u.display_name,username:u.username,avatar_data:u.avatar_data||'',bio:u.bio||'',role:u.role||'user',profile_visibility:u.profile_visibility||'public'});
async function rateLimit(req:Request,action:string,limit:number,minutes:number){
  const ip=(req.headers.get('x-forwarded-for')||req.headers.get('cf-connecting-ip')||'unknown').split(',')[0].trim();
  const key=b64url(await hmac(`social:${ip}`)),since=new Date(Date.now()-minutes*60000).toISOString();
  const {count,error}=await db.from('puplan_app_rate_limits').select('id',{count:'exact',head:true}).eq('rate_key',key).eq('action',action).gte('created_at',since);
  if(error)throw error;if((count||0)>=limit)throw new ApiError(429,'操作太頻繁，請稍後再試','RATE_LIMITED');
  const inserted=await db.from('puplan_app_rate_limits').insert({rate_key:key,action});if(inserted.error)throw inserted.error;
}
async function areFriends(a:string,b:string){
  if(!validUuid(a)||!validUuid(b))return false;
  const {data,error}=await db.from('puplan_app_friendships').select('id').eq('status','accepted').or(`and(requester_id.eq.${a},addressee_id.eq.${b}),and(requester_id.eq.${b},addressee_id.eq.${a})`).limit(1);
  if(error)throw error;return !!data?.length;
}
async function friendsAmong(uid:string,ids:string[]){
  const safe=[...new Set(ids.filter(validUuid))];if(!safe.length)return new Set<string>();
  const [a,b]=await Promise.all([
    db.from('puplan_app_friendships').select('addressee_id').eq('requester_id',uid).eq('status','accepted').in('addressee_id',safe),
    db.from('puplan_app_friendships').select('requester_id').eq('addressee_id',uid).eq('status','accepted').in('requester_id',safe)
  ]);
  if(a.error)throw a.error;if(b.error)throw b.error;
  return new Set([...(a.data||[]).map((x:any)=>x.addressee_id),...(b.data||[]).map((x:any)=>x.requester_id)]);
}
async function friendship(viewer:string,target:string){
  if(!validUuid(viewer)||!validUuid(target))return null;
  const {data,error}=await db.from('puplan_app_friendships').select('id,requester_id,addressee_id,status').or(`and(requester_id.eq.${viewer},addressee_id.eq.${target}),and(requester_id.eq.${target},addressee_id.eq.${viewer})`).limit(1).maybeSingle();
  if(error)throw error;return data||null;
}
async function member(cid:string,uid:string){if(!validUuid(cid))return null;const r=await db.from('puplan_app_conversation_members').select('role,last_read_at,unread_count').eq('conversation_id',cid).eq('user_id',uid).maybeSingle();if(r.error)throw r.error;return r.data}
async function canViewPost(viewer:any,p:any){
  if(!p||p.deleted_at)return false;
  if(viewer.role==='admin'||viewer.id===p.author_id)return true;
  const {data:author,error}=await db.from('puplan_app_users').select('id,profile_visibility,discoverable').eq('id',p.author_id).maybeSingle();
  if(error)throw error;if(!author)return false;
  const friend=await areFriends(viewer.id,p.author_id);
  if((author.profile_visibility||'public')==='private'&&!friend)return false;
  if((p.visibility||'public')==='private'&&!friend)return false;
  return true;
}

async function feed(u:any,body:any){
  const limit=Math.max(5,Math.min(30,Number(body.limit)||20)),cursor=String(body.cursor||'');
  let q=db.from('puplan_app_posts').select('id,author_id,body,visibility,created_at,updated_at,like_count,reply_count').is('parent_id',null).is('deleted_at',null).order('created_at',{ascending:false}).limit(limit*4);
  if(cursor)q=q.lt('created_at',cursor);
  const r=await q;if(r.error)throw r.error;const candidates=r.data||[];
  const authorIds=[...new Set(candidates.map((x:any)=>x.author_id))],fr=await friendsAmong(u.id,authorIds);
  let ps:any[]=[];if(authorIds.length){const a=await db.from('puplan_app_users').select('id,display_name,username,avatar_data,bio,role,profile_visibility,discoverable').in('id',authorIds);if(a.error)throw a.error;ps=a.data||[]}
  const pm=new Map(ps.map((x:any)=>[x.id,x])),visible=candidates.filter((p:any)=>{const a=pm.get(p.author_id);if(!a)return false;const self=u.id===a.id||u.role==='admin';if(!self&&(a.profile_visibility||'public')==='private'&&!fr.has(a.id))return false;if((p.visibility||'public')==='private'&&!self&&!fr.has(a.id))return false;return true}).slice(0,limit);
  const ids=visible.map((x:any)=>x.id);let likes:any[]=[];if(ids.length){const x=await db.from('puplan_app_post_likes').select('post_id').eq('user_id',u.id).in('post_id',ids);if(x.error)throw x.error;likes=x.data||[]}
  let replies:any[]=[];if(ids.length){const x=await db.rpc('puplan_latest_replies',{p_post_ids:ids,p_per_post:2});if(x.error)throw x.error;replies=x.data||[]}
  const replyAuthors=[...new Set(replies.map((x:any)=>x.author_id))];if(replyAuthors.length){const x=await db.from('puplan_app_users').select('id,display_name,username,avatar_data,bio,role,profile_visibility').in('id',replyAuthors);if(x.error)throw x.error;for(const a of x.data||[])pm.set(a.id,a)}
  const liked=new Set(likes.map((x:any)=>x.post_id)),rb=new Map<string,any[]>();for(const x of replies){const a=rb.get(x.parent_id)||[];a.push({...x,author:profile(pm.get(x.author_id)||{}),can_edit:x.author_id===u.id||u.role==='admin',can_delete:x.author_id===u.id||u.role==='admin'});rb.set(x.parent_id,a)}
  return {posts:visible.map((p:any)=>({...p,author:profile(pm.get(p.author_id)||{}),media:[],liked:liked.has(p.id),replies:rb.get(p.id)||[]})),next_cursor:candidates.length?candidates[candidates.length-1].created_at:null,ranking:'latest'};
}
async function inbox(uid:string,body:any){const r=await db.rpc('puplan_inbox_page',{p_user_id:uid,p_limit:Math.max(10,Math.min(50,Number(body.limit)||30)),p_before:body.cursor?String(body.cursor):null});if(r.error)throw r.error;return {conversations:r.data||[],next_cursor:null}}
async function conversation(id:string,uid:string){
  if(!(await member(id,uid)))throw new ApiError(403,'你沒有這個聊天室的權限','FORBIDDEN');
  const [c,m,ms]=await Promise.all([db.from('puplan_app_conversations').select('*').eq('id',id).maybeSingle(),db.from('puplan_app_conversation_members').select('*').eq('conversation_id',id),db.from('puplan_app_messages').select('*').eq('conversation_id',id).order('created_at',{ascending:true}).limit(50)]);
  if(c.error)throw c.error;if(m.error)throw m.error;if(ms.error)throw ms.error;if(!c.data)throw new ApiError(404,'找不到聊天室');
  const ids=[...new Set((m.data||[]).map((x:any)=>x.user_id))];let profiles:any[]=[];if(ids.length){const p=await db.from('puplan_app_users').select('id,display_name,username,avatar_data,bio,role,profile_visibility').in('id',ids);if(p.error)throw p.error;profiles=(p.data||[]).map(profile)}
  return {conversation:c.data,members:m.data||[],profiles,messages:ms.data||[],next_cursor:null};
}
async function resolveTarget(body:any){
  const id=String(body.user_id||'').trim();if(id){if(!validUuid(id))throw new ApiError(400,'使用者資料無效');return id}
  const username=String(body.username||'').trim().replace(/^@/,'').toLowerCase();if(!/^[a-z0-9_.]{2,24}$/.test(username))throw new ApiError(400,'帳號格式不正確');
  const r=await db.from('puplan_app_users').select('id').eq('username',username).maybeSingle();if(r.error)throw r.error;if(!r.data)throw new ApiError(404,'找不到這位使用者');return r.data.id;
}
async function profileView(u:any,body:any){
  const id=await resolveTarget(body),r=await db.from('puplan_app_users').select('id,display_name,username,avatar_data,bio,role,profile_visibility,discoverable').eq('id',id).maybeSingle();if(r.error)throw r.error;if(!r.data)throw new ApiError(404,'找不到這位使用者');
  const p=r.data,rel=u.id===p.id?null:await friendship(u.id,p.id),friend=rel?.status==='accepted',self=u.id===p.id||u.role==='admin';
  if(!self&&!p.discoverable&&!friend)throw new ApiError(404,'找不到這位使用者');
  const can=self||(p.profile_visibility||'public')==='public'||friend;let posts:any[]=[];
  if(can){let q=db.from('puplan_app_posts').select('id,author_id,body,visibility,created_at,updated_at,like_count,reply_count').eq('author_id',p.id).is('parent_id',null).is('deleted_at',null).order('created_at',{ascending:false}).limit(12);if(!self&&!friend)q=q.eq('visibility','public');const x=await q;if(x.error)throw x.error;posts=(x.data||[]).map((z:any)=>({...z,media:[],liked:false}))}
  return {profile:profile(p),private:!can,is_friend:friend,can_view_posts:can,friendship:rel?{id:rel.id,status:rel.status,outgoing:rel.requester_id===u.id}:null,relationship:rel||null,post_count:posts.length,friend_count:0,posts};
}

Deno.serve(async req=>{
  const origin=req.headers.get('origin')||'';
  if(req.method==='OPTIONS'){if(origin&&!ALLOWED.has(origin))return new Response('forbidden',{status:403});return new Response('ok',{headers:cors(req)})}
  if(req.method!=='POST')return json(req,{message:'不支援這個操作'},405);
  if(origin&&!ALLOWED.has(origin))return json(req,{message:'來源不允許'},403);
  try{
    const body=await req.json().catch(()=>({})),action=String(body.action||''),u=await user(req);
    if(action==='me')return json(req,{profile:profile(u),discoverable:u.discoverable!==false});
    if(action==='privacy_get')return json(req,{profile_visibility:u.profile_visibility==='private'?'private':'public',discoverable:u.discoverable!==false});
    if(action==='privacy_set'||action==='update_account_privacy'){
      const v=body.profile_visibility==='private'?'private':body.profile_visibility==='public'?'public':'';if(!v)throw new ApiError(400,'請選擇公開或私人帳號');
      const r=await db.from('puplan_app_users').update({profile_visibility:v,updated_at:new Date().toISOString()}).eq('id',u.id);if(r.error)throw r.error;return json(req,{ok:true,profile_visibility:v,profile:{...profile(u),profile_visibility:v}});
    }
    if(action==='feed')return json(req,await feed(u,body));
    if(action==='set_feed_preference'){
      let key='';if(body.author_id){const id=String(body.author_id);if(!validUuid(id))throw new ApiError(400,'使用者資料無效');key=`author:${id}`}else{const term=clean(body.term,24).toLowerCase();if(term.length<2)throw new ApiError(400,'請輸入至少 2 個字');key=`term:${term}`}
      const direction=Number(body.direction)===-1?-1:1,expires_at=new Date(Date.now()+Math.max(1,Math.min(30,Number(body.days)||7))*86400000).toISOString();
      const r=await db.from('puplan_app_feed_preferences').upsert({viewer_id:u.id,preference_key:key,direction,expires_at,updated_at:new Date().toISOString()},{onConflict:'viewer_id,preference_key'});if(r.error)throw r.error;return json(req,{ok:true,expires_at});
    }
    if(action==='profile_view')return json(req,await profileView(u,body));
    if(action==='inbox')return json(req,await inbox(u.id,body));
    if(action==='conversation')return json(req,await conversation(String(body.conversation_id||''),u.id));
    if(action==='prepare_media')throw new ApiError(503,'備援區目前先支援文字貼文；相片與影片上傳會在主雲端恢復後提供','MEDIA_PRIMARY_REQUIRED');
    if(action==='create_chat'){
      await rateLimit(req,'chat_create',20,10);
      const ids=[...new Set((Array.isArray(body.user_ids)?body.user_ids:[]).map(String).filter((x:string)=>x&&x!==u.id))].slice(0,20);if(!ids.length)throw new ApiError(400,'請至少選一位好友');
      for(const id of ids)if(!validUuid(id)||!(await areFriends(u.id,id)))throw new ApiError(403,'只能和已接受的好友建立聊天室');
      const kind=ids.length===1?'direct':'group',direct_key=kind==='direct'?[u.id,ids[0]].sort().join(':'):null;
      if(direct_key){const old=await db.from('puplan_app_conversations').select('id').eq('direct_key',direct_key).maybeSingle();if(old.error)throw old.error;if(old.data)return json(req,await conversation(old.data.id,u.id))}
      const r=await db.from('puplan_app_conversations').insert({kind,title:clean(body.title,80)||(kind==='group'?'群聊':''),created_by:u.id,direct_key}).select('*').single();if(r.error)throw r.error;
      const x=await db.from('puplan_app_conversation_members').insert([{conversation_id:r.data.id,user_id:u.id,role:'owner',last_read_at:new Date().toISOString()},...ids.map((id:string)=>({conversation_id:r.data.id,user_id:id,role:'member'}))]);if(x.error)throw x.error;return json(req,await conversation(r.data.id,u.id));
    }
    if(action==='send_message'){
      await rateLimit(req,'chat_send',120,5);const id=String(body.conversation_id||''),text=clean(body.body,2000);if(!text)throw new ApiError(400,'訊息不能空白');if(!(await member(id,u.id)))throw new ApiError(403,'你沒有這個聊天室的權限');
      const r=await db.from('puplan_app_messages').insert({conversation_id:id,sender_id:u.id,body:text}).select('*').single();if(r.error)throw r.error;return json(req,{message:r.data});
    }
    if(action==='mark_read'){const id=String(body.conversation_id||'');if(!(await member(id,u.id)))throw new ApiError(403,'你沒有這個聊天室的權限');const r=await db.from('puplan_app_conversation_members').update({last_read_at:new Date().toISOString(),unread_count:0}).eq('conversation_id',id).eq('user_id',u.id);if(r.error)throw r.error;return json(req,{ok:true})}
    if(action==='create_post'){
      await rateLimit(req,'post_create',30,10);if(Array.isArray(body.media)&&body.media.length)throw new ApiError(503,'備援區目前先支援文字貼文','MEDIA_PRIMARY_REQUIRED');const text=clean(body.body,600);if(!text)throw new ApiError(400,'請輸入文字');
      const r=await db.from('puplan_app_posts').insert({author_id:u.id,body:text,visibility:body.visibility==='private'?'private':'public'}).select('*').single();if(r.error)throw r.error;return json(req,{post:r.data});
    }
    if(action==='edit_post'){const id=String(body.post_id||''),text=clean(body.body,600),r=await db.from('puplan_app_posts').select('author_id').eq('id',id).is('parent_id',null).is('deleted_at',null).maybeSingle();if(r.error)throw r.error;if(!r.data)throw new ApiError(404,'找不到貼文');if(r.data.author_id!==u.id&&u.role!=='admin')throw new ApiError(403,'只能編輯自己的貼文');const x=await db.from('puplan_app_posts').update({body:text,updated_at:new Date().toISOString()}).eq('id',id);if(x.error)throw x.error;return json(req,{ok:true})}
    if(action==='delete_post'){const id=String(body.post_id||''),r=await db.from('puplan_app_posts').select('author_id').eq('id',id).is('parent_id',null).is('deleted_at',null).maybeSingle();if(r.error)throw r.error;if(!r.data)throw new ApiError(404,'找不到貼文');if(r.data.author_id!==u.id&&u.role!=='admin')throw new ApiError(403,'只能刪除自己的貼文');const x=await db.from('puplan_app_posts').update({deleted_at:new Date().toISOString(),body:'',updated_at:new Date().toISOString()}).eq('id',id);if(x.error)throw x.error;return json(req,{ok:true})}
    if(action==='reply_post'){
      await rateLimit(req,'post_reply',60,10);const parent=String(body.post_id||''),text=clean(body.body,600);if(!text)throw new ApiError(400,'留言不能空白');
      const root=await db.from('puplan_app_posts').select('id,author_id,visibility,deleted_at').eq('id',parent).is('parent_id',null).maybeSingle();if(root.error)throw root.error;if(!root.data)throw new ApiError(404,'找不到這篇貼文');if(!(await canViewPost(u,root.data)))throw new ApiError(403,'你沒有留言權限');
      const r=await db.from('puplan_app_posts').insert({author_id:u.id,parent_id:parent,body:text,visibility:'private'}).select('*').single();if(r.error)throw r.error;return json(req,{reply:{...r.data,author:profile(u),can_edit:true,can_delete:true}});
    }
    if(action==='edit_reply'){const id=String(body.reply_id||''),text=clean(body.body,600),r=await db.from('puplan_app_posts').select('author_id,parent_id').eq('id',id).not('parent_id','is',null).is('deleted_at',null).maybeSingle();if(r.error)throw r.error;if(!r.data?.parent_id)throw new ApiError(404,'找不到留言');if(r.data.author_id!==u.id&&u.role!=='admin')throw new ApiError(403,'只能編輯自己的留言');if(!text)throw new ApiError(400,'留言不能空白');const x=await db.from('puplan_app_posts').update({body:text,updated_at:new Date().toISOString()}).eq('id',id);if(x.error)throw x.error;return json(req,{ok:true,reply:{id,body:text}})}
    if(action==='delete_reply'){const id=String(body.reply_id||''),r=await db.from('puplan_app_posts').select('author_id,parent_id').eq('id',id).not('parent_id','is',null).is('deleted_at',null).maybeSingle();if(r.error)throw r.error;if(!r.data?.parent_id)throw new ApiError(404,'找不到留言');if(r.data.author_id!==u.id&&u.role!=='admin')throw new ApiError(403,'只能刪除自己的留言');const x=await db.from('puplan_app_posts').update({deleted_at:new Date().toISOString(),body:'',updated_at:new Date().toISOString()}).eq('id',id);if(x.error)throw x.error;return json(req,{ok:true})}
    if(action==='toggle_like'){
      const id=String(body.post_id||''),p=await db.from('puplan_app_posts').select('id,author_id,visibility,deleted_at').eq('id',id).is('parent_id',null).maybeSingle();if(p.error)throw p.error;if(!p.data)throw new ApiError(404,'找不到這篇貼文');if(!(await canViewPost(u,p.data)))throw new ApiError(403,'你沒有查看這篇貼文的權限');
      const old=await db.from('puplan_app_post_likes').select('post_id').eq('post_id',id).eq('user_id',u.id).maybeSingle();if(old.error)throw old.error;if(old.data){const x=await db.from('puplan_app_post_likes').delete().eq('post_id',id).eq('user_id',u.id);if(x.error)throw x.error;return json(req,{liked:false})}const x=await db.from('puplan_app_post_likes').insert({post_id:id,user_id:u.id});if(x.error)throw x.error;return json(req,{liked:true});
    }
    throw new ApiError(400,'未知操作');
  }catch(e){console.error(e);if(e instanceof ApiError)return json(req,{error:e.code,message:e.message},e.status);return json(req,{error:'SERVER_ERROR',message:'伺服器暫時忙碌，請稍後再試'},500)}
});
