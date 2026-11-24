import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { publicSnapshot, submitVote, transition } from './public/domain.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=path.join(root,'data');
await mkdir(dataDir,{recursive:true});
let sessions={};
try{sessions=JSON.parse(await readFile(path.join(dataDir,'sessions.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
let saveQueue=Promise.resolve();
function persist(){const json=JSON.stringify(sessions);const save=saveQueue.then(async()=>{const tmp=path.join(dataDir,'sessions.tmp');await writeFile(tmp,json);await rename(tmp,path.join(dataDir,'sessions.json'));});saveQueue=save.catch(()=>{});return save;}
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const limits=new Map();
function limited(req){const ip=req.socket.remoteAddress;const now=Date.now();let value=limits.get(ip);if(!value||now-value.at>60000){value={at:now,count:0};limits.set(ip,value);}return ++value.count>240;}
setInterval(()=>{const now=Date.now();for(const [ip,value]of limits)if(now-value.at>60000)limits.delete(ip);},60000).unref();
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>64000)throw new Error('Слишком большой запрос.');}try{return JSON.parse(text||'{}');}catch{throw new Error('Некорректные данные запроса.');}}
function verifyHost(session,token){if(typeof token!=='string'||token.length!==session.token.length||!timingSafeEqual(Buffer.from(token),Buffer.from(session.token)))throw Object.assign(new Error('Управление доступно только ведущему.'),{status:403});}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/config')return json(res,200,{live:true});
    if(url.pathname.startsWith('/api/')){
      if(req.method==='POST'&&limited(req))return json(res,429,{error:'Слишком много запросов. Подождите минуту.'});
      if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return json(res,403,{error:'Запрос с другого сайта отклонён.'});
      const segments=url.pathname.split('/').filter(Boolean);
      if(segments[1]!=='sessions')return json(res,404,{error:'Адрес не найден.'});
      if(segments.length===2&&req.method==='POST'){
        const input=await body(req);const names=Array.isArray(input.roles)?input.roles.map(s=>String(s).trim()).filter(Boolean):[];
        if(!names.length||names.length>100||names.some(n=>n.length>150))throw new Error('Добавьте от 1 до 100 ролей, каждая до 150 символов.');
        const title=String(input.title||'Калибровка бизнес-ролей').trim();if(!title||title.length>100)throw new Error('Название встречи должно содержать от 1 до 100 символов.');
        let code;do{code=String(randomInt(100000,1000000));}while(sessions[code]);
        const token=randomBytes(24).toString('hex');const roles=names.map(name=>({id:randomUUID(),name,status:'pending',round:1}));
        sessions[code]={code,title,token,roles,currentRoleId:roles[0].id,participants:[],votes:[],finished:false,createdAt:new Date().toISOString()};
        await persist();return json(res,201,{code,token});
      }
      const session=sessions[segments[2]];if(!session)return json(res,404,{error:'Сессия не найдена. Проверьте ссылку или код.'});
      if(segments.length===3&&req.method==='GET')return json(res,200,publicSnapshot(session));
      if(req.method!=='POST')return json(res,405,{error:'Метод не поддерживается.'});
      const input=await body(req);
      if(segments[3]==='join'){
        if(session.finished)throw new Error('Эта сессия завершена.');
        const name=String(input.name||'').trim();if(!name||name.length>60)throw new Error('Введите имя длиной от 1 до 60 символов.');
        if(session.participants.length>=200)throw new Error('Достигнут лимит в 200 участников.');
        const person={id:randomUUID(),token:randomBytes(24).toString('hex'),name};session.participants.push(person);await persist();return json(res,201,person);
      }
      if(segments[3]==='vote'){submitVote(session,input);await persist();return json(res,200,{ok:true});}
      verifyHost(session,input.token);
      if(segments[3]==='action'){transition(session,input);await persist();return json(res,200,{ok:true});}
      if(segments[3]==='roles'){
        if(session.finished)throw new Error('Сессия завершена.');const name=String(input.name||'').trim();if(!name||name.length>150||session.roles.length>=100)throw new Error('Название до 150 символов; не более 100 ролей.');
        session.roles.push({id:randomUUID(),name,status:'pending',round:1});await persist();return json(res,201,{ok:true});
      }
      return json(res,404,{error:'Адрес не найден.'});
    }
    const pathname=url.pathname==='/'?'/index.html':url.pathname;
    const full=path.resolve(root,'public',`.${decodeURIComponent(pathname)}`);
    if(!full.startsWith(path.join(root,'public')+path.sep))return json(res,403,{error:'Доступ запрещён.'});
    try{const file=await readFile(full);res.writeHead(200,{'Content-Type':mime[path.extname(full)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(file);}catch(error){if(error.code!=='ENOENT')throw error;json(res,404,{error:'Файл не найден.'});}
  }catch(error){console.error(error.message);if(!res.headersSent)json(res,error.status||400,{error:error.status===500?'Ошибка сервера. Повторите запрос.':error.message});else res.end();}
});
const port=Number(process.env.PORT||4173);
server.listen(port,'0.0.0.0',()=>console.log(`Rolelab running on http://localhost:${port}`));
