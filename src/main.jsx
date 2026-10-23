import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider, PreferenceControls, useI18n } from './i18n.jsx';
import ProjectHistory from './ProjectHistory.jsx';
import { projectDownloadFilename } from '../shared/download-name.js';
import './styles.css';
import './themes.css';
import './wizard.css';

async function api(url, method='GET', body, signal) {
  const response=await fetch('/api'+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'gen.requestFailed');return result;
}
function Steps({step,available,onSelect}) {const {t}=useI18n();return <ol className="wizard-steps" aria-label={t('wizard.steps')}>
  {['idea','proposal','generate','download'].map((name,i)=><li key={name} aria-current={step===i+1?'step':undefined}>
    {onSelect?<button type="button" disabled={!available?.[i]} onClick={()=>onSelect(i+1)} aria-current={step===i+1?'step':undefined}><span className="step-number">{i<step-1?'✓':i+1}</span><span>{t('wizard.'+name)}</span></button>:<><span className="step-number">{i+1}</span>{t('wizard.'+name)}</>}
  </li>)}
</ol>;}
const phases=['workers','integration','review','packaging','completed'];
const progressAt={workers:12,integration:36,review:62,packaging:86,completed:100};
function GenerationProgress({generation,t,connected}) {
  const {language,date}=useI18n();
  const [now,setNow]=useState(Date.now());
  const live=connected&&['running','cancelling'].includes(generation.status);
  useEffect(()=>{if(!live)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[live,generation.id]);
  const elapsed=attempt=>{
    const start=Date.parse(attempt.processStartedAt||attempt.requestedAt);
    const end=Date.parse(attempt.processClosedAt||attempt.finishedAt);
    if(!Number.isFinite(start))return '—';
    const seconds=Math.max(0,Math.floor(((Number.isFinite(end)?end:now)-start)/1000));
    return new Intl.NumberFormat(language).format(seconds)+' '+t('wizard.seconds');
  };
  const activeStage=phases.includes(generation.stage)?generation.stage:generation.failure?.stage;
  const current=phases.indexOf(activeStage);
  const progress=generation.status==='completed'?100:progressAt[activeStage]||0;
  const working=live;
  const roles=['frontend','backend','integration','reviewer'];
  return <div className="generation-progress" role="region" aria-label={t('wizard.progressTitle')}>
    <div className="progress-heading"><div><p className="eyebrow">{t('wizard.progressEyebrow')}</p><h3>{t('wizard.'+(working&&generation.status==='cancelling'?'cancelling':generation.stage))}</h3></div>
      <span className={`progress-status ${working?'is-live':''}`} role="status">{working&&<span className="live-dot"/>}{t(connected?'status.'+generation.status:'wizard.activityUnknown')}</span></div>
    <p className="progress-description">{t('wizard.stageHelp.'+(activeStage||'prepared'))}</p>
    <div className="progress-track" role="progressbar" aria-label={t('wizard.progressTitle')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress} aria-valuetext={t('wizard.progressMilestone',{percent:progress})}>
      <span style={{width:`${progress}%`}} className={working?'is-animated':''}/>
    </div>
    <div className="phase-list" role="list">{phases.map((phase,index)=>{
      const done=generation.status==='completed'||(current>=0&&index<current);
      const active=working&&index===current;
      return <div key={phase} role="listitem" className={`phase ${done?'is-done':''} ${active?'is-active':''}`} aria-current={active?'step':undefined}>
        <span className="phase-marker">{done?'✓':index+1}</span><span>{t('wizard.phase.'+phase)}</span>
      </div>;
    })}</div>
    <div className="progress-footer"><span>{t('wizard.progressMilestone',{percent:progress})}</span><span>{t('wizard.cycle')}: {generation.cycle} / {generation.maxCorrections}</span></div>
    <div className="role-progress" aria-label={t('wizard.workstreamTitle')}>{roles.map(role=>{
      const attempt=generation.attempts?.findLast(item=>item.role===role);
      return <div className="role-chip" key={role}><span className={working&&attempt?.status==='running'?'role-pulse':''}/><div>{t('role.'+role)}<small>{attempt?elapsed(attempt):t('wizard.waiting')}</small></div><b>{t(!connected&&attempt?.status==='running'?'wizard.activityUnknown':attempt?'status.'+attempt.status:'wizard.waiting')}</b></div>;
    })}</div>
    {generation.attempts?.length>0&&<div className="generation-activity"><h4>{t('wizard.activityTitle')}</h4><ol>{generation.attempts.slice(-8).reverse().map(attempt=><li key={attempt.id}><div><strong>{t('role.'+attempt.role)}</strong><span>{t('status.'+attempt.status)}</span></div><time>{date(attempt.finishedAt||attempt.processStartedAt||attempt.requestedAt)}</time>{attempt.error&&<p>{t(attempt.error)}</p>}</li>)}</ol></div>}
    <p className="progress-note">{t('wizard.progressNote')}</p>
  </div>;
}
function section(plan, ...headings){for(const heading of headings){const value=plan.split('## '+heading+'\n')[1]?.split('\n## ')[0]?.trim();if(value)return value;}return '';}

function ProjectWizard({project,onChange,onRefresh,onDelete}) {
  const {t,date,language}=useI18n();
  const [plan,setPlan]=useState(project.plan),[proposal,setProposal]=useState(null),[records,setRecords]=useState([]),[legacy,setLegacy]=useState([]);
  const [consent,setConsent]=useState(false),[plannerConsent,setPlannerConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[connected,setConnected]=useState(false),[generatingPlan,setGeneratingPlan]=useState(false);
  const [viewStep,setViewStep]=useState(null),[deleteName,setDeleteName]=useState('');
  const prefix='/projects/'+project.id;
  const generation=records.find(g=>g.revision===project.revision&&g.approvedHash===project.approval?.sha256);
  const running=['running','cancelling'].includes(generation?.status);
  const planning=generatingPlan||['starting','running','cancelling'].includes(project.planningRun?.status);
  const locked=busy||running||planning,dirty=plan!==project.plan;
  useEffect(()=>{setPlan(project.plan);setConsent(false);setPlannerConsent(false);setViewStep(null);},[project.plan,project.approval?.sha256]);
  useEffect(()=>{
    const controller=new AbortController();let timer,stopped=false;
    async function refresh(){try{
      const [p,g,d]=await Promise.all([api(prefix+'/proposal','GET',undefined,controller.signal),api(prefix+'/generations','GET',undefined,controller.signal),api(prefix+'/dashboard','GET',undefined,controller.signal)]);
      if(stopped)return;setProposal(p);setRecords(g);setLegacy(d.workflows);setConnected(true);
    }catch(e){if(!stopped)setConnected(false);}finally{if(!stopped)timer=setTimeout(refresh,1800);}}
    setConnected(false);refresh();return()=>{stopped=true;clearTimeout(timer);controller.abort();};
  },[prefix,project.revision]);
  useEffect(()=>{if(!planning)return;const timer=setInterval(onRefresh,2000);return()=>clearInterval(timer);},[planning,onRefresh]);
  async function action(fn){setBusy(true);setError('');try{await fn();return true;}catch(e){setError(e.message);return false;}finally{setBusy(false);}}
  async function prepare(p){const g=await api(prefix+'/generations/prepare','POST',{revision:p.revision});setRecords(old=>[g,...old.filter(x=>x.id!==g.id)]);}
  async function generationAction(name,body){await action(async()=>{const g=await api(prefix+'/generations/'+generation.id+'/'+name,'POST',body||{});setRecords(old=>[g,...old.filter(x=>x.id!==g.id)]);setConsent(false);if(['start','resume','reassess'].includes(name))setViewStep(3);});}
  async function download(g){await action(async()=>{
    const response=await fetch('/api'+prefix+'/generations/'+g.id+'/download');if(!response.ok){const e=await response.json();throw new Error(e.error||'gen.requestFailed');}
    const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=projectDownloadFilename(project.brief.name)+'.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  });}
  const readyForGeneration=proposal?.approved===true&&!!proposal.contract;
  const completed=generation?.status==='completed';
  const recommendedStep=completed?4:readyForGeneration?3:2;
  const available=[true,true,readyForGeneration,completed];
  // Active work must remain visible even after navigation or a polling refresh.
  const step=running?3:viewStep&&available[viewStep-1]?viewStep:recommendedStep;
  return <>
    <Steps step={step} available={available} onSelect={setViewStep}/><div className="workflow-intro"><p className="eyebrow">{t('wizard.stepEyebrow',{step})}</p><h1>{project.brief.name}</h1><p className="lead">{project.brief.description}</p><p className="step-guidance">{t('wizard.stepHelp.'+['idea','proposal','generate','download'][step-1])}</p></div>
    {!connected&&<p role="status" className="notice">{t(proposal?'wizard.connection':'wizard.loading')}</p>}
    {error&&<p role="alert" className="error">{t(error)}</p>}
    {step===1&&<section><h2>{t('wizard.idea')}</h2><p>{project.brief.description}</p>{project.brief.context&&<p>{project.brief.context}</p>}
      <button className="primary" onClick={()=>setViewStep(readyForGeneration?3:2)}>{t(readyForGeneration?'wizard.skipToGeneration':'wizard.reviewProposal')}</button></section>}
    {step===2&&<section aria-label={t('wizard.proposal')}>
      {proposal?.problem&&project.revision>1&&<p className="notice">{t('wizard.legacy')} {t(proposal.problem)}</p>}
      {proposal?.contract&&<>
        <div className="proposal-grid"><article><h2>{t('wizard.included')}</h2><p className="preserve-lines">{section(project.plan,'Included scope','Alcance incluido')}</p></article>
          <article><h2>{t('wizard.excluded')}</h2><p className="preserve-lines">{section(project.plan,'Out of scope','Fuera de alcance')}</p></article></div>
        <h2>{t('wizard.expected')}</h2><p className="preserve-lines">{section(project.plan,'Objective and summary','Objetivo y resumen')}</p>
        <p className="notice">{t('wizard.templateChoice')}: {t('wizard.template.'+proposal.contract.template)}</p>
        <h3>{t('wizard.entities')}</h3><ul>{proposal.contract.entities.map(e=><li key={e.name}>{language==='es'?e.labelEs:e.labelEn}</li>)}</ul>
        <p>{t('wizard.deliverable')}</p>
        {readyForGeneration?<button className="primary" disabled={locked||dirty} onClick={()=>setViewStep(3)}>{t('wizard.skipToGeneration')}</button>:
          <button className="primary" disabled={locked||dirty||!connected||project.needsReplanning} onClick={()=>action(async()=>{const p=await api(prefix+'/approve','POST',{revision:project.revision});onChange(p);await prepare(p);setViewStep(3);})}>{t('wizard.approve')}</button>}
      </>}
      <div className="planning-controls"><label className="consent"><input type="checkbox" checked={plannerConsent} disabled={locked} onChange={e=>setPlannerConsent(e.target.checked)}/>{t('wizard.plannerConsent')}</label>
        <button disabled={locked||dirty||!plannerConsent} onClick={()=>action(async()=>{setGeneratingPlan(true);try{const p=await api(prefix+'/generate-plan','POST',{revision:project.revision,consent:true});onChange(p);setPlannerConsent(false);}finally{setGeneratingPlan(false);onRefresh();}})}>{t(proposal?.contract?'wizard.refreshPlan':'wizard.plan')}</button>
        {planning&&<p role="status">{t('wizard.planning')}</p>}
        {planning&&project.planningRun?.id&&<button onClick={()=>api(prefix+'/planner/'+project.planningRun.id+'/cancel','POST',{}).catch(e=>setError(e.message))}>{t('Cancelar planificación')}</button>}
      </div>
    </section>}
    {step===3&&!generation&&<section><p>{t('wizard.approved')}</p><button className="primary" disabled={locked||!connected} onClick={()=>action(()=>prepare(project))}>{t('wizard.prepare')}</button></section>}
    {generation&&step>=3&&<section aria-label={t('wizard.generate')}>
      <GenerationProgress generation={generation} t={t} connected={connected}/>
      {generation.error&&<p role="alert" className="error">{t(generation.error)}</p>}
      {generation.status!=='completed'&&<p className="muted">{t('wizard.destination')}<br/><code>{generation.resultDirectory}</code></p>}
      {generation.status==='prepared'&&<><h3>{t('wizard.authorization')}</h3><label className="consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>{t('wizard.consent')}</label>
        <button className="primary" disabled={locked||dirty||!consent||!connected} onClick={()=>generationAction('start',{revision:project.revision,consent:true,destination:'managed-default',maxCorrections:2,validation:'static-only'})}>{t('wizard.start')}</button></>}
      {running&&<button disabled={busy||!connected||generation.status==='cancelling'} onClick={()=>generationAction('cancel')}>{t('wizard.cancel')}</button>}
      {(['interrupted','cancelled'].includes(generation.status)||(generation.status==='blocked'&&generation.error==='gen.internal'&&generation.failure?.stage==='packaging'))&&<><p>{t('wizard.resumeNote')}</p><button disabled={locked||dirty||!connected} onClick={()=>generationAction('resume')}>{t('wizard.resume')}</button></>}
      {generation.status==='failed'&&generation.error==='gen.correctionsExhausted'&&!generation.reassessmentAt&&['frontend','backend','integration'].every(role=>generation.deliveries.some(d=>d.role===role))&&<>
        <p>{t('wizard.reassessNote')}</p>
        <label className="consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>{t('wizard.reassessConsent')}</label>
        <button className="primary" disabled={locked||dirty||!consent||!connected} onClick={()=>generationAction('reassess',{revision:project.revision,consent:true,validation:'static-only'})}>{t('wizard.reassess')}</button>
      </>}
      {generation.report?.findings?.some(finding=>finding.blocking)&&<section aria-label={t('wizard.blockingFindings')}>
        <h3>{t('wizard.blockingFindings')}</h3>
        <ul>{generation.report.findings.filter(finding=>finding.blocking).map((finding,index)=><li key={`${finding.file}:${finding.code}:${index}`}>
          <code>{finding.file}</code> · {finding.message||finding.code}
        </li>)}</ul>
      </section>}
      <p className="muted">{t('wizard.cycle')}: {generation.cycle} / {generation.maxCorrections}</p>
      {generation.status==='completed'?<>
        <div className="download-ready"><span aria-hidden="true">✓</span><div><h2>{t('wizard.readyTitle')}</h2><p className="approved">{t('wizard.unverified')}</p></div></div><p>{t('wizard.warning')}</p>
        <p className="download-filename">{t('wizard.downloadFilename')}<br/><code>{projectDownloadFilename(project.brief.name)}.zip</code></p>
        <p>{t(proposal?.contract?.template==='react-browser-local-v1'?'wizard.manualBrowser':'wizard.manualFullstack')}</p>
        <button className="primary" disabled={busy||!connected} onClick={()=>download(generation)}>{t('wizard.zip')}</button>
        <p>{t('wizard.created')}<br/><code>{generation.resultDirectory}</code></p>
        <details><summary>{t('wizard.files')}</summary><ul>{generation.finalArtifact.files.map(f=><li key={f.path}><code>{f.path}</code></li>)}</ul></details>
      </>:generation.deliveries.length>0?<details><summary>{t('wizard.deliveries')}</summary>{generation.deliveries.map(d=><p key={d.role}>{t('role.'+d.role)}<br/><code>{d.directory}</code></p>)}</details>:<p className="muted">{t('wizard.noDeliveries')}</p>}
    </section>}
    <details className="technical"><summary>{t('wizard.technical')}</summary>
      <details><summary>{t('wizard.planTechnical')}</summary><p>{t('wizard.planEdit')}</p>
        <textarea className="editor" aria-label={t('wizard.planTechnical')} rows={18} maxLength={50000} value={plan} disabled={locked} onChange={e=>setPlan(e.target.value)}/>
        <button disabled={locked||!dirty} onClick={()=>action(async()=>onChange(await api(prefix+'/plan','PUT',{revision:project.revision,plan})))}>{t('Guardar cambios')}</button></details>
      {generation&&<><h3>{t('wizard.attempts')}</h3>{generation.attempts.map(a=><article className="attempt" key={a.id}><b>{t('role.'+a.role)} · {t('status.'+a.status)}</b><p>{a.model} · <code>{a.id}</code></p>
        <p>{t('Proceso iniciado:')} {date(a.processStartedAt)} · {t('Fin:')} {date(a.processClosedAt)}</p>{a.error&&<p className="error">{t(a.error)}</p>}
        {a.summary&&<details><summary>{t('wizard.summary')}</summary><p>{a.summary}</p></details>}</article>)}
        {generation.failure&&<pre>{JSON.stringify(generation.failure,null,2)}</pre>}
        {generation.report&&<details><summary>{t('wizard.report')}</summary><pre>{JSON.stringify(generation.report,null,2)}</pre></details>}</>}
      <ProjectHistory project={project} busy={locked} dirty={dirty} onContinue={changes=>action(async()=>onChange(await api(prefix+'/continue','POST',{revision:project.revision,changes})))}/>
      <details><summary>{t('wizard.historical')}</summary>{records.filter(g=>g.id!==generation?.id).map(g=><article key={g.id}><p>{date(g.createdAt)} · {t('Revisión')} {g.revision} · {t('status.'+g.status)}</p>{g.status==='completed'&&<button disabled={busy} onClick={()=>download(g)}>{t('wizard.zip')}</button>}</article>)}
        {legacy.map(w=><details key={w.id}><summary>{t('Revisión')} {w.revision} · {w.status}</summary><pre>{JSON.stringify(w,null,2)}</pre></details>)}</details>
    </details>
    <details className="project-delete"><summary>{t('wizard.deleteProject')}</summary><p>{t('wizard.deleteWarning')}</p>
      <label>{t('wizard.deleteTypeName',{name:project.brief.name})}<input value={deleteName} onChange={e=>setDeleteName(e.target.value)} autoComplete="off"/></label>
      <button className="danger" type="button" disabled={locked||!connected||deleteName!==project.brief.name} onClick={()=>action(()=>onDelete(project))}>{t('wizard.confirmDelete')}</button>
    </details>
  </>;
}

function App(){const {t}=useI18n();const [projects,setProjects]=useState([]),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [brief,setBrief]=useState({name:'',description:'',context:''});
  const refresh=useCallback(()=>api('/projects').then(setProjects).catch(e=>setError(e.message)),[]);
  useEffect(()=>{refresh();},[refresh]);
  function accept(p){setProjects(old=>[p,...old.filter(x=>x.id!==p.id)]);setSelected(p.id);}
  async function deleteProject(p){await api('/projects/'+p.id,'DELETE',{name:p.brief.name,revision:p.revision});setProjects(old=>old.filter(x=>x.id!==p.id));setSelected(null);}
  const project=projects.find(p=>p.id===selected);
  return <div className="layout"><aside><div className="brand">AI Project Builder</div><button onClick={()=>{setSelected(null);setError('');}}>{t('＋ Nuevo proyecto')}</button>
    <nav aria-label={t('Proyectos')}>{projects.map(p=><button key={p.id} className={selected===p.id?'active':''} onClick={()=>setSelected(p.id)}>{p.brief.name}</button>)}</nav><footer>{t('Entorno local · Solo datos ficticios')}</footer></aside>
    <main><PreferenceControls/><p className="muted">{t('wizard.baseline')}</p>{error&&<p className="error" role="alert">{t(error)}</p>}
      {project?<ProjectWizard key={project.id} project={project} onChange={accept} onRefresh={refresh} onDelete={deleteProject}/>:<><Steps step={1}/><h1>{t('wizard.title')}</h1><p className="lead">{t('wizard.subtitle')}</p><p>{t('wizard.scope')}</p>
        <form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{accept(await api('/projects','POST',brief));}catch(err){setError(err.message);}finally{setBusy(false);}}}>
          <label>{t('Nombre del proyecto')}<input required maxLength={100} value={brief.name} onChange={e=>setBrief({...brief,name:e.target.value})} placeholder={t('Mi gestor de tareas')}/></label>
          <label>{t('¿Qué aplicación necesitas?')}<textarea required rows={5} maxLength={20000} value={brief.description} onChange={e=>setBrief({...brief,description:e.target.value})}/></label>
          <label>{t('Contexto, restricciones y resultado esperado')}<textarea rows={3} maxLength={20000} value={brief.context} onChange={e=>setBrief({...brief,context:e.target.value})}/></label>
          <button className="primary" disabled={busy}>{t('wizard.create')}</button>
        </form></>}
    </main></div>;
}
createRoot(document.getElementById('root')).render(<I18nProvider><App/></I18nProvider>);


