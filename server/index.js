import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createProject, editPlan, approvePlan, requireRevision, continueProject } from './domain.js';
import { generatePlan } from './planner.js';
import { ProjectStore } from './store.js';
import { POC_MODEL } from './model-policy.js';
import { prepareWorkflow, matchesApproval } from './coordinator.js';
import { workerContract, resultDirectory } from './worker-contract.js';
import { runWorker } from './worker-runner.js';
import { readVerifiedOutputs, assembleFinal } from './integration.js';
import { GenerationEngine } from './generation-engine.js';
import { readContract, sha } from './generation-contract.js';
import { assertTemplateMatchesBrief } from './brief-capabilities.js';
import { projectContentDisposition } from '../shared/download-name.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const port = 4310;
const origin = 'http://127.0.0.1:' + port;
let ready = false;
app.use((req, res, next) => ready ? next() : res.status(503).json({ error: 'Inicializando almacenamiento.' }));
// Reserve the single application port BEFORE migration/recovery. A second server must not
// mark a live run as interrupted or import JSON while the old server is still running.
const server = app.listen(port, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
let store;
try {
  store = new ProjectStore(root);
  const imported = store.importLegacy(path.join(root, 'data', 'projects'));
  if (imported) console.log('Proyectos JSON importados a SQLite: ' + imported + '. Originales conservados.');
  store.recoverInterrupted();
} catch (error) {
  store?.close(); server.close(); throw error;
}
const load = id => store.load(id);
const save = project => store.save(project);
const generations = new GenerationEngine(root, store);
generations.recover();
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (req.headers.host !== '127.0.0.1:' + port) return res.status(403).json({ error: 'Host no permitido.' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== origin)
    return res.status(403).json({ error: 'Origen no permitido.' });
  next();
});
app.use(express.json({ limit: '100kb' }));

// Serialize mutations: revision check and write must be one critical section.
let queue = Promise.resolve();
function mutate(fn) { const pending = queue.then(fn); queue = pending.catch(() => {}); return pending; }
// One real planner at a time; never queue an unbounded number of model calls.
let activePlanning = null;
let plannerController = null;
let activeImplementation = null;
function requireIdle() {
  if (generations.busy) throw Object.assign(new Error('gen.busy'), { status: 409 });
  if (activePlanning) throw Object.assign(new Error('Hay una planificación en curso. Espera a que termine.'), { status: 409 });
  if (activeImplementation) throw Object.assign(new Error('Hay una implementación en curso. Espera a que termine.'), { status: 409 });
}
app.get('/api/planner', (req, res) => res.json({ provider: 'Codex CLI', active: activePlanning }));
app.post('/api/projects/:id/generate-plan', async (req, res) => {
  if (req.body?.consent !== true) return res.status(400).json({ error: 'Debes confirmar el envío a Codex y el consumo de cuenta.' });
  const runId = randomUUID();
  const project = await mutate(async () => {
    requireIdle();
    const p = await load(req.params.id);
    requireRevision(p, req.body.revision);
    activePlanning = { projectId: p.id, runId, startedAt: new Date().toISOString() };
    try {
      plannerController = new AbortController();
      p.planningRun = { id: runId, revision: p.revision, requestedModel: POC_MODEL, status: 'starting', startedAt: activePlanning.startedAt };
      p.events.push({ at: activePlanning.startedAt, message: 'Inicio del planificador solicitado. Ejecución ' + runId });
      await save(p);
      return p;
    } catch (error) { activePlanning = null; plannerController = null; throw error; }
  });
  try {
    const result = await generatePlan(root, { ...project.brief, previousPlan: project.continuation ? project.plan : null }, runId, {
      signal: plannerController.signal,
      onStarted: ({ at, pid }) => {
        const p = load(project.id);
        p.planningRun = { ...p.planningRun, status: plannerController.signal.aborted ? 'cancelling' : 'running', processStartedAt: at, pid };
        p.events.push({ at, message: 'Proceso independiente del planificador iniciado. Ejecución ' + runId });
        save(p);
      }
    });
    const updated = await mutate(async () => {
      const p = await load(project.id);
      if (plannerController.signal.aborted) throw Object.assign(new Error('Planificación cancelada.'), { code: 'CANCELLED' });
      requireRevision(p, project.revision);
      editPlan(p, { revision: project.revision, plan: result.plan });
      p.planOrigin = 'codex';
      p.needsReplanning = false;
      p.planningRun = { ...p.planningRun, status: 'completed', finishedAt: result.finishedAt };
      p.planner = { runId, provider: 'codex-cli', requestedModel: result.requestedModel, requestedReasoning: result.requestedReasoning, startedAt: result.startedAt, finishedAt: result.finishedAt, status: 'completed' };
      p.events.push({ at: result.finishedAt, message: 'Plan real recibido de Codex. Revisión humana requerida; no se implementó código.' });
      await save(p);
      return p;
    });
    res.json(updated);
  } catch (error) {
    await mutate(async () => {
      const p = await load(project.id);
      p.planningRun = { ...p.planningRun, status: error.code === 'CANCELLED' ? 'cancelled' : 'failed', finishedAt: new Date().toISOString(), error: error.message };
      p.events.push({ at: new Date().toISOString(), message: (error.code === 'CANCELLED' ? 'Planificación cancelada: ' : 'Planificación fallida: ') + error.message + ' El plan anterior se conserva. Ejecución ' + runId });
      await save(p);
    });
    res.status(502).json({ error: error.message });
  } finally { activePlanning = null; plannerController = null; }
});

