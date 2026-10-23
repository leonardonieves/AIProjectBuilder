import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GenerationEngine, validateDelivery, generationPrompt } from '../server/generation-engine.js';
import { publishArtifact } from '../server/artifact-publication.js';
import { readContract, technicalContract, sha } from '../server/generation-contract.js';
import { staticReview } from '../server/generation-review.js';
import { zipFiles } from '../server/generation-zip.js';
import { specification, projectFixture, deliveries, fullFixture, MemoryStore } from './helpers/generation-fixture.js';

const consent = p => ({revision:p.revision,consent:true,destination:'managed-default',maxCorrections:2,validation:'static-only'});
test('Windows rename denial publishes identical files without replacing existing output', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'aipb-publish-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const stage=path.join(root,'stage'),destination=path.join(root,'app');
  await mkdir(stage);
  const files={'index.html':'example','src/locales/en.json':'{"title":"Tasks"}'};
  const denied=async()=>{throw Object.assign(new Error('Windows rename denied'),{code:'EPERM'});};
  await publishArtifact(stage,destination,files,denied);
  for(const [name,content] of Object.entries(files))assert.equal(await readFile(path.join(destination,name),'utf8'),content);
  await assert.rejects(()=>publishArtifact(stage,destination,{'index.html':'replacement'},denied),{code:'EEXIST'});
  assert.equal(await readFile(path.join(destination,'index.html'),'utf8'),'example');
});
test('publication does not mask unrelated rename failures', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'aipb-publish-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const destination=path.join(root,'app');
  await assert.rejects(()=>publishArtifact(path.join(root,'missing'),destination,{},async()=>{
    throw Object.assign(new Error('missing stage'),{code:'ENOENT'});
  }),{code:'ENOENT'});
  await assert.rejects(()=>readFile(path.join(destination,'index.html')),{code:'ENOENT'});
});
async function setup(t, handler, review=async()=>({mode:'static-only',runtimeExecuted:false,findings:[]})){
  const root=await mkdtemp(path.join(os.tmpdir(),'aipb-v2-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=projectFixture(),store=new MemoryStore(p),calls=[];
  // Pure stub: these timestamps are fixtures, never evidence of real Codex runs.
  const runner=async(root,g,{role},id,options)=>{calls.push(role);options.onStarted({at:'2026-10-19T12:00:00.000Z',pid:1});
    try{return await (handler?handler(role,options,calls,g):structuredClone(deliveries()[role]));}
    finally{options.onClosed({at:'2026-10-19T12:00:01.000Z',exitCode:0});}};
  return {root,p,store,calls,engine:new GenerationEngine(root,store,{runner,review})};
}
async function start(env){const g=env.engine.prepare(env.p);env.engine.start(env.p,g.id,consent(env.p));await env.engine.active.done;return env.engine.get(env.p.id,g.id);}

test('v2 contract is part of approval and denies invalid scope, names, references and legacy plans',()=>{
  const p=projectFixture();assert.equal(readContract(p.plan).template,'react-express-sqlite-v1');assert.equal(p.approval.sha256,sha(p.plan));
  assert.throws(()=>readContract('legacy plan'),/contractRequired/);
  for(const name of ['../escape','sqlite_private','constructor']){const s=specification();s.entities[0].name=name;assert.throws(()=>technicalContract(s));}
  const s=specification();s.entities[0].fields[0].type='reference';s.entities[0].fields[0].reference='missing';assert.throws(()=>technicalContract(s));
});
test('delivery and prompt share exact owned file list and no arbitrary scripts',()=>{
  const valid=deliveries().frontend;assert.equal(Object.keys(validateDelivery('frontend',valid)).length,4);
  const missing=structuredClone(valid);missing.files.pop();assert.throws(()=>validateDelivery('frontend',missing));
  const escape=structuredClone(valid);escape.files[0].path='../package.json';assert.throws(()=>validateDelivery('frontend',escape));
  const p=projectFixture();const prompt=generationPrompt('frontend',p,readContract(p.plan),{},[]);
  assert.match(prompt,/src\/locales\/en.json/);assert.match(prompt,/both themes/);assert.match(prompt,/Do not operate on a filesystem/);
});
test('prepare consumes no account and bounded explicit consent is mandatory',async t=>{
  const e=await setup(t),g=e.engine.prepare(e.p);assert.equal(e.calls.length,0);assert.equal(g.status,'prepared');
  assert.equal(e.engine.prepare(e.p).id,g.id);
  assert.throws(()=>e.engine.start(e.p,g.id,{...consent(e.p),consent:false}),/consentRequired/);
  assert.throws(()=>e.engine.start(e.p,g.id,{...consent(e.p),destination:'C:\\outside'}),/consentRequired/);
});
test('successful independent roles produce a manifest-only ZIP without data or credentials',async t=>{
  const e=await setup(t),g=await start(e);assert.equal(g.status,'completed');assert.deepEqual(e.calls,['frontend','backend','integration','reviewer']);
  assert.equal(g.report.runtimeExecuted,false);const archive=await e.engine.download(e.p.id,g.id);assert.equal(archive.readUInt32LE(0),0x04034b50);
  const names=g.finalArtifact.files.map(f=>f.path);assert.ok(names.includes('server/schema.json'));assert.ok(names.includes('REVIEW.json'));assert.ok(names.includes('.env.example'));
  assert.ok(!names.some(n=>n.includes('node_modules')||n.includes('codex-home')||n.endsWith('.sqlite')||n==='.env'));
  await writeFile(path.join(e.root,'generated-projects',g.id,'app','README.md'),'modified');await assert.rejects(()=>e.engine.download(e.p.id,g.id),/artifactChanged/);
});
test('one failed peer does not cancel completed logic; correction regenerates only affected roles',async t=>{
  let frontend=0;const e=await setup(t,async(role,options)=>{
    if(role==='frontend'&&frontend++===0)throw new Error('fixture failure');
    assert.equal(options.signal.aborted,false);return structuredClone(deliveries()[role]);});
  const g=await start(e);assert.equal(g.status,'completed');assert.equal(g.cycle,1);assert.equal(e.calls.filter(x=>x==='backend').length,1);assert.equal(e.calls.filter(x=>x==='frontend').length,2);assert.equal(e.calls.filter(x=>x==='integration').length,1);
});
test('correction budget is persistent and failed generation cannot reset or download',async t=>{
  const e=await setup(t,async role=>{if(role==='frontend')throw new Error('fixture failure');return deliveries()[role];});
  const g=await start(e);assert.equal(g.status,'failed');assert.equal(g.cycle,2);assert.equal(e.calls.filter(x=>x==='frontend').length,3);
  assert.equal(e.engine.prepare(e.p).id,g.id);assert.throws(()=>e.engine.start(e.p,g.id,consent(e.p)));await assert.rejects(()=>e.engine.download(e.p.id,g.id),/notReady/);
});
test('restart recovery does not spawn; stale approval prevents resumption',async t=>{
  const e=await setup(t);const g=e.engine.prepare(e.p);g.status='running';g.consent=consent(e.p);g.cycle=1;e.store.saveWorkflow(g);
  e.engine.recover();assert.equal(e.calls.length,0);assert.equal(e.engine.get(e.p.id,g.id).status,'interrupted');assert.equal(e.engine.get(e.p.id,g.id).cycle,1);
  const changed={...e.p,plan:e.p.plan+' changed'};assert.throws(()=>e.engine.resume(changed,g.id),/approvalRequired/);
});
test('cancellation waits for processes; retained files survive and resume has remaining budget',async t=>{
  let announce;const started=new Promise(r=>announce=r);let frontendCalls=0;
  const e=await setup(t,async(role,options)=>{
    if(role==='frontend'&&frontendCalls++===0){announce();await new Promise((resolve,reject)=>{
      const stop=()=>reject(Object.assign(new Error('cancel fixture'),{code:'CANCELLED'}));if(options.signal.aborted)stop();else options.signal.addEventListener('abort',stop,{once:true});});}
    return structuredClone(deliveries()[role]);});
  const g=e.engine.prepare(e.p);e.engine.start(e.p,g.id,consent(e.p));await started;
  // Let the other fixture finish before cancellation; no actual agent processes.
  for(let i=0;i<100&&!e.engine.get(e.p.id,g.id).selected.backend;i++)await new Promise(r=>setTimeout(r,10));
  assert.ok(e.engine.get(e.p.id,g.id).selected.backend);const done=e.engine.active.done;e.engine.cancel(e.p.id,g.id);await done;
  const paused=e.engine.get(e.p.id,g.id);assert.equal(paused.status,'cancelled');assert.ok(paused.selected.backend);
  e.engine.resume(e.p,g.id);await e.engine.active.done;assert.equal(e.engine.get(e.p.id,g.id).status,'completed');assert.equal(e.calls.filter(x=>x==='backend').length,1);
});
test('changed retained delivery blocks resume before new model calls',async t=>{
  const e=await setup(t);const g=await start(e);g.status='interrupted';g.finalArtifact=null;e.store.saveWorkflow(g);
  const role=g.attempts.find(a=>a.id===g.selected.backend);const location=path.join(e.root,'generated-projects',g.id,'attempts',role.id,'server','domain.js');
  await writeFile(location,'changed');const before=e.calls.length;e.engine.resume(e.p,g.id);await e.engine.active.done;
  assert.equal(e.calls.length,before);assert.equal(e.engine.get(e.p.id,g.id).error,'gen.artifactChanged');
});
test('independent reviewer blocks download and targets correction to owner',async t=>{
  let reviews=0, backendRuns=0, correctionPrompt='';const e=await setup(t,async(role,options)=>{
    if(role==='reviewer'&&reviews++===0)return {summary:'One issue',findings:[{role:'backend',file:'server/domain.js',code:'domain',message:'Fixture correction',blocking:true}]};
    const result=structuredClone(deliveries()[role]);
    if(role==='backend'&&backendRuns++>0){correctionPrompt=options.prompt;result.files[0].content='export function validateRecord(entity, values) { return entity && values ? [] : ["errors.invalid"]; }';}
    return result;
  });
  const g=await start(e);assert.equal(g.status,'completed',JSON.stringify({error:g.error,feedback:g.feedback,report:g.report,attempts:g.attempts.map(a=>({role:a.role,status:a.status,error:a.error}))}));assert.equal(g.cycle,1);assert.equal(e.calls.filter(x=>x==='frontend').length,1);assert.equal(e.calls.filter(x=>x==='backend').length,2);assert.equal(e.calls.filter(x=>x==='integration').length,1);
  assert.match(correctionPrompt,/export function validateRecord\(entity, values\)/);
  assert.match(correctionPrompt,/Fixture correction/);
});
test('reviewer file ownership is normalized without spending correction cycles',async t=>{
  const e=await setup(t,async role=>role==='reviewer'?
    {summary:'Static review only',findings:[{role:'backend',file:'server/index.js',code:'ownership',message:'Template observation',blocking:false}]}:
    structuredClone(deliveries()[role]));
  const g=await start(e);
  assert.equal(g.status,'completed');assert.equal(g.cycle,0);
  assert.equal(e.calls.filter(x=>x==='reviewer').length,1);
  const finding=g.report.findings.find(f=>f.code==='ownership');
  assert.equal(finding.role,'template');assert.equal(finding.claimedRole,'backend');
});
test('reviewer network objection to the immutable same-origin template is retained but not blocking',async t=>{
  const e=await setup(t,async role=>role==='reviewer'?
    {summary:'Static source review only',findings:[{role:'integration',file:'src/api.js',code:'request',
      message:'The template fetch is a network client under the no-network-clients rule.',blocking:true}]}:
    structuredClone(deliveries()[role]));
  const g=await start(e);
  assert.equal(g.status,'completed');
  const finding=g.report.findings.find(f=>f.code==='request');
  assert.equal(finding.role,'template');
  assert.equal(finding.claimedRole,'integration');
  assert.equal(finding.originalBlocking,true);
  assert.equal(finding.blocking,false);
  assert.equal(finding.adjudication.method,'approved-same-origin-template-adapter');
});
test('verified primary button colors can overturn only a matching contrast objection',async t=>{
  const frontend=structuredClone(deliveries().frontend);
  frontend.files.find(file=>file.path==='src/styles.css').content=`:root { --app-surface: var(--surface, #fff); --app-accent: var(--accent, #1742a1); }
.primary-button { color: var(--app-surface) !important; background: var(--app-accent); border-color: var(--app-accent); }`;
  const e=await setup(t,async role=>role==='reviewer'?
    {summary:'Contrast concern',findings:[{role:'frontend',file:'src/styles.css',code:'theme_colors',
      message:'The primary button text may lack contrast against its background.',blocking:true}]}:
    structuredClone(role==='frontend'?frontend:deliveries()[role]));
  const g=await start(e);
  assert.equal(g.status,'completed');
  const finding=g.report.findings.find(item=>item.code==='theme_colors');
  assert.equal(finding.originalBlocking,true);
  assert.equal(finding.adjudication.method,'static-color-contrast');
  assert.deepEqual(finding.adjudication.ratios,[9.01,8.11]);
  assert.equal(e.calls.filter(role=>role==='frontend').length,1);
});
test('reassessment rechecks a retained reviewer finding without another agent call',async t=>{
  const frontend=structuredClone(deliveries().frontend);
  frontend.files.find(file=>file.path==='src/styles.css').content=`:root { --app-surface: var(--surface, #fff); --app-accent: var(--accent, #1742a1); }
.primary-button { color: var(--app-surface) !important; background: var(--app-accent); }`;
  const e=await setup(t,async role=>role==='reviewer'?
    {summary:'Older blocking review',findings:[{role:'frontend',file:'src/styles.css',code:'layout',
      message:'Fixture blocker',blocking:true}]}:
    structuredClone(role==='frontend'?frontend:deliveries()[role]));
  const failed=await start(e);
  assert.equal(failed.status,'failed');
  assert.equal(failed.error,'gen.correctionsExhausted');
  const reviewer=failed.attempts.find(attempt=>attempt.role==='reviewer');
  reviewer.review={summary:'Older contrast review',findings:[{role:'frontend',file:'src/styles.css',code:'theme_colors',
    message:'The primary button text lacks contrast against its accent background.',blocking:true}]};
  reviewer.rawReview=structuredClone(reviewer.review);
  e.store.saveWorkflow(failed);
  const before=e.calls.length;
  await e.engine.reassess(e.p,failed.id,{revision:e.p.revision,consent:true,validation:'static-only'});
  await e.engine.active.done;
  const result=e.engine.get(e.p.id,failed.id);
  assert.equal(result.status,'completed',JSON.stringify({error:result.error,report:result.report,attempts:result.attempts.map(attempt=>({role:attempt.role,status:attempt.status,sourceHash:attempt.sourceHash}))}));
  assert.equal(e.calls.length,before);
  assert.equal(result.report.reviewerReevaluated,true);
  assert.equal(result.report.findings.find(item=>item.code==='theme_colors').blocking,false);
});
test('static inspection checks syntax, imports, catalog parity, API names and safe template exports without running generated code',async()=>{
  const {files,contract}=fullFixture();const result=await staticReview(files,contract);assert.deepEqual(result.findings,[]);assert.equal(result.runtimeExecuted,false);
  const broken={...files,'src/App.jsx':"import React from 'react'; import {wrong} from './api.js'; export default function App(){ return <div>Hello</div>; }"};
  const report=await staticReview(broken,contract);assert.ok(report.findings.some(f=>f.code==='missing_export'));assert.ok(report.findings.some(f=>f.code==='untranslated_text'));
  const mismatch=await staticReview({...files,'src/locales/es.json':'{}'},contract);assert.ok(mismatch.findings.some(f=>f.code==='catalog_parity'));
  const invalid=await staticReview({...files,'server/domain.js':'export function validateRecord('},contract);assert.ok(invalid.findings.some(f=>f.code==='syntax'));
  const apiMismatch=await staticReview({...files,'src/App.jsx':"import {api} from './api.js'; export default function App(){api.list('missing');return null;}"},contract);assert.ok(apiMismatch.findings.some(f=>f.code==='api_entity'));
});
test('static inspection permits only the shared local theme CSS import',async()=>{
  const {files,contract}=fullFixture();
  const local=await staticReview({...files,'src/styles.css':"@import './themes.css';\n.task { color: var(--text); }"},contract);
  assert.ok(!local.findings.some(f=>f.code==='external_style'));
  for(const reference of ["@import 'https://example.com/theme.css';", "@import './other.css';", "a { background: url('https://example.com/a.png'); }"]){
    const remote=await staticReview({...files,'src/styles.css':reference},contract);
    assert.ok(remote.findings.some(f=>f.code==='external_style'));
  }
});
test('ZIP rejects traversal',()=>assert.throws(()=>zipFiles({'../escape':'no'}),/unsafePath/));
test('wizard EN/ES catalogs have matching keys and nonempty values',async()=>{
  const en=JSON.parse(await readFile(new URL('../src/locales/generator-en.json',import.meta.url),'utf8'));
  const es=JSON.parse(await readFile(new URL('../src/locales/generator-es.json',import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(en).sort(),Object.keys(es).sort());assert.ok([...Object.values(en),...Object.values(es)].every(v=>typeof v==='string'&&v.trim()));
});
