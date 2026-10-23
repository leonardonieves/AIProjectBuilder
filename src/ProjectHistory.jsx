import { useI18n } from './i18n.jsx';
import React, { useEffect, useState } from 'react';
import './history.css';

export default function ProjectHistory({ project, busy, dirty, onContinue }) {
  const { t, date } = useI18n();
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');
  const [changes, setChanges] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setHistory(null); setError('');
    fetch('/api/projects/' + project.id + '/history', { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No se pudo cargar el historial.');
        setHistory(result);
      }).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [project.id, project.revision, project.events.length]);
  const states = { starting: t("Iniciando"), running: t("En curso"), cancelling: t("Cancelando"), cancelled: t("Cancelada"), completed: t("Completada"), failed: t("Fallida"), interrupted: t("Interrumpida") };
  return <section className="project-history">
    <h2>{t("Continuar este proyecto")}</h2>
    <p className="muted">{t("Describe el siguiente cambio. Guardaremos una nueva revisión, conservando los planes y aprobaciones anteriores. Esto no inicia agentes ni modifica código.")}</p>
    <form onSubmit={async e => {
      e.preventDefault();
      if (!window.confirm(t("Se invalidará la aprobación actual. El plan previo seguirá disponible en el historial. ¿Continuar?"))) return;
      if (await onContinue(changes)) setChanges('');
    }}>
      <label>{t("Nuevos requisitos")}<textarea rows={3} required maxLength={10000} disabled={busy} value={changes} onChange={e => setChanges(e.target.value)} placeholder={t("Por ejemplo: agregar prioridades a las tareas.")}/></label>
      <button disabled={busy || dirty || !changes.trim()}>{t("Guardar nueva solicitud")}</button>
    </form>
    {project.needsReplanning && <p className="notice">{t("Hay nuevos requisitos pendientes. Genera un plan actualizado o incorpora los cambios manualmente y guárdalo antes de aprobar.")}</p>}
    <h2>{t("Versiones y aprobaciones")}</h2>
    {error && <p role="alert" className="error">{t(error)}</p>}
    {!history && !error && <p role="status">{t("Cargando historial…")}</p>}
    {history?.versions.map(v => <details key={v.revision}>
      <summary>{t("Revisión")} {v.revision} · {v.approvedAt ? t("Aprobada el ") + date(v.approvedAt) : t("Sin aprobación registrada")} · {v.origin}</summary>
      <p className="muted">{t("Guardada:")} {date(v.savedAt)} {t("· Huella:")} {v.sha256}</p>
      <h3>{t("Requisitos de esta versión")}</h3><pre>{v.brief.description + '\n\n' + v.brief.context}</pre>
      <h3>{t("Plan guardado (solo lectura)")}</h3><pre>{v.plan}</pre>
    </details>)}
    <h2>{t("Ejecuciones guardadas")}</h2>
    {history?.runs.length === 0 && <p className="muted">{t("No hay ejecuciones estructuradas registradas. Las anteriores a SQLite pueden aparecer únicamente en el registro de actividad.")}</p>}
    {history?.runs.map(run => <article className="run-record" key={run.id}>
      <b>{t("Planificador ·")} {states[run.status] || run.status}</b>
      <p>{t("Modelo solicitado:")} {run.requested_model || t("No registrado")} {t("· Revisión de entrada:")} {run.plan_revision}</p>
      <p>{t("Inicio:")} {date(run.started_at)}{run.finished_at && t(" · Fin: ") + date(run.finished_at)}</p>
      <small>{t("Ejecución:")} {run.id} {t("· Carpeta local:")} {run.artifact_directory}</small>
      {run.error && <p className="error">{t(run.error)}</p>}
    </article>)}
  </section>;
}
