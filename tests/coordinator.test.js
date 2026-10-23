import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, editPlan, approvePlan } from '../server/domain.js';
import { prepareWorkflow, matchesApproval } from '../server/coordinator.js';

function approved() {
  const p = createProject({ name: 'Demo ficticia', description: 'Tareas' });
  editPlan(p, { revision: 1, plan: 'Plan de demostración con contratos separados.' });
  approvePlan(p, { revision: 2 });
  return p;
}
test('preparation requires approval and does not claim agent activity', () => {
  assert.throws(() => prepareWorkflow(createProject({ name: 'Demo', description: 'Tareas' })), { status: 409 });
  const w = prepareWorkflow(approved());
  assert.equal(w.status, 'prepared');
  assert.equal(w.maxParallel, 2);
  assert.ok(w.tasks.every(t => t.status === 'not_connected' && !t.startedAt));
  assert.deepEqual(w.tasks.find(t => t.id === 'integration').dependencies, ['interface', 'logic']);
});
test('edited or tampered plans invalidate the prepared workflow', () => {
  const p = approved(), w = prepareWorkflow(p);
  assert.equal(matchesApproval(p, w), true);
  p.plan += ' Alteración';
  assert.equal(matchesApproval(p, w), false);
  assert.equal(matchesApproval(p, w), false);
});
test('preparation alone does not start or claim a worker', () => {
  const p = approved(), w = prepareWorkflow(p);
  assert.equal(w.status, 'prepared');
  assert.ok(w.tasks.every(task => !task.processStartedAt));
  w.status = 'cancelled';
  assert.equal(w.tasks.find(task => task.id === 'integration').status, 'not_connected');
});