app.post('/api/projects/:id/planner/:runId/cancel', async (req, res) => {
  res.json(await mutate(() => {
    if (activePlanning?.projectId !== req.params.id || activePlanning.runId !== req.params.runId)
      throw Object.assign(new Error('Esta ejecución ya no está activa.'), { status: 409 });
    const p = load(req.params.id);
    if (!['starting', 'running', 'cancelling'].includes(p.planningRun?.status))
      throw Object.assign(new Error('Esta ejecución ya terminó.'), { status: 409 });
    if (p.planningRun.status !== 'cancelling') {
      p.planningRun.status = 'cancelling';
      p.events.push({ at: new Date().toISOString(), message: 'Cancelación solicitada; esperando cierre del planificador.' });
      save(p);
      plannerController.abort();
    }
    return { status: 'cancelling' };
  }));
});
function dashboard(id) {
  const p = load(id);
  return { revision: p.revision, planner: p.planningRun || null, events: p.events.slice(-100),
    workflows: store.workflows(id).filter(w => w.kind !== 'generation').map(w => ({ ...w, stale: !matchesApproval(p, w),
      resultDirectory: resultDirectory(root, w) })) };
}
app.get('/api/projects/:id/proposal', (req,res) => {
  const project=load(req.params.id);
  try {
    const contract=readContract(project.plan);
    assertTemplateMatchesBrief(project.brief,contract);
    const approved=!project.needsReplanning&&project.approval?.revision===project.revision&&project.approval?.sha256===sha(project.plan);
    res.json({ contract, approved, problem:null });
  }
  catch(error) { res.json({ contract:null, approved:false, problem:error.message }); }
});
app.delete('/api/projects/:id', async (req,res) => res.json(await mutate(()=>{
  requireIdle();
  return store.deleteProject(req.params.id,req.body?.name,req.body?.revision);
})));
app.get('/api/projects/:id/generations', (req,res) => res.json(generations.list(req.params.id).map(g=>generations.public(g))));
app.get('/api/projects/:id/generations/:generationId', (req,res) => res.json(generations.public(generations.get(req.params.id,req.params.generationId))));
app.post('/api/projects/:id/generations/prepare', async (req,res) => res.json(await mutate(()=>{
  requireIdle(); const project=load(req.params.id);requireRevision(project,req.body.revision);return generations.public(generations.prepare(project));
})));
app.post('/api/projects/:id/generations/:generationId/start', async (req,res) => res.status(202).json(await mutate(()=>{
  requireIdle();return generations.public(generations.start(load(req.params.id),req.params.generationId,req.body));
})));
app.post('/api/projects/:id/generations/:generationId/resume', async (req,res) => res.status(202).json(await mutate(()=>{
  requireIdle();return generations.public(generations.resume(load(req.params.id),req.params.generationId));
})));
app.post('/api/projects/:id/generations/:generationId/reassess', async (req,res) => res.status(202).json(await mutate(async()=>{
  requireIdle();return generations.public(await generations.reassess(load(req.params.id),req.params.generationId,req.body));
})));
app.post('/api/projects/:id/generations/:generationId/cancel', async (req,res) => res.json(await mutate(()=>generations.public(generations.cancel(req.params.id,req.params.generationId)))));
app.get('/api/projects/:id/generations/:generationId/download', async (req,res) => {
  const project=load(req.params.id);
  const archive=await generations.download(req.params.id,req.params.generationId);
  res.set({'Content-Type':'application/zip','Content-Disposition':projectContentDisposition(project.brief.name),'Cache-Control':'no-store'}).send(archive);
});
app.get('/api/projects/:id/dashboard', (req, res) => res.json(dashboard(req.params.id)));
let liveClients = 0;
app.get('/api/projects/:id/live', (req, res) => {
  dashboard(req.params.id); // Validate before opening the stream.
  if (liveClients >= 12) return res.status(429).json({ error: 'Demasiados paneles abiertos.' });
  liveClients++;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  let previous = '', closed = false, ticks = 0;
  const send = () => {
    if (res.writableNeedDrain || closed) return;
    try {
      const next = JSON.stringify(dashboard(req.params.id));
      if (next !== previous) { res.write('data: ' + next + '\n\n'); previous = next; }
      else if (++ticks % 15 === 0) res.write(': heartbeat\n\n');
    } catch { res.end(); }
  };
  const timer = setInterval(send, 1000);
  res.on('close', () => { if (!closed) { closed = true; clearInterval(timer); liveClients--; } });
  send();
});
app.post('/api/projects/:id/coordinator/prepare', async (req, res) => {
  res.json(await mutate(() => {
    requireIdle();
    const p = load(req.params.id);
    requireRevision(p, req.body?.revision);
    const existing = store.workflows(p.id).find(w =>
      ['prepared', 'awaiting_integration', 'integration_starting', 'integration_running',
        'integrated_unverified'].includes(w.status) &&
      w.workerContracts?.length === 2 && matchesApproval(p, w));
    if (existing) return existing;
    const workflow = prepareWorkflow(p);
    workflow.workerContracts = ['interface', 'logic'].map(role => {
      const contract = workerContract(p, workflow, role);
      return { role: contract.role, owns: contract.owns, planSha256: contract.planSha256, baseline: contract.baseline };
    });
    return store.saveWorkflow(workflow);
  }));
});
app.post('/api/projects/:id/coordinator/:workflowId/cancel', async (req, res) => {
  res.json(await mutate(() => {
    const workflow = store.workflows(req.params.id).find(w => w.id === req.params.workflowId);
    if (!workflow) throw Object.assign(new Error('Flujo no encontrado.'), { status: 404 });
    if (workflow.status !== 'prepared') throw Object.assign(new Error('El flujo no está preparado.'), { status: 409 });
    workflow.status = 'cancelled'; workflow.finishedAt = new Date().toISOString();
    return store.saveWorkflow(workflow);
  }));
});

