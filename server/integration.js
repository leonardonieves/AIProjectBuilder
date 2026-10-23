import { createHash } from 'node:crypto';
import { mkdir, lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { publishArtifact } from './artifact-publication.js';
import path from 'node:path';
import { resultDirectory, workerDirectory, workerOwnership } from './worker-contract.js';
import { validateWorkerResult } from './worker-runner.js';

const sha256 = content => createHash('sha256').update(content).digest('hex');
const fail = message => Object.assign(new Error(message), { status: 409 });

async function plainDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw fail('Carpeta de entregas inválida.');
}

async function listFiles(base, current = base) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const target = path.join(current, entry.name);
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
      throw fail('La entrega contiene un enlace o archivo no permitido.');
    if (entry.isDirectory()) files.push(...await listFiles(base, target));
    else files.push(path.relative(base, target).split(path.sep).join('/'));
  }
  return files;
}

export async function readVerifiedOutputs(root, workflow, roles = ['interface', 'logic']) {
  const outputs = [];
  for (const role of roles) {
    const task = workflow.tasks.find(item => item.id === role);
    if (!task || task.status !== 'completed' || task.exitCode !== 0 ||
        !task.processStartedAt || !task.processClosedAt || !Array.isArray(task.fileHashes))
      throw fail('Faltan entregas y evidencias reales para integrar.');
    const directory = workerDirectory(root, workflow, role);
    await plainDirectory(directory);
    const actualPaths = (await listFiles(directory)).sort();
    const expectedPaths = task.fileHashes.map(file => file.path).sort();
    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths))
      throw fail('La entrega cambió desde que se registró; no se integra.');
    const files = [];
    for (const name of actualPaths) {
      const content = await readFile(path.join(directory, ...name.split('/')), 'utf8');
      const recorded = task.fileHashes.find(file => file.path === name);
      if (!recorded || recorded.sha256 !== sha256(content))
        throw fail('La huella de una entrega no coincide; no se integra.');
      files.push({ path: name, content });
    }
    validateWorkerResult({ role, owns: workerOwnership(role) }, { summary: '', files });
    outputs.push(...files.map(file => ({ role, ...file, sha256: sha256(file.content) })));
  }
  const en = outputs.find(file => file.path === 'src/locales/en.json');
  const es = outputs.find(file => file.path === 'src/locales/es.json');
  if (en && es) {
    for (const catalog of [en, es]) {
      let parsed;
      try { parsed = JSON.parse(catalog.content); } catch { throw fail('Catálogo de idioma inválido.'); }
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' ||
          Object.values(parsed).some(value => typeof value !== 'string'))
        throw fail('Catálogo de idioma inválido.');
    }
  }
  return outputs;
}

function fixedFiles(project, workflow) {
  const title = project.brief.name.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const manifest = {
    name: 'generated-app-' + workflow.id.slice(0, 8), version: '0.1.0', private: true,
    type: 'module', scripts: { dev: 'vite', build: 'vite build' },
    dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
    devDependencies: { vite: '^6.1.0' }
  };
  return [
    { path: 'package.json', content: JSON.stringify(manifest, null, 2) + '\n' },
    { path: 'index.html', content: '<!doctype html>\n<html lang="en">\n<head><meta charset="UTF-8" />' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' +
      '<title>' + title + '</title></head>\n<body><div id="root"></div>' +
      '<script type="module" src="/src/main.jsx"></script></body>\n</html>\n' },
    { path: 'README.md', content: '# Generated application / Aplicación generada\n\n' +
      'Source was assembled from separately recorded interface, logic and integration outputs. ' +
      'No build, test, installation or browser validation is implied.\n\n' +
      'El código se ensambló a partir de entregas registradas de interfaz, lógica e integración. ' +
      'No implica compilación, pruebas, instalación ni validación en navegador.\n\n' +
      'English/Spanish i18n and dark/light support require independent review and validation.\n' +
      'La internacionalización inglés/español y los temas oscuro/claro requieren revisión y validación independientes.\n' }
  ];
}

export async function assembleFinal(root, project, workflow, sourceFiles, runId, signal) {
  if (!['integration_running', 'integration_cancelling'].includes(workflow.status))
    throw fail('La integración no está activa.');
  if (signal?.aborted) throw Object.assign(new Error('Integración cancelada.'), { code: 'CANCELLED' });
  const destination = resultDirectory(root, workflow);
  const parent = path.dirname(destination);
  await plainDirectory(path.resolve(root, 'generated-projects'));
  await plainDirectory(parent);
  try { await lstat(destination); throw fail('La carpeta final ya existe; no se sobrescribe.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stage = path.join(parent, 'app-staging-' + runId);
  await mkdir(stage); // Never overwrite a previous partial integration.
  const files = new Map();
  for (const file of sourceFiles) {
    if (files.has(file.path)) throw fail('Hay archivos compartidos en conflicto.');
    files.set(file.path, file.content);
  }
  for (const file of fixedFiles(project, workflow)) {
    if (files.has(file.path)) throw fail('El integrador intentó reemplazar un archivo administrado.');
    files.set(file.path, file.content);
  }
  for (const [name, original] of [['src/locales/en.json', 'en'], ['src/locales/es.json', 'es']]) {
    const catalog = JSON.parse(files.get(name));
    Object.assign(catalog, original === 'en' ? {
      'appShell.language': 'Language', 'appShell.theme': 'Theme',
      'appShell.dark': 'Dark', 'appShell.light': 'Light'
    } : {
      'appShell.language': 'Idioma', 'appShell.theme': 'Tema',
      'appShell.dark': 'Oscuro', 'appShell.light': 'Claro'
    });
    files.set(name, JSON.stringify(catalog, null, 2) + '\n');
  }
  const hashes = [];
  for (const [name, content] of files) {
    if (signal?.aborted) throw Object.assign(new Error('Integración cancelada.'), { code: 'CANCELLED' });
    const target = path.resolve(stage, ...name.split('/'));
    if (!target.startsWith(stage + path.sep)) throw fail('Ruta de integración inválida.');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { flag: 'wx' });
    hashes.push({ path: name, sha256: sha256(content) });
  }
  if (signal?.aborted) throw Object.assign(new Error('Integración cancelada.'), { code: 'CANCELLED' });
  await publishArtifact(stage, destination, Object.fromEntries(files));
  return { directory: destination, fileHashes: hashes };
}
