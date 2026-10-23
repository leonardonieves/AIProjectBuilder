import { browserTemplateFiles } from './generation-browser-template.js';

// All executable scaffolding is server-owned, never taken from model package scripts.
export function templateFiles(contract, { namespace = 'unscoped' } = {}) {
  const json = x => JSON.stringify(x, null, 2) + '\n';
  const files = {
    'package.json': json({ name: 'generated-local-crud', version: '1.0.0', private: true, type: 'module',
      scripts: { dev: 'node server/index.js', build: 'vite build', start: 'node server/index.js --production' },
      engines: { node: '^22.13.0 || >=23.4.0' },
      dependencies: { express: '^5.1.0', react: '^19.0.0', 'react-dom': '^19.0.0' }, devDependencies: { vite: '^6.1.0' } }),
    'index.html': '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
    '.gitignore': 'node_modules/\ndist/\ndata/\n.env\n',
    '.env.example': '# Local demonstration only. No secrets required.\n# Server listens on 127.0.0.1:4320\n',
    'contract.json': json(contract),
    'server/schema.json': json(contract.entities),
    'server/db.js': `import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const data = new URL('../data/', import.meta.url); mkdirSync(data, { recursive: true });
export const db = new DatabaseSync(fileURLToPath(new URL('app.sqlite', data)));
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
export const entities = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url), 'utf8'));
const quote = name => '"' + name.replaceAll('"', '""') + '"';
export { quote };
for (const entity of entities) {
  const columns = entity.fields.map(f => quote(f.name) + ' ' +
    (['boolean','reference'].includes(f.type) ? 'INTEGER' : f.type === 'number' ? 'REAL' : 'TEXT') +
    (f.required ? ' NOT NULL' : '') + (f.type === 'reference' ? ' REFERENCES ' + quote(f.reference) + '(id)' : ''));
  db.exec('CREATE TABLE IF NOT EXISTS ' + quote(entity.name) + ' (id INTEGER PRIMARY KEY, ' + columns.join(', ') + ')');
}
`,
    'server/index.js': `import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, entities, quote } from './db.js';
import { validateRecord } from './domain.js';
const app = express(), origin = 'http://127.0.0.1:4320';
app.use((req,res,next) => {
  if(req.headers.host !== '127.0.0.1:4320') return res.status(403).json({error:'errors.origin'});
  if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin !== origin) return res.status(403).json({error:'errors.origin'});
  next();
});
app.use(express.json({limit:'64kb'}));
const bad = code => Object.assign(new Error(code), {status:400});
function valuesFor(entity, body) {
  if(!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(k => !entity.fields.some(f => f.name === k))) throw bad('errors.invalid');
  const record = {};
  for(const f of entity.fields) {
    const v = body[f.name] ?? null;
    if(f.required && (v === null || v === '')) throw bad('errors.required');
    if(v !== null && ((f.type === 'text' && (typeof v !== 'string' || v.length > 10000)) ||
      (f.type === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) ||
      (f.type === 'boolean' && typeof v !== 'boolean') ||
      (f.type === 'reference' && (!Number.isSafeInteger(v) || v < 1)) ||
      (f.type === 'date' && (typeof v !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0,10) !== v)))) throw bad('errors.invalid');
    record[f.name] = v;
  }
  const errors = validateRecord(entity.name, record);
  if(!Array.isArray(errors) || errors.some(e=>typeof e !== 'string')) throw new Error('invalid domain contract');
  if(errors.length) throw bad(errors[0]);
  return record;
}
const encode = (entity,row) => Object.fromEntries(Object.entries(row).map(([k,v]) => [k,entity.fields.some(f=>f.name===k && f.type==='boolean') && v!==null ? !!v : v]));
const sqlValue = v => typeof v === 'boolean' ? Number(v) : v;
for(const entity of entities) {
  const table = quote(entity.name), route='/api/'+entity.name;
  app.get(route, (req,res) => res.json({data:db.prepare('SELECT * FROM '+table+' ORDER BY id').all().map(r=>encode(entity,r))}));
  app.post(route, (req,res) => {
    const values=valuesFor(entity,req.body), keys=Object.keys(values);
    const result=db.prepare('INSERT INTO '+table+' ('+keys.map(quote).join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(values).map(sqlValue));
    res.status(201).json({data:encode(entity,db.prepare('SELECT * FROM '+table+' WHERE id=?').get(result.lastInsertRowid))});
  });
  app.use(route+'/:id',(req,res,next)=>{ const id=Number(req.params.id); if(!Number.isSafeInteger(id)||id<1) return res.status(400).json({error:'errors.invalid'}); next(); });
  app.patch(route+'/:id',(req,res)=>{
    if(!db.prepare('SELECT id FROM '+table+' WHERE id=?').get(req.params.id)) return res.status(404).json({error:'errors.notFound'});
    const values=valuesFor(entity,req.body);
    db.prepare('UPDATE '+table+' SET '+Object.keys(values).map(k=>quote(k)+'=?').join(',')+' WHERE id=?').run(...Object.values(values).map(sqlValue),req.params.id);
    res.json({data:encode(entity,db.prepare('SELECT * FROM '+table+' WHERE id=?').get(req.params.id))});
  });
  app.delete(route+'/:id',(req,res)=>{const result=db.prepare('DELETE FROM '+table+' WHERE id=?').run(req.params.id);
    if(!result.changes) return res.status(404).json({error:'errors.notFound'}); res.json({data:null});});
}
app.use('/api',(req,res)=>res.status(404).json({error:'errors.notFound'}));
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if(process.argv.includes('--production')) app.use(express.static(path.join(root,'dist')));
else {const {createServer}=await import('vite'); const vite=await createServer({root,server:{middlewareMode:true,fs:{strict:true,allow:[path.join(root,'src'),path.join(root,'node_modules')],deny:['**/.env*','**/data/**','**/server/**']}},appType:'spa'}); app.use(vite.middlewares);}
app.use((err,req,res,next)=>res.status(err.status||400).json({error:err.status ? err.message : 'errors.invalid'}));
app.listen(4320,'127.0.0.1',()=>console.log(origin));
`,
    'src/api.js': `export const entities = ${json(contract.entities)};
async function request(entity, method='GET', id='', values) {
  if(!entities.some(e=>e.name===entity)) throw new Error('errors.invalid');
  const response=await fetch('/api/'+entity+(id!==''?'/'+encodeURIComponent(id):''),{method,headers:{'Content-Type':'application/json'},body:values===undefined?undefined:JSON.stringify(values)});
  const result=await response.json(); if(!response.ok) throw new Error(result.error||'errors.invalid'); return result.data;
}
export const api={list:entity=>request(entity),create:(entity,values)=>request(entity,'POST','',values),update:(entity,id,values)=>request(entity,'PATCH',id,values),remove:(entity,id)=>request(entity,'DELETE',id)};
`,
    'src/i18n.jsx': `import React,{createContext,useContext,useState,useEffect} from 'react';
import en from './locales/en.json'; import es from './locales/es.json';
const Context=createContext(null);
const saved=(key,allowed,fallback)=>{try{const v=localStorage.getItem(key);return allowed.includes(v)?v:fallback;}catch{return fallback;}};
export function I18nProvider({children}) {
  const [language,setLanguage]=useState(()=>saved('app.language',['en','es'],'en'));
  const [theme,setTheme]=useState(()=>saved('app.theme',['light','dark'],'light'));
  useEffect(()=>{document.documentElement.lang=language;document.documentElement.dataset.theme=theme;try{localStorage.setItem('app.language',language);localStorage.setItem('app.theme',theme);}catch{}},[language,theme]);
  const t=(key,values={})=>{const catalog=language==='es'?es:en;return (Object.hasOwn(catalog,key)?catalog[key]:key).replace(/\\{(\\w+)\\}/g,(_,name)=>String(values[name]??'{'+name+'}'));};
  return <Context.Provider value={{t,language,locale:language==='es'?'es':'en',theme,setLanguage,setTheme}}>{children}</Context.Provider>;
}
export const useI18n=()=>useContext(Context);
`,
    'src/AppShell.jsx': `import React from 'react'; import {useI18n} from './i18n.jsx';
export default function AppShell({children}){const {t,language,theme,setLanguage,setTheme}=useI18n();return <><header><label>{t('shell.language')}<select value={language} onChange={e=>setLanguage(e.target.value)}><option value="en">{t('shell.en')}</option><option value="es">{t('shell.es')}</option></select></label><label>{t('shell.theme')}<select value={theme} onChange={e=>setTheme(e.target.value)}><option value="light">{t('shell.light')}</option><option value="dark">{t('shell.dark')}</option></select></label></header><main>{children}</main></>;}
`,
    'src/themes.css': `:root,[data-theme="light"]{--bg:#f6f8fb;--surface:#fff;--text:#162234;--muted:#475569;--border:#64748b;--accent:#1742a1;--error:#a01919;color-scheme:light}
[data-theme="dark"]{--bg:#111827;--surface:#1e293b;--text:#f1f5f9;--muted:#cbd5e1;--border:#94a3b8;--accent:#93c5fd;--error:#fca5a5;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,sans-serif}main,header{max-width:1050px;margin:auto;padding:24px}header{display:flex;gap:20px;flex-wrap:wrap}button,input,select,textarea{font:inherit;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:10px}label{display:grid;gap:6px}button,a{cursor:pointer}a{color:var(--accent)}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}[role="alert"]{color:var(--error)}
`,
    'README.md': `# Local CRUD project

React + Express + SQLite. Node 22.13+ (22 branch), 23.4+ or newer.

## Status
Statically reviewed only. Dependencies were NOT installed and the application was NOT run, built, or tested during generation. No deployment or authentication.
See REVIEW.json and contract.json for scope, findings and evidence. No runtime success is implied.

## Manual startup after your separate authorization
1. Inspect source and package.json.
2. npm install
3. npm run dev
4. Open http://127.0.0.1:4320 and manually check create, edit, filter, delete, reload, languages, themes, keyboard access, and error handling.
SQLite tables are created at first startup in data/app.sqlite.
Optional: npm run build, then npm start.
Do not publish this local demonstration server.

## Included
English/Spanish, English first use, persisted language and light/dark themes, keyboard controls.
User data is never translated. UI translations remain in English and Spanish catalogs.
`
  };
  return contract.template === 'react-browser-local-v1' ? browserTemplateFiles(contract, files, namespace) : files;
}
export function baseCatalog(contract, language) {
  const en = language === 'en';
  const result = en ? { 'shell.language':'Language','shell.theme':'Theme','shell.light':'Light','shell.dark':'Dark','shell.en':'English','shell.es':'Spanish',
    'errors.invalid':'Invalid data or operation.','errors.required':'Complete required fields.','errors.notFound':'Record not found.','errors.origin':'Request not allowed.',
    'errors.storageUnavailable':'Browser storage is unavailable or full. Changes were not saved.','errors.storageInvalid':'Stored data is invalid. It was not overwritten.','errors.inUse':'This record is used by another record.' } :
    { 'shell.language':'Idioma','shell.theme':'Tema','shell.light':'Claro','shell.dark':'Oscuro','shell.en':'Inglés','shell.es':'Español',
      'errors.invalid':'Datos u operación no válidos.','errors.required':'Completa los campos obligatorios.','errors.notFound':'Registro no encontrado.','errors.origin':'Solicitud no permitida.',
      'errors.storageUnavailable':'El almacenamiento del navegador no está disponible o está lleno. Los cambios no se guardaron.','errors.storageInvalid':'Los datos guardados no son válidos. No se sobrescribieron.','errors.inUse':'Otro registro utiliza este registro.' };
  for (const e of contract.entities) { result['entity.'+e.name] = en?e.labelEn:e.labelEs;
    for(const f of e.fields) result['field.'+e.name+'.'+f.name] = en?f.labelEn:f.labelEs; }
  return result;
}
