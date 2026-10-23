import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, stat, lstat, rename } from 'node:fs/promises';
import path from 'node:path';
import { plannerModelArgs, POC_MODEL, POC_REASONING } from './model-policy.js';
import { workerDirectory, workerPrompt } from './worker-contract.js';

const schema = {
  type: 'object', additionalProperties: false, required: ['summary', 'files'],
  properties: {
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } } }
  }
};
const digest = text => createHash('sha256').update(text).digest('hex');
const fail = message => Object.assign(new Error(message), { status: 409 });

export function validateWorkerResult(contract, result) {
  if (!result || Array.isArray(result) || typeof result !== 'object' ||
      typeof result.summary !== 'string' || result.summary.length > 4000 ||
      !Array.isArray(result.files) || result.files.length > 30)
    throw fail('Entrega del trabajador incompleta o demasiado grande.');
  if (result.files.length === 0)
    throw fail('Codex no entregó archivos. No se creó ninguna carpeta de resultado.');
  const names = new Set();
  let total = 0;
  const files = result.files.map(file => {
    const name = file?.path;
    if (typeof name !== 'string' || name.length > 240 || name.includes('\\') ||
        name.startsWith('/') || name.includes(':') || name.includes('\0') ||
        path.posix.normalize(name) !== name ||
        name.split('/').some(part => !part || part.startsWith('.') || /[. ]$/.test(part) ||
          /[<>"|?*\x00-\x1f]/.test(part) || part.toLowerCase() === 'node_modules' ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part)) ||
        !contract.owns.some(prefix => prefix.endsWith('/') ? name.startsWith(prefix) : name === prefix))
      throw fail('Archivo fuera de la propiedad asignada al trabajador.');
    const key = name.toLowerCase();
    if (names.has(key) || typeof file.content !== 'string' || Buffer.byteLength(file.content) > 100000)
      throw fail('Archivo duplicado o demasiado grande.');
    names.add(key);
    total += Buffer.byteLength(file.content);
    if (total > 750000) throw fail('Entrega del trabajador supera el límite.');
    return { path: name, content: file.content, sha256: digest(file.content) };
  });
  if (contract.role === 'interface' &&
      !['src/locales/en.json', 'src/locales/es.json', 'src/themes.css'].every(name => names.has(name)))
    throw fail('La interfaz debe entregar catálogos EN/ES y estilos de temas oscuro/claro.');
  if (contract.role === 'interface') {
    for (const name of ['src/locales/en.json', 'src/locales/es.json']) {
      let catalog;
      try { catalog = JSON.parse(result.files.find(file => file.path === name).content); }
      catch { throw fail('Catálogo de idioma inválido.'); }
      if (!catalog || Array.isArray(catalog) || typeof catalog !== 'object' ||
          Object.values(catalog).some(value => typeof value !== 'string'))
        throw fail('Catálogo de idioma inválido.');
    }
    const themes = result.files.find(file => file.path === 'src/themes.css').content;
    if (!/dark/i.test(themes) || !/light/i.test(themes))
      throw fail('Faltan estilos para ambos temas.');
  }
  if (contract.role === 'integration' &&
      !['src/main.jsx', 'src/i18n.jsx', 'src/AppShell.jsx', 'src/system.css'].every(name => names.has(name.toLowerCase())))
    throw fail('La integración debe entregar entrada, i18n, shell y estilos compartidos.');
  if (contract.role === 'integration') {
    const main = result.files.find(file => file.path === 'src/main.jsx').content;
    const i18n = result.files.find(file => file.path === 'src/i18n.jsx').content;
    if (!/AppShell/.test(main) || !/themes\.css/.test(main) || !/system\.css/.test(main) ||
        !/locales\/en\.json/.test(i18n) || !/locales\/es\.json/.test(i18n))
      throw fail('Faltan conexiones entre la entrada, los temas y los catálogos.');
  }
  return { summary: result.summary, files };
}

async function ensurePlainDirectory(directory) {
  try { await mkdir(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw fail('Destino administrado no es una carpeta segura.');
}

async function materialize(root, workflow, contract, result, privateDirectory, signal) {
  const final = workerDirectory(root, workflow, contract.role);
  const base = path.resolve(root, 'generated-projects');
  await ensurePlainDirectory(base);
  await ensurePlainDirectory(path.dirname(final));
  try { await lstat(final); throw fail('La carpeta del trabajador ya existe; no se sobrescribe.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const staging = path.join(privateDirectory, 'output');
  await mkdir(staging);
  for (const file of result.files) {
    if (signal?.aborted) throw Object.assign(new Error('Trabajador cancelado.'), { code: 'CANCELLED' });
    const target = path.resolve(staging, ...file.path.split('/'));
    if (!target.startsWith(staging + path.sep)) throw fail('Ruta de archivo inválida.');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, { flag: 'wx' });
  }
  if (signal?.aborted) throw Object.assign(new Error('Trabajador cancelado.'), { code: 'CANCELLED' });
  await rename(staging, final);
  return { directory: final, files: result.files.map(({ path: file, sha256 }) => ({ path: file, sha256 })) };
}

export async function runWorker(root, workflow, contract, runId, { signal, onStarted = () => {}, onClosed = () => {},
  responseOnly = false, outputSchema = schema, prompt = null } = {}) {
  const privateDirectory = path.join(root, 'data', 'worker-runs', runId);
  const workspace = path.join(privateDirectory, 'workspace');
  const home = path.join(root, 'data', 'codex-home');
  await mkdir(workspace, { recursive: true });
  await mkdir(home, { recursive: true });
  const schemaPath = path.join(privateDirectory, 'schema.json');
  const resultPath = path.join(privateDirectory, 'result.json');
  await writeFile(schemaPath, JSON.stringify(outputSchema));
  const args = ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', 'read-only', '-C', workspace, '--json', '--output-schema', schemaPath,
    '--output-last-message', resultPath,
    '-c', 'approval_policy="never"', '-c', 'features.shell_tool=false',
    '-c', 'features.shell_snapshot=false', '-c', 'web_search="disabled"',
    '-c', 'memories.use_memories=false', '-c', 'memories.generate_memories=false',
    '-c', 'project_doc_max_bytes=0', ...plannerModelArgs(), '-'];
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'PATHEXT'].includes(key.toUpperCase())) env[key] = value;
  }
  env.CODEX_HOME = home;
  let stdout = '', stderr = '';
  try {
    await new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(Object.assign(new Error('Trabajador cancelado.'), { code: 'CANCELLED' }));
      const child = spawn(process.env.AIPB_CODEX_BIN || 'codex.exe', args,
        { cwd: workspace, env, shell: false, windowsHide: true });
      let settled = false, stoppingError = null;
      const finish = error => { if (settled) return; settled = true; clearTimeout(timer);
        signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
      const stop = error => { stoppingError ||= error; child.kill(); };
      const abort = () => stop(Object.assign(new Error('Trabajador cancelado.'), { code: 'CANCELLED' }));
      const timer = setTimeout(() => stop(new Error('Tiempo agotado del trabajador (10 minutos).')), 600000);
      signal?.addEventListener('abort', abort, { once: true });
      child.once('spawn', () => { try { onStarted({ at: new Date().toISOString(), pid: child.pid }); }
        catch (error) { stop(error); } if (signal?.aborted) abort(); });
      const collect = (chunk, target) => {
        if (settled || stoppingError) return;
        if (target === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 2 * 1024 * 1024)
          stop(new Error('La salida del trabajador superó el límite permitido.'));
      };
      child.stdout.on('data', chunk => collect(chunk, 'stdout'));
      child.stderr.on('data', chunk => collect(chunk, 'stderr'));
      child.once('error', () => { const error = new Error('No se pudo iniciar o detener Codex.');
        if (!child.pid) finish(error); else stoppingError ||= error; });
      child.stdin.on('error', () => {});
      child.once('close', code => { const at = new Date().toISOString();
        try { onClosed({ at, exitCode: code }); }
        catch (error) { stoppingError ||= error; }
        finish(stoppingError || (code === 0 ? null : new Error('Codex terminó con error (' + code + ').'))); });
      child.stdin.end(prompt ?? workerPrompt(contract));
    });
    if (signal?.aborted) throw Object.assign(new Error('Trabajador cancelado.'), { code: 'CANCELLED' });
    if ((await stat(resultPath)).size > 1000000) throw fail('La entrega supera el límite permitido.');
    const response = JSON.parse(await readFile(resultPath, 'utf8'));
    if (responseOnly) return response;
    const result = validateWorkerResult(contract, response);
    if (signal?.aborted) throw Object.assign(new Error('Trabajador cancelado.'), { code: 'CANCELLED' });
    const artifact = await materialize(root, workflow, contract, result, privateDirectory, signal);
    return { ...artifact, summary: result.summary, requestedModel: POC_MODEL,
      requestedReasoning: POC_REASONING, finishedAt: new Date().toISOString(),
      artifactDirectory: path.relative(root, privateDirectory) };
  } finally {
    // Private diagnostics never go through the dashboard API.
    await Promise.allSettled([
      writeFile(path.join(privateDirectory, 'events.jsonl'), stdout),
      writeFile(path.join(privateDirectory, 'stderr.log'), stderr)
    ]);
  }
}
