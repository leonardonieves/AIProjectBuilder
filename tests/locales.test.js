import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialPlan } from '../server/domain.js';

test('English and Spanish catalogs contain the same nonempty messages', () => {
  const read = language => JSON.parse(readFileSync(new URL('../src/locales/' + language + '.json', import.meta.url), 'utf8'));
  const en = read('en'), es = read('es');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  for (const catalog of [en, es]) assert.ok(Object.values(catalog).every(text => typeof text === 'string' && text.trim()));
  assert.equal(en['Idioma'], 'Language');
  assert.equal(es['Idioma'], 'Idioma');
});
test('English and Spanish generator catalogs contain the same nonempty messages', () => {
  const read = language => JSON.parse(readFileSync(new URL('../src/locales/generator-' + language + '.json', import.meta.url), 'utf8'));
  const en = read('en'), es = read('es');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  for (const catalog of [en, es]) assert.ok(Object.values(catalog).every(text => typeof text === 'string' && text.trim()));
});
test('new manual plans include the mandatory UI baseline', () => {
  const plan = initialPlan({ description: 'Demo', context: 'Fictional' });
  assert.ok(plan.includes('i18n'));
  assert.ok(plan.includes('dark/light'));
});
