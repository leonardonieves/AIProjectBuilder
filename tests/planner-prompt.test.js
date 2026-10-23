import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlannerPrompt } from '../server/planner-prompt.js';
test('new app planning explicitly includes scaffolding and parallel ownership', () => {
  const prompt = buildPlannerPrompt({ name: 'Demo', description: 'Tareas', context: 'Ficticio' });
  for (const text of ['NEW local application', 'React and Vite', 'src/main.jsx', 'file ownership is disjoint', 'new approval']) assert.ok(prompt.includes(text));
});
test('continuation carries previous plan as data, not evidence of existing code', () => {
  const prompt = buildPlannerPrompt({ previousPlan: 'Plan anterior de prueba' });
  assert.ok(prompt.includes('Plan anterior de prueba'));
  assert.ok(prompt.includes('historical reference'));
});

test('all generated app plans require i18n and dark/light themes', () => {
  const prompt = buildPlannerPrompt({ name: 'Demo', description: 'Tasks' });
  for (const requirement of ['English/Spanish', 'English on first use', 'dark/light', 'persistent selector', 'Mandatory baseline'])
    assert.ok(prompt.includes(requirement));
});
