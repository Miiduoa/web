import http from 'node:http';

const PORT=Number(process.env.PORT||10000);
const ALLOWED_ORIGIN='https://miiduoa.github.io';

function headers(origin=''){
  const h={
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'Vary':'Origin',
    'Access-Control-Allow-Headers':'authorization, content-type, x-nolu-mesh-version',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS'
  };
  if(origin===ALLOWED_ORIGIN)h['Access-Control-Allow-Origin']=origin;
  return h;
}
function send(res,status,body,origin=''){
  res.writeHead(status,headers(origin));
  res.end(JSON.stringify(body));
}

const server=http.createServer((req,res)=>{
  const origin=String(req.headers.origin||'');
  if(req.method==='OPTIONS'){
    if(origin&&origin!==ALLOWED_ORIGIN)return send(res,403,{error:'ORIGIN_NOT_ALLOWED'},origin);
    res.writeHead(204,headers(origin));return res.end();
  }
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&url.pathname==='/health'){
    return send(res,200,{ok:true,provider:'render',mirror:'disabled',security_hold:true},origin);
  }
  if(url.pathname==='/mirror'){
    return send(res,410,{ok:false,error:'DISABLED',message:'Portable provider mirror is temporarily disabled'},origin);
  }
  return send(res,404,{error:'NOT_FOUND'},origin);
});

server.listen(PORT,'0.0.0.0',()=>console.log(`nolu-render-mirror safehold listening on ${PORT}`));
