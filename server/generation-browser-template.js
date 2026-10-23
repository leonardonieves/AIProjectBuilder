// Browser-only scaffold. Generated applications have no API server or database.
export function browserTemplateFiles(contract, common, namespace) {
  const files = { ...common };
  delete files['server/db.js'];
  delete files['server/index.js'];
  delete files['server/schema.json'];
  delete files['.env.example'];
  const json = value => JSON.stringify(value, null, 2) + '\n';
  files['package.json'] = json({
    name: 'generated-browser-crud', version: '1.0.0', private: true, type: 'module',
    scripts: { dev: 'vite --host 127.0.0.1', build: 'vite build', preview: 'vite preview --host 127.0.0.1' },
    engines: { node: '^22.13.0 || >=23.4.0' },
    dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
    devDependencies: { vite: '^6.1.0' }
  });
  files['schema.json'] = json(contract.entities);
  files['src/api.js'] = `import { validateRecord } from './domain.js';
export const entities = ${json(contract.entities)};
const prefix = 'aipb.browser-crud.v1.' + ${JSON.stringify(namespace)} + '.';
const fail = code => { throw new Error(code); };
const entityFor = name => entities.find(entity => entity.name === name) || fail('errors.invalid');
const keyFor = name => prefix + name;
function read(name) {
  entityFor(name);
  let raw;
  try { raw = localStorage.getItem(keyFor(name)); } catch { fail('errors.storageUnavailable'); }
  if (raw === null) return [];
  try {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 10000 || rows.some(row => !row || typeof row !== 'object' ||
      !Number.isSafeInteger(row.id) || row.id < 1) ||
      new Set(rows.map(row => row.id)).size !== rows.length) fail('errors.storageInvalid');
    return rows;
  } catch { fail('errors.storageInvalid'); }
}
function write(name, rows) {
  try { localStorage.setItem(keyFor(name), JSON.stringify(rows)); }
  catch { fail('errors.storageUnavailable'); }
}
function validDate(value) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0); date.setFullYear(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
function completeValues(entity, body) {
  if (!body || Array.isArray(body) || typeof body !== 'object' ||
    Object.keys(body).some(key => !entity.fields.some(field => field.name === key))) fail('errors.invalid');
  const values = {};
  for (const field of entity.fields) {
    const value = body[field.name] ?? null;
    if (field.required && (value === null || value === '')) fail('errors.required');
    if (value !== null && ((field.type === 'text' && (typeof value !== 'string' || value.length > 10000)) ||
      (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) ||
      (field.type === 'boolean' && typeof value !== 'boolean') ||
      (field.type === 'reference' && (!Number.isSafeInteger(value) || value < 1 ||
        !read(field.reference).some(row => row.id === value))) ||
      (field.type === 'date' && (typeof value !== 'string' || !validDate(value))))) fail('errors.invalid');
    values[field.name] = value;
  }
  const errors = validateRecord(entity.name, values);
  if (!Array.isArray(errors) || errors.some(error => typeof error !== 'string')) fail('errors.invalid');
  if (errors.length) fail(errors[0]);
  return values;
}
const clone = value => JSON.parse(JSON.stringify(value));
export const api = {
  async list(name) { return clone(read(name).sort((a, b) => a.id - b.id)); },
  async create(name, body) {
    const entity = entityFor(name), values = completeValues(entity, body), rows = read(name);
    const id = Math.max(0, ...rows.map(row => row.id)) + 1;
    if (!Number.isSafeInteger(id)) fail('errors.invalid');
    const record = { id, ...values }; write(name, [...rows, record]); return clone(record);
  },
  async update(name, id, body) {
    const entity = entityFor(name), number = Number(id), rows = read(name);
    if (!Number.isSafeInteger(number) || number < 1) fail('errors.invalid');
    const index = rows.findIndex(row => row.id === number);
    if (index < 0) fail('errors.notFound');
    const record = { id: number, ...completeValues(entity, body) };
    rows[index] = record; write(name, rows); return clone(record);
  },
  async remove(name, id) {
    const number = Number(id), rows = read(name);
    if (!Number.isSafeInteger(number) || number < 1) fail('errors.invalid');
    if (!rows.some(row => row.id === number)) fail('errors.notFound');
    for (const entity of entities) for (const field of entity.fields)
      if (field.type === 'reference' && field.reference === name &&
        read(entity.name).some(row => row[field.name] === number)) fail('errors.inUse');
    write(name, rows.filter(row => row.id !== number)); return null;
  }
};
`;
  files['README.md'] = `# Local browser application

React + Vite. No application server, database, accounts, payments, or external services.

## Status
Statically reviewed source only. Dependencies were not installed; the application was not built, run, or tested during generation. REVIEW.json records review findings and process evidence, not runtime results.

## Manual evaluation
1. Inspect package.json and source.
2. With your separate authorization, run npm install and npm run dev.
3. Open the local URL printed by Vite. Create, edit, filter, delete, reload, and check language/theme preferences in both modes.
4. Optionally run npm run build after reviewing the source. The dist/ folder is static and can be served locally. No production deployment is included.

Records use this browser's localStorage under a generation-specific key. Data does not synchronize or back itself up; clearing browser data or changing origin/profile may remove access. A storage error is reported through an error code instead of silently claiming persistence. The user interface must include English/Spanish catalogs and light/dark themes; user content must not be translated.
`;
  return files;
}
