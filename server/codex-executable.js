import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Resolve only trusted, server-side native executable locations; never invoke a shell.
export function resolveCodexExecutable() {
  const nativeName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const candidates = [process.env.AIPB_CODEX_BIN];
  for (const entry of (process.env.PATH || process.env.Path || '').split(path.delimiter)) {
    if (entry) candidates.push(path.join(entry, nativeName));
  }
  if (process.platform === 'win32') {
    const roots = [process.env.LOCALAPPDATA,
      process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'AppData', 'Local')];
    for (const root of new Set(roots.filter(Boolean))) {
      const base = path.join(root, 'OpenAI', 'Codex', 'bin');
      candidates.push(path.join(base, nativeName));
      try {
        const versions = readdirSync(base, { withFileTypes: true })
          .filter(entry => entry.isDirectory())
          .map(entry => path.join(base, entry.name, nativeName))
          .filter(file => existsSync(file))
          .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
        candidates.push(...versions);
      } catch { /* A missing desktop installation is allowed. */ }
    }
  }
  for (const candidate of candidates.filter(Boolean)) {
    if (process.platform === 'win32' && path.extname(candidate).toLowerCase() !== '.exe') continue;
    try { if (statSync(candidate).isFile()) return path.resolve(candidate); }
    catch { /* Ignore stale paths left by desktop runtime updates. */ }
  }
  return nativeName;
}
