import { ed25519 } from 'npm:@noble/curves@1.8.2/ed25519';

const URL=Deno.env.get('SUPABASE_URL')||'';
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const PRIMARY='hrrmkrayvrgnwcroyttp';
const STANDBY='ltfurqaspqsvswmebyzw';
const STANDBY_PUBLIC_KEY='y8vSmYdAMI209EvhUa-mRgXk2U6MV4GJN5ksnrF_R0c';
const BUCKET='puplan-media';
const enc=new TextEncoder(),dec=new TextDecoder();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME=/^(?:image\/(?:jpeg|png|webp|gif|heic|heif)|video\/(?:mp4|quicktime|webm))$/i;

class ApiError extends Error{status:number;code:string;constructor(status:number,message:string,code:string){super(message);this.status=status;this.code=code}}
function unb64(v:string){let n=String(v||'').replace(/-/g,'+').replace(/_/g,'/');while(n.length%4)n+='=';const raw=atob(n),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
function json(status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}
function pathOk(uid:string,path:string){return path.startsWith(`${uid}/`)&&!path.includes('..')&&/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i.test(path)}
function verifyShape(p:any){const now=Date.now(),iat=Date.parse(String(p?.iat||'')),exp=Date.parse(String(p?.exp||'')),size=Number(p?.size||0);if(p?.v!==1||p?.kind!=='media-failback'||p?.iss!==STANDBY||p?.aud!==PRIMARY||!UUID.test(String(p?.uid||''))||!UUID.test(String(p?.nonce||''))||!pathOk(String(p.uid),String(p?.storage_path||''))||!MIME.test(String(p?.mime||''))||!Number.isFinite(size)||size<1||size>80*1024*1024||!Number.isFinite(iat)||!Number.isFinite(exp)||exp<=now||iat>now+30000||exp-iat>180000||now-iat>180000)throw new ApiError(400,'invalid media failback payload','MEDIA_REJECTED');let source:URL;try{source=new URL(String(p?.source_url||''))}catch{throw new ApiError(400,'invalid source url','MEDIA_REJECTED')}if(source.protocol!=='https:'||source.hostname!==`${STANDBY}.supabase.co`||!source.pathname.startsWith(`/storage/v1/object/sign/${BUCKET}/`))throw new ApiError(400,'invalid source url','MEDIA_REJECTED')}
function objectUrl(path:string){return `${URL}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`}

Deno.serve(async req=>{
  if(req.method==='GET')return json(200,{ok:true,service:'pu-plan-media-ingest-v1',role:'primary',protocol:1});
  if(req.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
  if(req.headers.get('origin'))return json(403,{error:'BROWSER_ORIGIN_NOT_ALLOWED'});
  try{
    const body=await req.json().catch(()=>({})),envelope=String(body?.envelope||''),[payloadPart,signaturePart,...extra]=envelope.split('.');
    if(!payloadPart||!signaturePart||extra.length)throw new ApiError(401,'invalid media envelope','MEDIA_REJECTED');
    let verified=false;try{verified=ed25519.verify(unb64(signaturePart),enc.encode(payloadPart),unb64(STANDBY_PUBLIC_KEY))}catch{}
    if(!verified)throw new ApiError(401,'invalid media signature','MEDIA_REJECTED');
    let payload:any;try{payload=JSON.parse(dec.decode(unb64(payloadPart)))}catch{throw new ApiError(400,'invalid media payload','MEDIA_REJECTED')}
    verifyShape(payload);
    const source=await fetch(String(payload.source_url),{cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!source.ok||!source.body)throw new ApiError(503,'standby media unavailable','MEDIA_SOURCE_UNAVAILABLE');
    const declared=Number(source.headers.get('content-length')||0);if(declared&&declared!==Number(payload.size))throw new ApiError(409,'media size mismatch','MEDIA_INTEGRITY');
    const upload=await fetch(objectUrl(String(payload.storage_path)),{method:'POST',headers:{'Authorization':`Bearer ${KEY}`,'apikey':KEY,'x-upsert':'true','Content-Type':String(payload.mime),'Cache-Control':'3600'},body:source.body,signal:AbortSignal.timeout(90000)});
    if(!upload.ok){const message=await upload.text().catch(()=> '');console.error('media upload failed',upload.status,message.slice(0,200));throw new ApiError(503,'primary media storage unavailable','MEDIA_TARGET_UNAVAILABLE')}
    return json(200,{ok:true,storage_path:payload.storage_path,size:Number(payload.size)});
  }catch(error){if(error instanceof ApiError)return json(error.status,{error:error.code,message:error.message});console.error('media ingest failed');return json(503,{error:'MEDIA_INGEST_UNAVAILABLE',message:'媒體回灌暫時無法完成'})}
});