function updateWorker(projectId, workflowId, role, fn) {
  const workflow = store.workflows(projectId).find(item => item.id === workflowId);
  if (!workflow) throw new Error('Flujo activo no encontrado.');
  const task = workflow.tasks.find(item => item.id === role);
  if (!task) throw new Error('Trabajador activo no encontrado.');
  fn(workflow, task);
  store.saveWorkflow(workflow);
  return workflow;
}

async function executeWorkers(projectId, workflow, contracts, controller) {
  const runOne = async contract => {
    const role = contract.role;
    const runId = workflow.tasks.find(task => task.id === role).runId;
    try {
      const result = await runWorker(root, workflow, contract, runId, {
        signal: controller.signal,
        onStarted: ({ at, pid }) => updateWorker(projectId, workflow.id, role, (current, task) => {
          task.processStartedAt = at; task.pid = pid;
          task.status = current.status === 'cancelling' ? 'cancelling' : 'running';
          if (current.status === 'starting') current.status = 'running';
        }),
        onClosed: ({ at, exitCode }) => updateWorker(projectId, workflow.id, role, (_, task) => {
          task.processClosedAt = at; task.exitCode = exitCode;
        })
      });
      await mutate(() => updateWorker(projectId, workflow.id, role, (_, task) => {
        task.status = 'completed'; task.finishedAt = result.finishedAt;
        task.artifactDirectory = result.artifactDirectory;
        task.outputDirectory = result.directory;
        task.fileHashes = result.files;
        task.summary = result.summary;
      }));
      return result;
    } catch (error) {
      try {
        await mutate(() => updateWorker(projectId, workflow.id, role, (_, task) => {
          task.status = error.code === 'CANCELLED' ? 'cancelled' : 'failed';
          task.finishedAt = new Date().toISOString(); task.error = error.message;
        }));
      } finally { controller.abort(); } // Stop peer; release slot only after its close.
      throw error;
    }
  };
  try {
    const outcomes = await Promise.allSettled(contracts.map(runOne));
    await mutate(() => {
      const current = store.workflows(projectId).find(item => item.id === workflow.id);
      if (!current) throw new Error('Flujo activo no encontrado.');
      const workers = ['interface', 'logic'].map(role => current.tasks.find(task => task.id === role));
      const start = workers.every(task => task.processStartedAt) ?
        workers.map(task => task.processStartedAt).sort().at(-1) : null;
      const end = workers.every(task => task.processClosedAt) ?
        workers.map(task => task.processClosedAt).sort()[0] : null;
      current.parallelEvidence = { observed: !!start && !!end && start < end,
        overlapStartedAt: start, overlapEndedAt: end };
      current.finishedAt = new Date().toISOString();
      current.status = workers.some(task => task.status === 'failed') ? 'failed' :
        outcomes.every(item => item.status === 'fulfilled') ? 'awaiting_integration' : 'cancelled';
      store.saveWorkflow(current);
    });
  } finally {
    if (activeImplementation?.workflowId === workflow.id) activeImplementation = null;
  }
}

