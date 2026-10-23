import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createProject, editPlan, approvePlan } from '../server/domain.js';
import { prepareWorkflow } from '../server/coordinator.js';
import { workerContract, workerDirectory, workerPrompt, resultDirectory } from '../server/worker-contract.js';

function fixture() {
  const project = createProject({ name: 'Demo', description: 'Fictional tasks' });
  editPlan(project, { revision: 1, plan: 'Approved fictional app plan with i18n and dark/light themes.' });
  approvePlan(project, { revision: 2 });
  return { project, workflow: prepareWorkflow(project) };
}

test('workers receive distinct ownership and mandatory app baseline', () => {
  const { project, workflow } = fixture();
  const ui = workerContract(project, workflow, 'interface');
  const logic = workerContract(project, workflow, 'logic');
  assert.deepEqual(ui.owns.filter(file => logic.owns.includes(file)), []);
  assert.deepEqual(ui.baseline.languages, ['en', 'es']);
  assert.equal(ui.baseline.defaultLanguage, 'en');
  assert.equal(ui.baseline.darkLight, true);
  assert.match(workerPrompt(ui), /Do not install dependencies/);
  assert.match(workerPrompt(ui), /text-generation task, not a filesystem task/);
  assert.match(workerPrompt(ui), /read-only workspace by itself is not a limitation/);
  assert.match(workerPrompt(ui), /MANDATORY INTERFACE FILES: include exactly named src\/locales\/en\.json, src\/locales\/es\.json and src\/themes\.css/);
  assert.match(workerPrompt(ui), /do not replace these files with catalogs\.js/);
  assert.equal(ui.approvedPlan, project.plan);
});

test('stale approvals and non-workers fail closed', () => {
  const { project, workflow } = fixture();
  project.plan += ' changed';
  assert.throws(() => workerContract(project, workflow, 'interface'), { status: 409 });
  assert.throws(() => workerContract(project, workflow, 'integration'), { status: 409 });
});

test('worker directories are derived only from managed IDs and roles', () => {
  const { workflow } = fixture();
  const root = path.resolve('demo-root');
  const ui = workerDirectory(root, workflow, 'interface');
  const logic = workerDirectory(root, workflow, 'logic');
  assert.notEqual(ui, logic);
  assert.equal(path.dirname(ui), path.resolve(root, 'generated-projects', workflow.id));
  assert.equal(resultDirectory(root, workflow), path.resolve(root, 'generated-projects', workflow.id, 'app'));
  assert.throws(() => workerDirectory(root, { id: '../escape' }, 'interface'), { status: 409 });
  assert.throws(() => workerDirectory(root, workflow, '../escape'), { status: 409 });
});

test('integration contract is separate and accepts only verified worker inputs', () => {
  const { project, workflow } = fixture();
  workflow.status = 'awaiting_integration';
  const sources = [{ role: 'interface', path: 'src/ui/App.jsx', content: 'export default 1' },
    { role: 'logic', path: 'src/domain/tasks.js', content: 'export const tasks = []' }];
  const contract = workerContract(project, workflow, 'integration', sources);
  assert.ok(contract.owns.includes('src/main.jsx'));
  assert.match(workerPrompt(contract), /VERIFIED WORKER FILES/);
  assert.match(workerPrompt(contract), /export translate\(language, key, values\)/);
  assert.throws(() => workerContract(project, workflow, 'integration', [{ role: 'browser', path: '../x' }]), { status: 409 });
});
