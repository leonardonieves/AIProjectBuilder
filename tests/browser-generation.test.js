import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createProject, editPlan, approvePlan } from '../server/domain.js';
import { assertTemplateMatchesBrief, requiresBrowserOnly } from '../server/brief-capabilities.js';
import { contractBlock, readContract, technicalContract } from '../server/generation-contract.js';
import { templateFiles, baseCatalog } from '../server/generation-template.js';
import { staticReview } from '../server/generation-review.js';
import { GenerationEngine, generationPrompt, validateDelivery } from '../server/generation-engine.js';
import { specification, deliveries, MemoryStore } from './helpers/generation-fixture.js';

function browserProject() {
  const project = createProject({ name: 'Browser tasks', description: 'Store tasks in the browser without an application server.' });
  const technical = { ...specification(), template: 'react-browser-local-v1' };
  editPlan(project, { revision: 1, plan: '# Browser tasks\n\n' + contractBlock(technical) });
  approvePlan(project, { revision: project.revision });
  return project;
}
function browserDeliveries() {
  const result = structuredClone(deliveries());
  result.backend.files[0].path = 'src/domain.js';
  return result;
}

test('explicit browser-only brief rejects an incompatible approved server template', () => {
  const brief = { description: 'Los datos se guardan en el navegador. No requiere servidor propio.' };
  assert.equal(requiresBrowserOnly(brief), true);
  assert.throws(() => assertTemplateMatchesBrief(brief, technicalContract(specification())), /gen.templateMismatch/);
  assert.doesNotThrow(() => assertTemplateMatchesBrief(brief, technicalContract({ ...specification(), template: 'react-browser-local-v1' })));
});

test('browser template has local storage adapter and no application server', async () => {
  const project = browserProject(), contract = readContract(project.plan), files = templateFiles(contract);
  assert.equal(contract.version, 3);
  assert.deepEqual(contract.routes, []);
  assert.deepEqual(contract.files.backend, ['src/domain.js']);
  assert.equal(files['server/index.js'], undefined);
  assert.equal(files['server/db.js'], undefined);
  assert.match(files['src/api.js'], /localStorage/);
  assert.doesNotMatch(files['src/api.js'], /\bfetch\s*\(/);
  assert.match(files['README.md'], /npm run dev/);
  const sources = browserDeliveries();
  for (const response of Object.values(sources)) for (const file of response.files || []) files[file.path] = file.content;
  for (const language of ['en', 'es']) {
    const name = `src/locales/${language}.json`;
    files[name] = JSON.stringify({ ...JSON.parse(files[name]), ...baseCatalog(contract, language) });
  }
  const report = await staticReview(files, contract);
  assert.deepEqual(report.findings, []);
  const impure = await staticReview({ ...files, 'src/domain.js': 'export function validateRecord() { return localStorage ? [] : []; }' }, contract);
  assert.ok(impure.findings.some(finding => finding.code === 'domain_must_be_pure'));
  assert.equal(Object.keys(validateDelivery('backend', sources.backend, contract))[0], 'src/domain.js');
  assert.match(generationPrompt('reviewer', project, contract, files, []), /browser-storage safety/);
});

test('browser generation packages a reviewable source ZIP without server files', async context => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aipb-browser-generation-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const project = browserProject(), store = new MemoryStore(project), source = browserDeliveries();
  const runner = async (_root, _generation, { role }, _id, options) => {
    options.onStarted({ at: '2026-10-20T12:00:00.000Z', pid: 1 });
    options.onClosed({ at: '2026-10-20T12:00:01.000Z', exitCode: 0 });
    return structuredClone(source[role]);
  };
  const engine = new GenerationEngine(root, store, { runner });
  const generation = engine.prepare(project);
  engine.start(project, generation.id, { revision: project.revision, consent: true, destination: 'managed-default', maxCorrections: 2, validation: 'static-only' });
  await engine.active.done;
  const result = engine.get(project.id, generation.id);
  assert.equal(result.status, 'completed', JSON.stringify({ error: result.error, report: result.report, feedback: result.feedback }));
  assert.equal(result.report.runtimeExecuted, false);
  const names = result.finalArtifact.files.map(file => file.path);
  assert.ok(names.includes('src/domain.js'));
  assert.ok(names.includes('src/api.js'));
  assert.ok(names.includes('REVIEW.json'));
  assert.ok(!names.some(name => name.startsWith('server/')));
  assert.equal((await engine.download(project.id, generation.id)).readUInt32LE(0), 0x04034b50);
});

test('browser data adapter persists records under a generation-specific key without HTTP', async context => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aipb-browser-adapter-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const contract = technicalContract({ ...specification(), template: 'react-browser-local-v1' });
  const files = templateFiles(contract, { namespace: 'fixture-one' });
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(root, 'domain.js'), "export function validateRecord(_name, values) { return values.title.trim() ? [] : ['errors.invalid']; }");
  await writeFile(path.join(root, 'api.js'), files['src/api.js']);
  const saved = new Map(), previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => saved.has(key) ? saved.get(key) : null,
    setItem: (key, value) => saved.set(key, value)
  };
  context.after(() => { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; });
  const { api } = await import(pathToFileURL(path.join(root, 'api.js')).href);
  const values = { title: '  Keep spacing  ', due: null, completed: false };
  const created = await api.create('tasks', values);
  assert.equal(created.title, values.title);
  assert.equal((await api.list('tasks')).length, 1);
  assert.equal((await api.update('tasks', created.id, { ...values, completed: true })).completed, true);
  assert.ok([...saved.keys()].every(key => key.includes('fixture-one')));
  await api.remove('tasks', created.id);
  assert.deepEqual(await api.list('tasks'), []);
  await assert.rejects(() => api.create('tasks', { ...values, title: ' ' }), /errors\.required|errors\.invalid/);
});