app.post('/api/projects/:id/coordinator/:workflowId/start', async (req, res) => {
  if (req.body?.consent !== true || req.body?.destination !== 'managed-default')
    return res.status(400).json({ error: 'Confirma el consumo de Codex y la carpeta predeterminada mostrada.' });
  const start = await mutate(() => {
    requireIdle();
    const project = load(req.params.id);
    requireRevision(project, req.body.revision);
    const workflow = store.workflows(project.id).find(item => item.id === req.params.workflowId);
    if (!workflow || workflow.status !== 'prepared' || workflow.maxParallel !== 2 ||
        !matchesApproval(project, workflow) || workflow.workerContracts?.length !== 2)
      throw Object.assign(new Error('Prepara un flujo nuevo para el plan aprobado vigente.'), { status: 409 });
    const contracts = ['interface', 'logic'].map(role => workerContract(project, workflow, role));
    if (contracts.some(contract => !workflow.workerContracts.some(saved =>
      saved.role === contract.role && saved.planSha256 === contract.planSha256 &&
      JSON.stringify(saved.owns) === JSON.stringify(contract.owns))))
      throw Object.assign(new Error('Los contratos del flujo no coinciden con la aprobación vigente.'), { status: 409 });
    const controller = new AbortController();
    const at = new Date().toISOString();
    workflow.status = 'starting'; workflow.startedAt = at;
    workflow.tasks.find(task => task.id === 'contracts').status = 'prepared';
    for (const contract of contracts) {
      const task = workflow.tasks.find(item => item.id === contract.role);
      task.status = 'starting'; task.startedAt = at; task.runId = randomUUID();
    }
    store.saveWorkflow(workflow);
    activeImplementation = { projectId: project.id, workflowId: workflow.id, controller };
    return { projectId: project.id, workflow, contracts, controller };
  });
  res.status(202).json({ status: 'starting', workflowId: start.workflow.id,
    resultDirectory: resultDirectory(root, start.workflow) });
  void executeWorkers(start.projectId, start.workflow, start.contracts, start.controller).catch(error => {
    console.error('La implementación terminó de forma inesperada:', error.message);
  });
});

