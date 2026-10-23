import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkerResult } from '../server/worker-runner.js';

const contract = { role: 'interface', owns: ['src/ui/', 'src/locales/', 'src/themes.css'] };
const valid = () => ({ summary: 'Source generated; not tested.', files: [
  { path: 'src/ui/App.jsx', content: 'export default function App() {}' },
  { path: 'src/locales/en.json', content: '{}' },
  { path: 'src/locales/es.json', content: '{}' },
  { path: 'src/themes.css', content: '[data-theme="dark"] {} [data-theme="light"] {}' }
] });

test('validated delivery hashes role-owned files', () => {
  const result = validateWorkerResult(contract, valid());
  assert.equal(result.files.length, 4);
  assert.match(result.files[0].sha256, /^[0-9a-f]{64}$/);
});

test('delivery rejects traversal, cross-role files and case-insensitive collisions', () => {
  for (const name of ['../other.js', 'src/ui/../../other.js', 'src/domain/logic.js',
    'src/ui/CON', 'src/ui/.env', 'src/ui/a\\b.js']) {
    const result = valid(); result.files[0].path = name;
    assert.throws(() => validateWorkerResult(contract, result), { status: 409 });
  }
  const duplicate = valid(); duplicate.files.push({ path: 'src/ui/app.jsx', content: 'x' });
  assert.throws(() => validateWorkerResult(contract, duplicate), { status: 409 });
});

test('interface cannot omit the language and theme baseline files', () => {
  const result = valid(); result.files.pop();
  assert.throws(() => validateWorkerResult(contract, result), { status: 409 });
});

test('empty model delivery explains why no result folder exists', () => {
  assert.throws(() => validateWorkerResult(contract, { summary: 'No tools', files: [] }),
    /Codex no entregó archivos/);
});
