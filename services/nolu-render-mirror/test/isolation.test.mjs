import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash, randomUUID, webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';

const ORIGIN='https://miiduoa.github.io';
const KID='mesh-mumbai-20260911-5';
const canonical=value=>Array.isArray(value)
  ?`[${value.map(canonical).join(',')}]`
  :value&&typeof value==='object'
    ?`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
    :JSON.stringify(value);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');

// Never run fixtures against a remote database, even if DATABASE_URL is inherited.
const connectionString=process.env.NOLU_TEST_DATABASE_URL;
assert.ok(connectionString,'NOLU_TEST_DATABASE_URL is required; no production fallback');
const database=new URL(connectionString);
assert.ok(['127.0.0.1','localhost'].includes(database.hostname),'test database must be loopback');
assert.equal(database.pathname,'/nolu_mirror_ci','test database name must be nolu_mirror_ci');

async function unusedPort(){
  const listener=net.createServer();
  listener.listen(0,'127.0.0.1');
  await once(listener,'listening');
  const port=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  return port;
}

test('Render mirror: real PostgreSQL and ephemeral ES256 identities', {timeout:60000}, async t=>{
  const alice=randomUUID(),bob=randomUUID();
  const pool=new pg.Pool({connectionString,connectionTimeoutMillis:3000});
  const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const publicKey=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
  const keys={keys:[{...publicKey,kid:KID,alg:'ES256',use:'sig'}]};
  const jwks=http.createServer((_req,res)=>{
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(keys));
  });
  jwks.listen(0,'127.0.0.1');
  await once(jwks,'listening');
  const port=await unusedPort();
  const base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{
    env:{PATH:process.env.PATH,NODE_ENV:'test',PORT:String(port),DATABASE_URL:connectionString,
      NOLU_PROVIDER_ID:'render',NOLU_JWKS_URL:`http://127.0.0.1:${jwks.address().port}/jwks`},
    stdio:['ignore','pipe','pipe']
  });
  let startupError;
  child.on('error',error=>{startupError=error});
  // Drain output without persisting credentials or signing material.
  child.stdout.resume();child.stderr.resume();
  t.after(async()=>{
    const exited=child.exitCode!==null||child.signalCode!==null;
    if(!exited){
      const exit=once(child,'exit');
      child.kill('SIGTERM');
      const timer=setTimeout(()=>child.kill('SIGKILL'),3000);
      timer.unref();
      await exit;clearTimeout(timer);
    }
    jwks.closeAllConnections();
    await new Promise(resolve=>jwks.close(resolve));
    try{await pool.query('delete from public.nolu_snapshots where uid=any($1::uuid[])',[[alice,bob]])}
    finally{await pool.end()}
  });

  async function token(uid,extra={},headerExtra={}){
    const now=Math.floor(Date.now()/1000);
    const head=encode({alg:'ES256',typ:'NOLU',kid:KID,...headerExtra});
    const payload=encode({v:1,sub:uid,cv:'ephemeral-ci',role:'authenticated',iat:now,exp:now+240,
      iss:'nolu',aud:'nolu-provider-mesh',auth_domain:'mumbai',...extra});
    const signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,Buffer.from(`${head}.${payload}`));
    return `${head}.${payload}.${Buffer.from(signature).toString('base64url')}`;
  }
  async function request(body,authorization,origin=ORIGIN,method='POST'){
    const headers={'Content-Type':'application/json'};
    if(origin!==null)headers.Origin=origin;
    if(authorization)headers.Authorization=`Bearer ${authorization}`;
    const response=await fetch(`${base}/mirror`,{method,headers,
      ...(method==='POST'?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});
    const text=await response.text();
    return {status:response.status,headers:response.headers,data:text?JSON.parse(text):null};
  }
  let ready=false;
  for(let attempt=0;attempt<40;attempt++){
    if(startupError)throw startupError;
    if(child.exitCode!==null)throw new Error('mirror process exited before readiness');
    try{
      const response=await fetch(`${base}/health`,{signal:AbortSignal.timeout(1000)});
      const body=await response.json();
      if(response.status===200&&body.ok===true&&body.configured===true&&body.status==='available'){
        assert.equal(body.provider,'render');
        assert.equal(body.portable_auth,'regional-es256-v2');
        assert.equal(response.headers.get('cache-control'),'no-store');
        ready=true;break;
      }
    }catch{}
    await delay(200);
  }
  assert.ok(ready,'isolated PostgreSQL mirror must become genuinely storage-ready');
  const aliceToken=await token(alice),bobToken=await token(bob);

  await t.test('missing, forged, retired, expired and wrong-audience tokens are rejected',async()=>{
    const forged=aliceToken.slice(0,aliceToken.lastIndexOf('.')+1)+'AA';
    const now=Math.floor(Date.now()/1000);
    for(const candidate of [null,'malformed',forged,
      await token(alice,{}, {kid:'mesh-20260911-1'}),
      await token(alice,{iat:now-240,exp:now-1}),
      await token(alice,{aud:'other-app'}),await token(alice,{role:'admin'})]){
      const result=await request({action:'get_snapshot'},candidate);
      assert.equal(result.status,401);
      assert.equal(result.data.error,'UNAUTHORIZED');
    }
  });
  await t.test('origin and method boundaries remain strict',async()=>{
    for(const origin of ['https://evil.example',null]){
      const result=await request({action:'get_snapshot'},aliceToken,origin);
      assert.equal(result.status,403);
      assert.equal(result.data.error,'ORIGIN_NOT_ALLOWED');
      assert.equal(result.headers.get('access-control-allow-origin'),null);
    }
    const denied=await request(null,null,'https://evil.example','OPTIONS');
    assert.equal(denied.status,403);
    assert.equal(denied.headers.get('access-control-allow-origin'),null);
    const allowed=await request(null,null,ORIGIN,'OPTIONS');
    assert.equal(allowed.status,204);
    assert.equal(allowed.headers.get('access-control-allow-origin'),ORIGIN);
    assert.equal((await request(null,null,ORIGIN,'GET')).status,404);
  });
  const snapshotA={uid:alice,revision:10,items:[{title:'Alice fixture'}]};
  const snapshotB={uid:bob,revision:10,items:[{title:'Bob fixture'}]};
  const put=(snapshot,auth)=>request({action:'put_snapshot',snapshot,revision:snapshot.revision,digest:digest(snapshot)},auth);
  await t.test('two authenticated users store and read only their own snapshots',async()=>{
    const stored=await put(snapshotA,aliceToken);
    assert.equal(stored.status,200);assert.equal(stored.data.stored,true);
    const before=await request({action:'get_snapshot',uid:alice},bobToken);
    assert.equal(before.status,200);assert.equal(before.data.snapshot,null);
    const mismatch=await put(snapshotA,bobToken);
    assert.equal(mismatch.status,403);
    const storedB=await put(snapshotB,bobToken);
    assert.equal(storedB.status,200);assert.equal(storedB.data.stored,true);
    for(const [auth,own,other] of [[aliceToken,snapshotA,bob],[bobToken,snapshotB,alice]]){
      const result=await request({action:'get_snapshot',uid:other},auth);
      assert.equal(result.status,200);
      assert.deepEqual(result.data.snapshot,own);
      assert.equal(result.data.digest,digest(own));
      assert.equal(result.headers.get('cache-control'),'no-store');
    }
  });
  await t.test('bad digests, stale revisions and conflicting revisions cannot replace data',async()=>{
    const invalid=await request({action:'put_snapshot',snapshot:snapshotA,revision:10,digest:'0'.repeat(64)},aliceToken);
    assert.equal(invalid.status,400);
    const older=await put({...snapshotA,revision:9},aliceToken);
    assert.equal(older.status,200);assert.equal(older.data.stored,false);
    assert.equal(older.data.reason,'older_revision');
    const conflict=await put({...snapshotA,items:[]},aliceToken);
    assert.equal(conflict.status,409);
    assert.deepEqual((await request({action:'get_snapshot'},aliceToken)).data.snapshot,snapshotA);
  });
});
