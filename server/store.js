import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 409) => Object.assign(new Error(message), { status });

export class ProjectStore {
  constructor(root) {
    const data = path.join(root, 'data');
    mkdirSync(data, { recursive: true });
    this.db = new DatabaseSync(path.join(data, 'projects.sqlite'));
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 2) { this.db.close(); throw new Error('La base requiere una version mas reciente de la aplicacion.'); }
    this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, revision INTEGER NOT NULL, snapshot TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plan_versions (
        project_id TEXT NOT NULL REFERENCES projects(id), revision INTEGER NOT NULL,
        plan TEXT NOT NULL, brief TEXT NOT NULL, origin TEXT NOT NULL,
        sha256 TEXT NOT NULL, saved_at TEXT NOT NULL,
        PRIMARY KEY(project_id, revision)
      );
      CREATE TABLE IF NOT EXISTS approvals (
        project_id TEXT NOT NULL, revision INTEGER NOT NULL, sha256 TEXT NOT NULL, approved_at TEXT NOT NULL,
        PRIMARY KEY(project_id, revision),
        FOREIGN KEY(project_id,revision) REFERENCES plan_versions(project_id,revision)
      );
      CREATE TABLE IF NOT EXISTS events (
        project_id TEXT NOT NULL REFERENCES projects(id), sequence INTEGER NOT NULL,
        at TEXT NOT NULL, message TEXT NOT NULL, PRIMARY KEY(project_id,sequence)
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        plan_revision INTEGER NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL,
        requested_model TEXT, started_at TEXT NOT NULL, finished_at TEXT,
        error TEXT, artifact_directory TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runs_project ON runs(project_id,started_at);
      CREATE TABLE IF NOT EXISTS legacy_imports (
        filename TEXT PRIMARY KEY, sha256 TEXT NOT NULL, imported_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        created_at TEXT NOT NULL, snapshot TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS workflows_project ON workflows(project_id,created_at);
      PRAGMA user_version=2;
      COMMIT;
    `);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  validate(p) {
    if (!p || !uuid.test(p.id) || !Number.isInteger(p.revision) || p.revision < 1 ||
      typeof p.plan !== 'string' || !p.plan.trim() || !p.brief ||
      ['name', 'description', 'context'].some(key => typeof p.brief[key] !== 'string') ||
      typeof p.createdAt !== 'string' || !Array.isArray(p.events) || !Array.isArray(p.stages) ||
      p.events.some(e => typeof e.at !== 'string' || typeof e.message !== 'string'))
      throw fail('Proyecto invalido. Se conserva el JSON original.', 400);
    if (p.approval && (p.approval.revision !== p.revision || p.approval.sha256 !== hash(p.plan)))
      throw fail('La aprobacion no coincide con el plan. No se importa ni guarda.');
  }
  load(id) {
    if (!uuid.test(id)) throw fail('Identificador invalido.', 400);
    const row = this.db.prepare('SELECT snapshot FROM projects WHERE id=?').get(id);
    if (!row) throw fail('Proyecto no encontrado.', 404);
    return JSON.parse(row.snapshot);
  }
  list() { return this.db.prepare('SELECT snapshot FROM projects ORDER BY updated_at DESC, id').all().map(r => JSON.parse(r.snapshot)); }
  deleteProject(id, expectedName, revision) {
    return this.transaction(() => {
      const project = this.load(id);
      if (typeof expectedName !== 'string' || expectedName !== project.brief.name || revision !== project.revision)
        throw fail('project.deleteMismatch', 409);
      this.db.prepare('DELETE FROM workflows WHERE project_id=?').run(id);
      this.db.prepare('DELETE FROM runs WHERE project_id=?').run(id);
      this.db.prepare('DELETE FROM events WHERE project_id=?').run(id);
      this.db.prepare('DELETE FROM approvals WHERE project_id=?').run(id);
      this.db.prepare('DELETE FROM plan_versions WHERE project_id=?').run(id);
      this.db.prepare('DELETE FROM projects WHERE id=?').run(id);
      // Imported source JSON and generated attempt folders are deliberately retained.
      // Keep legacy_imports so a restart does not silently recreate the deleted project.
      return { id, deleted: true, filesRetained: true };
    });
  }
  save(p) { return this.transaction(() => this.write(p)); }
  write(p) {
    this.validate(p);
    const previous = this.db.prepare('SELECT snapshot FROM projects WHERE id=?').get(p.id);
    if (previous) {
      const old = JSON.parse(previous.snapshot);
      if (p.revision < old.revision || p.revision > old.revision + 1) throw fail('Revision obsoleta o salto de version.');
      if (p.events.length < old.events.length || old.events.some((e, i) => e.at !== p.events[i].at || e.message !== p.events[i].message))
        throw fail('El historial de eventos es inmutable.');
    }
    const now = new Date().toISOString();
    const brief = JSON.stringify(p.brief);
    const version = this.db.prepare('SELECT plan,brief FROM plan_versions WHERE project_id=? AND revision=?').get(p.id, p.revision);
    if (version && (version.plan !== p.plan || version.brief !== brief)) throw fail('El contenido de una revision guardada es inmutable.');
    this.db.prepare(`INSERT INTO projects VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, updated_at=excluded.updated_at, revision=excluded.revision, snapshot=excluded.snapshot`)
      .run(p.id, p.brief.name, p.createdAt, now, p.revision, JSON.stringify(p));
    this.db.prepare('INSERT OR IGNORE INTO plan_versions VALUES (?,?,?,?,?,?,?)')
      .run(p.id, p.revision, p.plan, brief, p.planOrigin || 'manual', hash(p.plan), now);
    if (p.approval) this.db.prepare('INSERT OR IGNORE INTO approvals VALUES (?,?,?,?)')
      .run(p.id, p.revision, p.approval.sha256, p.approval.at);
    const insert = this.db.prepare('INSERT OR IGNORE INTO events VALUES (?,?,?,?)');
    p.events.forEach((e, i) => insert.run(p.id, i, e.at, e.message));
    if (p.planningRun) {
      const r = p.planningRun;
      this.db.prepare(`INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        status=excluded.status, finished_at=excluded.finished_at, error=excluded.error`)
        .run(r.id, p.id, r.revision, 'planner', r.status, r.requestedModel || null, r.startedAt,
          r.finishedAt || null, r.error || null, 'data/planner-runs/' + r.id);
    }
    return p;
  }
  history(id) {
    this.load(id);
    return {
      versions: this.db.prepare(`SELECT v.revision,v.plan,v.brief,v.origin,v.sha256,v.saved_at AS savedAt,
        a.approved_at AS approvedAt FROM plan_versions v LEFT JOIN approvals a
        ON v.project_id=a.project_id AND v.revision=a.revision WHERE v.project_id=? ORDER BY v.revision DESC`).all(id)
        .map(v => ({ ...v, brief: JSON.parse(v.brief) })),
      runs: this.db.prepare('SELECT * FROM runs WHERE project_id=? ORDER BY started_at DESC').all(id)
    };
  }
  workflows(id) {
    this.load(id);
    return this.db.prepare('SELECT snapshot FROM workflows WHERE project_id=? ORDER BY created_at DESC, rowid DESC')
      .all(id).map(row => JSON.parse(row.snapshot));
  }
  saveWorkflow(workflow) {
    this.db.prepare(`INSERT INTO workflows VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot`)
      .run(workflow.id, workflow.projectId, workflow.createdAt, JSON.stringify(workflow));
    return workflow;
  }
  importLegacy(directory) {
    if (!existsSync(directory)) return 0;
    // Only project JSON files, never codex-home or any credential directory.
    const files = readdirSync(directory).filter(n => n.endsWith('.json') && uuid.test(n.slice(0, -5))).sort();
    return this.transaction(() => {
      let count = 0;
      for (const name of files) {
        const raw = readFileSync(path.join(directory, name), 'utf8');
        const digest = hash(raw);
        const imported = this.db.prepare('SELECT sha256 FROM legacy_imports WHERE filename=?').get(name);
        if (imported) {
          if (imported.sha256 !== digest) throw new Error('JSON importado modificado: ' + name + '. Deten el servidor antiguo y reconcilia manualmente.');
          continue;
        }
        let p;
        try { p = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { throw new Error('JSON invalido: ' + name + '. Importacion cancelada.'); }
        this.validate(p);
        if (p.id !== name.slice(0, -5)) throw new Error('Identificador inconsistente: ' + name);
        if (this.db.prepare('SELECT id FROM projects WHERE id=?').get(p.id)) throw new Error('Colision de proyecto: ' + name);
        this.write(p);
        this.db.prepare('INSERT INTO legacy_imports VALUES (?,?,?)').run(name, digest, new Date().toISOString());
        count++;
      }
      return count;
    });
  }
  recoverInterrupted() {
    this.transaction(() => {
      for (const p of this.list()) {
        const isRunning = ['starting', 'running', 'cancelling'].includes(p.planningRun?.status);
        const legacyRunning = p.events.at(-1)?.message.startsWith('Planificador Codex iniciado.');
        if (!isRunning && !legacyRunning) continue;
        const at = new Date().toISOString();
        if (isRunning) p.planningRun = { ...p.planningRun, status: 'interrupted', finishedAt: at, error: 'Servidor reiniciado.' };
        p.events.push({ at, message: 'Ejecucion interrumpida por reinicio. El plan se conserva; no hay reintento automatico.' });
        this.write(p);
      }
      for (const row of this.db.prepare('SELECT snapshot FROM workflows').all()) {
        const workflow = JSON.parse(row.snapshot);
        if (workflow.kind === 'generation') continue; // Recovered by the v2 generation engine, not legacy tasks.
        if (!['starting', 'running', 'cancelling', 'integration_starting',
          'integration_running', 'integration_cancelling'].includes(workflow.status)) continue;
        const at = new Date().toISOString();
        workflow.status = 'interrupted'; workflow.finishedAt = at;
        for (const task of workflow.tasks) {
          if (['starting', 'running', 'cancelling'].includes(task.status)) {
            task.status = 'interrupted'; task.finishedAt = at;
            task.error = 'Servidor reiniciado; no se reintenta automáticamente.';
          }
        }
        this.saveWorkflow(workflow);
      }
    });
  }
  close() { this.db.close(); }
}
