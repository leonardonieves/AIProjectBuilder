import { createHash } from 'node:crypto';
import { assertTemplateMatchesBrief } from './brief-capabilities.js';

export const sha = value => createHash('sha256').update(value).digest('hex');
export const generationError = (code, status = 409) => Object.assign(new Error(code), { status });
export const roleFiles = Object.freeze({
  frontend: ['src/App.jsx', 'src/styles.css', 'src/locales/en.json', 'src/locales/es.json'],
  backend: ['server/domain.js'], integration: ['src/main.jsx']
});
export const browserRoleFiles = Object.freeze({
  frontend: roleFiles.frontend, backend: ['src/domain.js'], integration: roleFiles.integration
});
export const filesFor = contract => contract.template === 'react-browser-local-v1' ? browserRoleFiles : roleFiles;
export const technicalSchema = {
  type: 'object', additionalProperties: false, required: ['template', 'supported', 'limitations', 'entities'],
  properties: {
    template: { type: 'string', enum: ['react-express-sqlite-v1', 'react-browser-local-v1'] },
    supported: { type: 'boolean' }, limitations: { type: 'array', items: { type: 'string' } },
    entities: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['name', 'labelEn', 'labelEs', 'fields'], properties: {
        name: { type: 'string' }, labelEn: { type: 'string' }, labelEs: { type: 'string' },
        fields: { type: 'array', items: { type: 'object', additionalProperties: false,
          required: ['name', 'type', 'required', 'reference', 'labelEn', 'labelEs'], properties: {
            name: { type: 'string' }, type: { type: 'string', enum: ['text', 'number', 'boolean', 'date', 'reference'] },
            required: { type: 'boolean' }, reference: { type: 'string' },
            labelEn: { type: 'string' }, labelEs: { type: 'string' }
          } } }
      } } }
  }
};
const identifier = /^[a-z][a-z0-9_]{0,39}$/;
const forbidden = new Set(['id', 'sqlite_sequence', 'constructor', 'prototype', '__proto__']);
function label(value) { return typeof value === 'string' && value.trim().length > 0 && value.length < 160; }
export function technicalContract(input) {
  const bad = () => { throw generationError('gen.contractInvalid'); };
  const template = input?.template ?? 'react-express-sqlite-v1';
  if (!['react-express-sqlite-v1', 'react-browser-local-v1'].includes(template)) bad();
  if (!input || typeof input.supported !== 'boolean' || !Array.isArray(input.limitations) ||
      input.limitations.length > 12 || input.limitations.some(x => typeof x !== 'string' || x.length > 1000) ||
      !Array.isArray(input.entities) || input.entities.length > 8 || (input.supported && !input.entities.length)) bad();
  const names = new Set();
  const entities = input.entities.map(entity => {
    if (!entity || !identifier.test(entity.name) || entity.name.startsWith('sqlite_') || forbidden.has(entity.name) || names.has(entity.name) ||
        !label(entity.labelEn) || !label(entity.labelEs) || !Array.isArray(entity.fields) ||
        !entity.fields.length || entity.fields.length > 12) bad();
    names.add(entity.name);
    const fields = new Set();
    return { name: entity.name, labelEn: entity.labelEn, labelEs: entity.labelEs,
      fields: entity.fields.map(field => {
        if (!field || !identifier.test(field.name) || forbidden.has(field.name) || fields.has(field.name) ||
            !['text', 'number', 'boolean', 'date', 'reference'].includes(field.type) || typeof field.required !== 'boolean' ||
            typeof field.reference !== 'string' || !label(field.labelEn) || !label(field.labelEs)) bad();
        fields.add(field.name);
        return { name: field.name, type: field.type, required: field.required, reference: field.reference,
          labelEn: field.labelEn, labelEs: field.labelEs };
      }) };
  });
  for (const entity of entities) for (const field of entity.fields)
    if (field.type === 'reference' ? !names.has(field.reference) : field.reference !== '') bad();
  const browser = template === 'react-browser-local-v1';
  const files = browser ? browserRoleFiles : roleFiles;
  const domainFile = browser ? 'src/domain.js' : 'server/domain.js';
  return {
    version: browser ? 3 : 2, template, supported: input.supported, limitations: input.limitations,
    entities, routes: browser ? [] : entities.flatMap(e => ['GET', 'POST', 'PATCH', 'DELETE'].map(method => ({ method,
      path: '/api/' + e.name + (['PATCH', 'DELETE'].includes(method) ? '/:id' : ''),
      request: ['POST', 'PATCH'].includes(method) ? e.fields.map(f => f.name) : [],
      response: method === 'GET' ? '{ data: Record[] }' : method === 'DELETE' ? '{ data: null }' : '{ data: Record }' }))),
    files,
    exports: { 'src/App.jsx': ['default'], [domainFile]: ['validateRecord'], 'src/api.js': ['api', 'entities'],
      'src/i18n.jsx': ['I18nProvider', 'useI18n'], 'src/AppShell.jsx': ['default'] },
    interfaces: { validateRecord: '(entityName, completeValues) => string[]; return translation keys for domain errors; no database or IO',
      api: 'api.list(entity), api.create(entity, values), api.update(entity, id, completeValues), api.remove(entity, id); resolves data or throws Error(error code)' + (browser ? '; stores records in browser localStorage, no HTTP' : ''),
      i18n: 'useI18n() => { t(key, values), language, locale, theme, setLanguage, setTheme }; flat string catalogs',
      app: 'default React component with no required props; render inside I18nProvider and AppShell; import api and entities from ./api.js' },
    baseline: { languages: ['en', 'es'], defaultLanguage: 'en', themes: ['dark', 'light'], keyboard: true },
    exclusions: ['authentication', 'payments', 'external-services', 'deploy', 'runtime-validation']
  };
}
export function contractBlock(technical) {
  const contract = technicalContract(technical);
  return '\n\n## ' + (contract.version === 3 ? 'Browser contract v3' : 'Fullstack contract v2') +
    '\n```aipb-contract-v2\n' + JSON.stringify(contract, null, 2) + '\n```';
}
export function readContract(plan) {
  const blocks = [...plan.matchAll(/```aipb-contract-v2\n([\s\S]*?)\n```/g)];
  if (blocks.length !== 1) throw generationError('gen.contractRequired');
  let original;
  try { original = JSON.parse(blocks[0][1]); } catch { throw generationError('gen.contractInvalid'); }
  const normalized = technicalContract(original);
  if (JSON.stringify(original) !== JSON.stringify(normalized)) throw generationError('gen.contractInvalid');
  if (!normalized.supported) throw generationError('gen.unsupported');
  return normalized;
}
export function approvedContract(project) {
  const contract = readContract(project.plan);
  assertTemplateMatchesBrief(project.brief, contract);
  if (project.needsReplanning || project.approval?.revision !== project.revision || project.approval.sha256 !== sha(project.plan))
    throw generationError('gen.approvalRequired');
  return contract;
}