app.post('/api/projects/:id/coordinator/:workflowId/stop', async (req, res) => {
  res.json(await mutate(() => {
    if (activeImplementation?.projectId !== req.params.id ||
        activeImplementation.workflowId !== req.params.workflowId)
      throw Object.assign(new Error('Esta implementación ya no está activa.'), { status: 409 });
    const workflow = store.workflows(req.params.id).find(item => item.id === req.params.workflowId);
    if (!workflow || !['starting', 'running', 'cancelling',
      'integration_starting', 'integration_running', 'integration_cancelling'].includes(workflow.status))
      throw Object.assign(new Error('Esta implementación ya terminó.'), { status: 409 });
    const integrating = workflow.status.startsWith('integration_');
    workflow.status = integrating ? 'integration_cancelling' : 'cancelling';
    for (const task of workflow.tasks.filter(item =>
      (integrating ? item.id === 'integration' : ['interface', 'logic'].includes(item.id)) &&
      ['starting', 'running'].includes(item.status))) task.status = 'cancelling';
    store.saveWorkflow(workflow);
    activeImplementation.controller.abort();
    return { status: 'cancelling' };
  }));
});

async function executeIntegration(project, workflow, contract, controller) {
  const role = 'integration';
  const runId = workflow.tasks.find(task => task.id === role).runId;
  try {
    const result = await runWorker(root, workflow, contract, runId, {
      signal: controller.signal,
      onStarted: ({ at, pid }) => updateWorker(project.id, workflow.id, role, (current, task) => {
        task.processStartedAt = at; task.pid = pid;
        task.status = current.status === 'integration_cancelling' ? 'cancelling' : 'running';
        if (current.status === 'integration_starting') current.status = 'integration_running';
      }),
      onClosed: ({ at, exitCode }) => updateWorker(project.id, workflow.id, role, (_, task) => {
        task.processClosedAt = at; task.exitCode = exitCode;
      })
    });
    await mutate(() => updateWorker(project.id, workflow.id, role, (_, task) => {
      task.status = 'completed'; task.finishedAt = result.finishedAt;
      task.artifactDirectory = result.artifactDirectory;
      task.outputDirectory = result.directory;
      task.fileHashes = result.files;
      task.summary = result.summary;
    }));
    const current = store.workflows(project.id).find(item => item.id === workflow.id);
    const files = await readVerifiedOutputs(root, current, ['interface', 'logic', 'integration']);
    const assembly = await assembleFinal(root, project, current, files, runId, controller.signal);
    await mutate(() => {
      const latest = store.workflows(project.id).find(item => item.id === workflow.id);
      latest.status = 'integrated_unverified'; latest.finishedAt = new Date().toISOString();
      latest.finalArtifact = { directory: assembly.directory, fileHashes: assembly.fileHashes,
        revision: project.revision, approvedHash: workflow.approvedHash,
        validation: 'not_run' };
      store.saveWorkflow(latest);
    });
  } catch (error) {
    await mutate(() => {
      const latest = store.workflows(project.id).find(item => item.id === workflow.id);
      if (!latest) throw error;
      const task = latest.tasks.find(item => item.id === role);
      if (task.status !== 'completed') {
        task.status = error.code === 'CANCELLED' ? 'cancelled' : 'failed';
        task.finishedAt = new Date().toISOString(); task.error = error.message;
      }
      latest.status = error.code === 'CANCELLED' ? 'cancelled' : 'integration_failed';
      latest.integrationError = error.message; latest.finishedAt = new Date().toISOString();
      store.saveWorkflow(latest);
    });
  } finally {
    if (activeImplementation?.workflowId === workflow.id) activeImplementation = null;
  }
}

