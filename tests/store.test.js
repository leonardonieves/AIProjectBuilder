import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectStore } from '../server/store.js';
import { createProject, editPlan, approvePlan, continueProject } from '../server/domain.js';
import { prepareWorkflow } from '../server/coordinator.js';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'aipb-store-'));
  const store = new ProjectStore(root);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store };
}
const project = () => createProject({ name: 'Demo', description: 'Tareas ficticias' });
test('prepared workflows survive reopening and cancellation preserves history', t => {
  const { store, root } = fixture(t); const p = project(); store.save(p);
  editPlan(p, { revision: 1, plan: 'Plan aprobado de prueba.' });
  approvePlan(p, { revision: 2 }); store.save(p);
  const w = prepareWorkflow(p); store.saveWorkflow(w);
  const reopened = new ProjectStore(root);
  try { assert.deepEqual(reopened.workflows(p.id), [w]); } finally { reopened.close(); }
  w.status = 'cancelled'; store.saveWorkflow(w);
  store.saveWorkflow(prepareWorkflow(p));
  assert.equal(store.workflows(p.id).length, 2);
  assert.ok(store.workflows(p.id).some(item => item.status === 'cancelled'));
});
test('starting and cancelling planner runs are recovered as interrupted', t => {
  const { store } = fixture(t);
  for (const status of ['starting', 'cancelling']) {
    const p = project();
    p.planningRun = { id: p.id, revision: 1, status, startedAt: new Date().toISOString() };
    store.save(p); store.recoverInterrupted();
    assert.equal(store.load(p.id).planningRun.status, 'interrupted');
  }
});
test('running worker workflow is recovered without retrying completed work', t => {
  const { store } = fixture(t); const p = project(); store.save(p);
  editPlan(p, { revision: 1, plan: 'App ficticia con i18n y dark/light themes.' });
  approvePlan(p, { revision: 2 }); store.save(p);
  const w = prepareWorkflow(p);
  w.status = 'running';
  w.tasks.find(task => task.id === 'interface').status = 'completed';
  w.tasks.find(task => task.id === 'logic').status = 'running';
  store.saveWorkflow(w); store.recoverInterrupted();
  const recovered = store.workflows(p.id)[0];
  assert.equal(recovered.status, 'interrupted');
  assert.equal(recovered.tasks.find(task => task.id === 'interface').status, 'completed');
  assert.equal(recovered.tasks.find(task => task.id === 'logic').status, 'interrupted');
});
test('preserves plan versions and past approvals', t => {
  const { store } = fixture(t); const p = project(); store.save(p);
  editPlan(p, { revision: 1, plan: 'Plan con alcance y criterios.' }); store.save(p);
  approvePlan(p, { revision: 2 }); store.save(p);
  continueProject(p, { revision: 2, changes: 'Agregar prioridades.' }); store.save(p);
  assert.equal(store.load(p.id).approval, null);
  assert.throws(() => approvePlan(p, { revision: 3 }));
  const h = store.history(p.id);
  assert.equal(h.versions.length, 3);
  assert.ok(h.versions.find(v => v.revision === 2).approvedAt);
  assert.equal(h.versions.find(v => v.revision === 2).brief.context, 'Sin contexto adicional.');
});
test('immutable revision rejects changed plan and rolls back', t => {
  const { store } = fixture(t); const p = project(); store.save(p);
  p.plan = 'Changed without new revision';
  assert.throws(() => store.save(p));
  assert.notEqual(store.load(p.id).plan, p.plan);
});
test('legacy import preserves originals and is idempotent', t => {
  const { store, root } = fixture(t); const p = project();
  const dir = path.join(root, 'data', 'projects'); mkdirSync(dir);
  const raw = JSON.stringify(p); const file = path.join(dir, p.id + '.json'); writeFileSync(file, raw);
  assert.equal(store.importLegacy(dir), 1); assert.equal(store.importLegacy(dir), 0);
  assert.equal(readFileSync(file, 'utf8'), raw); assert.deepEqual(store.load(p.id), p);
});
test('malformed batch leaves no partial projects', t => {
  const { store, root } = fixture(t); const p = project();
  const dir = path.join(root, 'data', 'projects'); mkdirSync(dir);
  writeFileSync(path.join(dir, p.id + '.json'), JSON.stringify(p));
  writeFileSync(path.join(dir, 'ffffffff-ffff-ffff-ffff-ffffffffffff.json'), '{bad');
  assert.throws(() => store.importLegacy(dir)); assert.equal(store.list().length, 0);
});
test('interrupted runs are persisted without automatic retry', t => {
  const { store } = fixture(t); const p = project();
  p.planningRun = { id: 'run-test', revision: 1, status: 'running', startedAt: new Date().toISOString(), requestedModel: 'gpt-6-luna' };
  store.save(p); store.recoverInterrupted();
  assert.equal(store.history(p.id).runs[0].status, 'interrupted');
  assert.equal(store.load(p.id).revision, 1);
});
test('persisted data can be read by another connection', t => {
  const { store, root } = fixture(t); const p = project(); store.save(p);
  const reopened = new ProjectStore(root);
  try { assert.deepEqual(reopened.load(p.id), p); } finally { reopened.close(); }
});
test('continuation rejects stale revision and empty request', () => {
  const p = project();
  assert.throws(() => continueProject(p, { revision: 0, changes: 'Cambio' }));
  assert.throws(() => continueProject(p, { revision: 1, changes: ' ' }));
});
