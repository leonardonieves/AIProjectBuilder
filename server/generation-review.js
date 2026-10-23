import path from 'node:path';
import { transformWithEsbuild } from 'vite';
import { parseAst } from 'rollup/parseAst';
import { filesFor } from './generation-contract.js';

export const ownerOf = (file, contract) => {
  const owned=filesFor(contract || {template:'react-express-sqlite-v1'});
  return Object.keys(owned).find(role => owned[role].includes(file)) || 'template';
};
function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (node.type) fn(node);
  for (const [key, value] of Object.entries(node)) {
    if (['start', 'end'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, fn));
    else if (value && typeof value === 'object') walk(value, fn);
  }
}
const boundNames = node => !node ? [] : node.type === 'Identifier' ? [node.name] :
  node.type === 'ObjectPattern' ? node.properties.flatMap(p => boundNames(p.value || p.argument)) :
  node.type === 'ArrayPattern' ? node.elements.flatMap(boundNames) : [];

// Parses source; never imports, evaluates, bundles or executes generated modules.
export async function staticReview(files, contract) {
  const findings = [], modules = new Map();
  const domainFile=contract.template === 'react-browser-local-v1' ? 'src/domain.js' : 'server/domain.js';
  const owner = file => ownerOf(file, contract);
  const issue = (file, code, message='') => findings.push({ role: owner(file), file, code, message, blocking: true });
  for (const required of Object.values(filesFor(contract)).flat()) if (!Object.hasOwn(files, required)) issue(required, 'missing_file');
  for (const [file, content] of Object.entries(files)) {
    if (file.endsWith('.json')) { try { JSON.parse(content); } catch { issue(file, 'invalid_json'); } continue; }
    if (file.endsWith('.css')) {
      try { await transformWithEsbuild(content, file, { loader: 'css' }); } catch { issue(file, 'invalid_css'); }
      // The shared theme stylesheet is template-owned and already imported by
      // the entry point. A redundant local CSS import is safe; remote imports
      // and asset URLs remain prohibited in worker-owned styles.
      const withoutSharedThemeImport = content.replace(/@import\s+(?:'\.\/themes\.css'|"\.\/themes\.css")\s*;/gi, '');
      if (owner(file) !== 'template' && /@import|url\s*\(/i.test(withoutSharedThemeImport)) issue(file, 'external_style');
      if (owner(file) !== 'template' && /(?:color|background)\s*:[^;}]*#[0-9a-f]/i.test(content)) issue(file, 'theme_colors');
      continue;
    }
    if (!/\.(js|jsx)$/.test(file)) continue;
    let ast;
    try { ast = parseAst((await transformWithEsbuild(content, file, { loader: file.endsWith('.jsx') ? 'jsx' : 'js', jsx: 'transform' })).code); }
    catch (error) { issue(file, 'syntax', String(error.message).slice(0,1000)); continue; }
    const mod = { imports: [], exports: new Set() }; modules.set(file, mod);
    for (const node of ast.body) {
      if (node.type === 'ImportDeclaration') mod.imports.push(node);
      if (node.type === 'ExportDefaultDeclaration') mod.exports.add('default');
      if (node.type === 'ExportNamedDeclaration') {
        if (file === domainFile && node.declaration?.async) issue(file, 'domain_must_be_synchronous');
        if (node.source) issue(file, 'reexport_not_supported');
        for (const spec of node.specifiers || []) mod.exports.add(spec.exported.name || spec.exported.value);
        if (node.declaration?.id) mod.exports.add(node.declaration.id.name);
        for (const decl of node.declaration?.declarations || []) boundNames(decl.id).forEach(n => mod.exports.add(n));
      }
      if (node.type === 'ExportAllDeclaration') issue(file, 'reexport_not_supported');
    }
    if (owner(file) !== 'template') walk(ast, node => {
      if (file === domainFile && node.type === 'Identifier' &&
        ['window', 'document', 'localStorage', 'sessionStorage', 'navigator'].includes(node.name)) issue(file, 'domain_must_be_pure');
      if (node.type === 'ImportExpression' || node.type === 'WithStatement') issue(file, 'dynamic_code');
      if (node.type === 'Identifier' && ['eval', 'Function', 'require', 'process', 'globalThis', 'WebSocket', 'XMLHttpRequest', 'fetch'].includes(node.name)) issue(file, 'restricted_capability');
      if (node.type === 'Identifier' && ['dangerouslySetInnerHTML', 'innerHTML', 'outerHTML'].includes(node.name)) issue(file, 'unsafe_html');
      if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && node.callee.object?.name === 'api') {
        if (!['list', 'create', 'update', 'remove'].includes(node.callee.property?.name)) issue(file, 'api_method');
        const arg = node.arguments[0];
        if (arg?.type === 'Literal' && !contract.entities.some(e => e.name === arg.value)) issue(file, 'api_entity');
      }
      if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && node.callee.property?.name === 'createElement') {
        // Unicode letters only: the old À-ÿ range also contains × and ÷,
        // so harmless icon glyphs incorrectly exhausted correction cycles.
        if (node.arguments.slice(2).some(n => n.type === 'Literal' && typeof n.value === 'string' && /\p{L}/u.test(n.value))) issue(file, 'untranslated_text');
        const attrs = node.arguments[1];
        for (const prop of attrs?.properties || []) if (['placeholder', 'aria-label', 'title', 'alt'].includes(prop.key?.name || prop.key?.value) && prop.value?.type === 'Literal' && typeof prop.value.value === 'string' && prop.value.value.trim()) issue(file, 'untranslated_attribute');
      }
    });
  }
  const allowedPackages = new Set(['react', 'react-dom/client']);
  if (modules.get(domainFile)?.imports.length) issue(domainFile, 'domain_must_be_pure');
  for (const [file, mod] of modules) for (const entry of mod.imports) {
    const source = entry.source.value;
    if (!source.startsWith('.')) {
      if (owner(file) !== 'template' && (!allowedPackages.has(source) || file.startsWith('server/'))) issue(file, 'unapproved_dependency');
      continue;
    }
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), source));
    if (!Object.hasOwn(files, target)) { issue(file, 'missing_import', source); continue; }
    if (file.startsWith('src/') && target.startsWith('server/')) issue(file, 'server_import_in_browser');
    if (modules.has(target)) for (const spec of entry.specifiers) {
      const imported = spec.type === 'ImportDefaultSpecifier' ? 'default' : spec.type === 'ImportSpecifier' ? spec.imported.name || spec.imported.value : null;
      if (imported && !modules.get(target).exports.has(imported)) issue(file, 'missing_export', imported+' from '+target);
    }
  }
  for (const [file, required] of Object.entries(contract.exports))
    for (const name of required) if (!modules.get(file)?.exports.has(name)) issue(file, 'required_export', name);
  for (const required of ['src/App.jsx', 'src/AppShell.jsx', 'src/i18n.jsx', 'src/themes.css', 'src/styles.css']) {
    const entryImports = modules.get('src/main.jsx')?.imports.map(n => path.posix.normalize(path.posix.join('src', n.source.value))) || [];
    if (!entryImports.includes(required)) issue('src/main.jsx', 'entry_connection');
  }
  let en, es;
  try {
    en = JSON.parse(files['src/locales/en.json']); es = JSON.parse(files['src/locales/es.json']);
    for (const catalog of [en, es]) if (!catalog || Array.isArray(catalog) || typeof catalog !== 'object' || Object.values(catalog).some(v => typeof v !== 'string' || !v.trim())) throw new Error();
    if (JSON.stringify(Object.keys(en).sort()) !== JSON.stringify(Object.keys(es).sort())) issue('src/locales/en.json', 'catalog_parity', Object.keys({...en,...es}).filter(k=>!Object.hasOwn(en,k)||!Object.hasOwn(es,k)).join(', '));
  } catch { issue('src/locales/en.json', 'catalog_format'); }
  if (en && es) for (const [file, text] of Object.entries(files)) if (/\.(js|jsx)$/.test(file))
    for (const match of text.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g))
      if (!Object.hasOwn(en, match[1]) || !Object.hasOwn(es, match[1])) issue(file, 'missing_translation', match[1]);
  const schemaFile=contract.template === 'react-browser-local-v1' ? 'schema.json' : 'server/schema.json';
  try { if (JSON.stringify(JSON.parse(files[schemaFile])) !== JSON.stringify(contract.entities)) issue(schemaFile, 'schema_mismatch'); }
  catch { issue(schemaFile, 'schema_mismatch'); }
  return { mode: 'static-only', runtimeExecuted: false, findings: [...new Map(findings.map(f => [f.file+':'+f.code, f])).values()] };
}