app.post('/api/projects/:id/coordinator/:workflowId/integrate', async (req, res) => {
  if (req.body?.consent !== true || req.body?.destination !== 'managed-default')
    return res.status(400).json({ error: 'Confirma el consumo de Codex y la carpeta final mostrada.' });
  const start = await mutate(async () => {
    requireIdle();
    const project = load(req.params.id);
    requireRevision(project, req.body.revision);
    const workflow = store.workflows(project.id).find(item => item.id === req.params.workflowId);
    if (!workflow || workflow.status !== 'awaiting_integration' || !matchesApproval(project, workflow))
      throw Object.assign(new Error('La integración requiere dos entregas vigentes y aprobadas.'), { status: 409 });
    const sourceFiles = await readVerifiedOutputs(root, workflow);
    const contract = workerContract(project, workflow, 'integration', sourceFiles);
    const task = workflow.tasks.find(item => item.id === 'integration');
    const at = new Date().toISOString();
    task.status = 'starting'; task.startedAt = at; task.runId = randomUUID();
    workflow.status = 'integration_starting'; workflow.integrationStartedAt = at;
    store.saveWorkflow(workflow);
    const controller = new AbortController();
    activeImplementation = { projectId: project.id, workflowId: workflow.id, controller };
    return { project, workflow, contract, controller };
  });
  res.status(202).json({ status: 'integration_starting', workflowId: start.workflow.id,
    resultDirectory: resultDirectory(root, start.workflow) });
  void executeIntegration(start.project, start.workflow, start.contract, start.controller).catch(error => {
    console.error('La integración terminó de forma inesperada:', error.message);
  });
});

app.get('/api/projects', async (req, res) => {
  res.json(store.list());
});
app.get('/api/projects/:id/history', (req, res) => res.json(store.history(req.params.id)));
app.post('/api/projects/:id/continue', async (req, res) => {
  res.json(await mutate(async () => {
    requireIdle();
    const project = continueProject(await load(req.params.id), req.body || {});
    await save(project);
    return project;
  }));
});
app.post('/api/projects', async (req, res) => {
  const project = createProject(req.body || {}); await save(project); res.status(201).json(project);
});
app.put('/api/projects/:id/plan', async (req, res) => {
  res.json(await mutate(async () => { requireIdle(); const project = editPlan(await load(req.params.id), req.body || {}); await save(project); return project; }));
});
app.post('/api/projects/:id/approve', async (req, res) => {
  res.json(await mutate(async () => { requireIdle(); const current=await load(req.params.id);
    if(current.plan.includes('```aipb-contract-v2'))assertTemplateMatchesBrief(current.brief,readContract(current.plan));
    const project = approvePlan(current, req.body || {}); await save(project); return project; }));
});
app.post('/api/projects/:id/run', (req, res) => res.status(410).json({
  error: 'Usa el flujo preparado y confirma la carpeta predeterminada antes de iniciar los trabajadores.'
}));
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
if (process.argv.includes('--production')) app.use(express.static(path.join(root, 'dist')));
else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true, fs: { strict: true, allow: [root], deny: ['**/.git/**', '**/.env', '**/.env.*', '**/*.{crt,pem}', '**/data/**', '**/generated-projects/**', '**/server/**', '**/tests/**', '**/docs/**'] } }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Error interno. Revisa la consola local.' });
});
ready = true;
console.log('AI Project Builder: ' + origin + ' · SQLite');
server.on('error', err => { console.error(err.message); process.exitCode = 1; });
