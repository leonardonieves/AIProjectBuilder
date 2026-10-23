import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readVerifiedOutputs, assembleFinal } from '../server/integration.js';
import { workerDirectory, resultDirectory } from '../server/worker-contract.js';

const hash = text => createHash('sha256').update(text).digest('hex');
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'aipb-integration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workflow = { id: randomUUID(), status: 'integration_running', tasks: [] };
  const project = { brief: { name: '<Fictional & App>' }, revision: 3 };
  const sources = {
    interface: [
      ['src/ui/App.jsx', 'export default function App() { return null; }'],
      ['src/locales/en.json', '{}'], ['src/locales/es.json', '{}'],
      ['src/themes.css', '[data-theme="dark"] {} [data-theme="light"] {}']
    ],
    logic: [['src/domain/tasks.js', 'export const tasks = [];']],
    integration: [
      ['src/main.jsx', 'import AppShell from "./AppShell.jsx"; import "./themes.css"; import "./system.css";'],
      ['src/i18n.jsx', 'import en from "./locales/en.json"; import es from "./locales/es.json";'],
      ['src/AppShell.jsx', 'export default function AppShell() {}'],
      ['src/system.css', ':focus-visible { outline: 2px solid; }']
    ]
  };
  for (const [role, files] of Object.entries(sources)) {
    const directory = workerDirectory(root, workflow, role);
    for (const [name, content] of files) {
      const target = path.join(directory, ...name.split('/'));
      mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, content);
    }
    workflow.tasks.push({ id: role, status: 'completed', exitCode: 0,
      processStartedAt: '2026-10-19T10:00:00.000Z', processClosedAt: '2026-10-19T10:01:00.000Z',
      fileHashes: files.map(([name, content]) => ({ path: name, sha256: hash(content) })) });
  }
  return { root, project, workflow };
}

test('integration verifies recorded hashes and creates managed unvalidated source', async t => {
  const { root, project, workflow } = fixture(t);
  const files = await readVerifiedOutputs(root, workflow, ['interface', 'logic', 'integration']);
  const result = await assembleFinal(root, project, workflow, files, randomUUID());
  assert.equal(result.directory, resultDirectory(root, workflow));
  assert.match(readFileSync(path.join(result.directory, 'index.html'), 'utf8'), /&lt;Fictional &amp; App&gt;/);
  assert.equal(JSON.parse(readFileSync(path.join(result.directory, 'src/locales/en.json'), 'utf8'))['appShell.language'], 'Language');
  await assert.rejects(assembleFinal(root, project, workflow, files, randomUUID()), { status: 409 });
});

test('changed worker source cannot be integrated', async t => {
  const { root, workflow } = fixture(t);
  writeFileSync(path.join(workerDirectory(root, workflow, 'logic'), 'src/domain/tasks.js'), 'changed');
  await assert.rejects(readVerifiedOutputs(root, workflow), { status: 409 });
});
