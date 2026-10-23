import { createProject, editPlan, approvePlan } from '../../server/domain.js';
import { contractBlock, technicalContract } from '../../server/generation-contract.js';
import { baseCatalog, templateFiles } from '../../server/generation-template.js';

export const specification = () => ({ supported:true,limitations:[],entities:[{name:'tasks',labelEn:'Tasks',labelEs:'Tareas',fields:[
  {name:'title',type:'text',required:true,reference:'',labelEn:'Title',labelEs:'Título'},
  {name:'due',type:'date',required:false,reference:'',labelEn:'Due date',labelEs:'Fecha'},
  {name:'completed',type:'boolean',required:true,reference:'',labelEn:'Completed',labelEs:'Completada'}
]}] });
export function projectFixture(){const p=createProject({name:'Fixture',description:'Fictional task CRUD'});
  editPlan(p,{revision:1,plan:'# Fixture\nLocal CRUD, i18n EN/ES and dark/light. No runtime validation.'+contractBlock(specification())});approvePlan(p,{revision:p.revision});return p;}
export function deliveries(){return {
  frontend:{summary:'Source fixture, not executed.',files:[
    {path:'src/App.jsx',content:"import React from 'react'; import {useI18n} from './i18n.jsx'; export default function App(){ const {t}=useI18n(); return <h1>{t('app.title')}</h1>; }"},
    {path:'src/styles.css',content:'main { color: var(--text); }'},
    {path:'src/locales/en.json',content:'{"app.title":"Tasks"}'},
    {path:'src/locales/es.json',content:'{"app.title":"Tareas"}'}]},
  backend:{summary:'Source fixture.',files:[{path:'server/domain.js',content:'export function validateRecord(entity, values) { return []; }'}]},
  integration:{summary:'Connected fixture.',files:[{path:'src/main.jsx',content:"import React from 'react'; import {createRoot} from 'react-dom/client'; import App from './App.jsx'; import AppShell from './AppShell.jsx'; import {I18nProvider} from './i18n.jsx'; import './themes.css'; import './styles.css'; createRoot(document.getElementById('root')).render(<I18nProvider><AppShell><App/></AppShell></I18nProvider>);"}]},
  reviewer:{summary:'Static fixture review only.',findings:[]}
};}
export function fullFixture(){const contract=technicalContract(specification());const files=templateFiles(contract);
  for(const result of Object.values(deliveries()))for(const f of result.files||[])files[f.path]=f.content;
  for(const lang of ['en','es']){const file='src/locales/'+lang+'.json';files[file]=JSON.stringify({...JSON.parse(files[file]),...baseCatalog(contract,lang)});}
  return {files,contract};}
export class MemoryStore {
  constructor(project){this.project=structuredClone(project);this.rows=new Map();}
  load(id){if(id!==this.project.id)throw new Error('not found');return structuredClone(this.project);}
  list(){return [this.load(this.project.id)];}
  workflows(){return [...this.rows.values()].map(x=>structuredClone(x));}
  saveWorkflow(g){this.rows.set(g.id,structuredClone(g));return g;}
}
