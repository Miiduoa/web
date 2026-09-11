async function jsonFetch(url){
  const res=await fetch(url,{signal:AbortSignal.timeout(30000)});
  const text=await res.text();
  let data={};try{data=JSON.parse(text)}catch{}
  return {res,data,text};
}
function assert(condition,message){if(!condition)throw new Error(message)}
const endpoints=[
  ['mumbai','https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-portable-v2'],
  ['tokyo','https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-portable-v2']
];
for(const [region,url] of endpoints){
  const result=await jsonFetch(url);
  console.log(`${region} jwks status`,result.res.status);
  const key=Array.isArray(result.data?.keys)?result.data.keys[0]:null;
  assert(result.res.ok&&key,'missing public key');
  assert(key.kty==='EC'&&key.crv==='P-256'&&key.alg==='ES256'&&typeof key.kid==='string','invalid key');
  assert(!('d' in key),'private key leaked');
  console.log(`${region} jwk`,JSON.stringify(key));
}
console.log('portable v2 public key collection passed');
