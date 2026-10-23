import { spawn } from 'node:child_process';
import { resolveCodexExecutable } from './codex-executable.js';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { planSchema, validatePlan } from './planner-contract.js';
import { plannerModelArgs, POC_MODEL, POC_REASONING } from './model-policy.js';
import { buildPlannerPrompt } from './planner-prompt.js';
import { assertTemplateMatchesBrief } from './brief-capabilities.js';
import { technicalContract } from './generation-contract.js';

export async function generatePlan(root, brief, runId, { signal, onStarted = () => {} } = {}) {
  const modelArgs = plannerModelArgs();
  const home = path.join(root, 'data', 'codex-home');
  const directory = path.join(root, 'data', 'planner-runs', runId);
  const workspace = path.join(directory, 'workspace');
  await mkdir(workspace, { recursive: true });
  await mkdir(home, { recursive: true });
  const schemaPath = path.join(directory, 'schema.json');
  const resultPath = path.join(directory, 'result.json');
  await writeFile(schemaPath, JSON.stringify(planSchema));
  const prompt = buildPlannerPrompt(brief);
  const args = ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', 'read-only', '-C', workspace, '--json', '--output-schema', schemaPath,
    '--output-last-message', resultPath,
    '-c', 'approval_policy="never"', '-c', 'features.shell_tool=false',
    '-c', 'features.shell_snapshot=false', '-c', 'web_search="disabled"',
    '-c', 'memories.use_memories=false', '-c', 'memories.generate_memories=false',
    '-c', 'project_doc_max_bytes=0'];
  args.push(...modelArgs);
  args.push('-');
  // No browser-supplied executable, arguments or credentials. No credential copying.
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'PATHEXT'].includes(key.toUpperCase())) env[key] = value;
  }
  env.CODEX_HOME = home;
  const startedAt = new Date().toISOString();
  let stdout = '', stderr = '';
  try {
    await new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(Object.assign(new Error('Planificación cancelada.'), { code: 'CANCELLED' }));
      const child = spawn(resolveCodexExecutable(), args, { cwd: workspace, env, shell: false, windowsHide: true });
      let settled = false, stoppingError = null;
      const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
      // Keep the slot occupied until close confirms that the process has stopped.
      const stop = error => { stoppingError ||= error; child.kill(); };
      const abort = () => stop(Object.assign(new Error('Planificación cancelada.'), { code: 'CANCELLED' }));
      const timer = setTimeout(() => stop(new Error('Tiempo agotado (5 minutos). Revisa la conexión antes de reintentar.')), 300000);
      signal?.addEventListener('abort', abort, { once: true });
      child.once('spawn', () => {
        try { onStarted({ at: new Date().toISOString(), pid: child.pid }); }
        catch (error) { stop(error); }
        if (signal?.aborted) abort();
      });
      function collect(chunk, target) {
        if (settled || stoppingError) return;
        if (target === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 2 * 1024 * 1024) {
          stop(new Error('La salida del planificador superó el límite permitido.'));
        }
      }
      child.stdout.on('data', chunk => collect(chunk, 'stdout'));
      child.stderr.on('data', chunk => collect(chunk, 'stderr'));
      child.once('error', cause => {
        stderr += `\nCodex process error: ${cause.code || 'UNKNOWN'}: ${cause.message}\n`;
        const error = new Error('No se pudo iniciar o detener Codex. Revisa el diagnóstico local.');
        if (!child.pid) finish(error); else stoppingError ||= error;
      });
      child.stdin.on('error', () => {}); // EPIPE is covered by the process exit.
      child.once('close', code => finish(stoppingError || (code === 0 ? null : new Error('Codex terminó con error (' + code + '). Revisa la sesión mediante Preparar-Codex.ps1 y el diagnóstico local.'))));
      child.stdin.end(prompt);
    });
    if ((await stat(resultPath)).size > 100000) throw new Error('La respuesta supera el límite permitido.');
    const structured = JSON.parse(await readFile(resultPath, 'utf8'));
    if (!structured.technical) throw new Error('gen.contractRequired');
    assertTemplateMatchesBrief(brief, technicalContract(structured.technical));
    const plan = validatePlan(structured);
    if (signal?.aborted) throw Object.assign(new Error('Planificación cancelada.'), { code: 'CANCELLED' });
    return { plan, structured, requestedModel: POC_MODEL, requestedReasoning: POC_REASONING, startedAt, finishedAt: new Date().toISOString() };
  } finally {
    // Private artifacts, excluded from Git. Never expose raw process output through the API.
    await writeFile(path.join(directory, 'events.jsonl'), stdout);
    await writeFile(path.join(directory, 'stderr.log'), stderr);
  }
}
