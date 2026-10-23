import { useI18n } from './i18n.jsx';
import React, { useEffect, useState } from 'react';
import './live-agents.css';

export default function LiveAgents({ project, dirty, busy }) {
  const { t, date } = useI18n();
  const time = date;
  const labels = { starting: t("Iniciando proceso"), running: t("Proceso activo"), cancelling: t("Esperando cierre"),
  completed: t("Completado"), failed: t("Falló"), interrupted: t("Interrumpido"), cancelled: t("Cancelado"),
  prepared: t("Preparado · no ejecutado"), not_connected: t("Ejecutor pendiente de conectar"),
  awaiting_integration: t("Trabajadores terminados · integración pendiente"),
  integration_starting: t("Iniciando integración"), integration_running: t("Integración activa"),
  integration_cancelling: t("Deteniendo integración"), integration_failed: t("Integración fallida"),
  integrated_unverified: t("Aplicación ensamblada · sin validar") };

  const [snapshot, setSnapshot] = useState(null), [connected, setConnected] = useState(false);
  const [error, setError] = useState(''), [pending, setPending] = useState(false);
  const [workerConsent, setWorkerConsent] = useState(false);
  const [integrationConsent, setIntegrationConsent] = useState(false);
  useEffect(() => {
    const stream = new EventSource('/api/projects/' + project.id + '/live');
    stream.onmessage = event => { setSnapshot(JSON.parse(event.data)); setConnected(true); };
    stream.onerror = () => setConnected(false);
    return () => stream.close();
  }, [project.id]);
  async function post(route, body = {}) {
    setPending(true); setError('');
    try {
      const response = await fetch('/api/projects/' + project.id + route, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo completar la operación.');
    } catch (e) { setError(e.message); } finally { setPending(false); }
  }
  const planner = snapshot?.planner;
  const workflow = snapshot?.workflows[0];
  const taskStatus = task => task.status === 'not_connected' && task.id === 'integration' ?
    t('En espera de las dos entregas') : task.status === 'not_connected' ?
    t('No implementado · no ejecutado') : labels[task.status] || task.status;
  useEffect(() => { setWorkerConsent(false); setIntegrationConsent(false); }, [workflow?.id]);
  const active = (['running', 'cancelling'].includes(planner?.status) && !!planner?.processStartedAt ? 1 : 0) +
    (workflow?.tasks.filter(task => ['interface', 'logic', 'integration'].includes(task.id) &&
      ['running', 'cancelling'].includes(task.status) &&
      !!task.processStartedAt && !task.processClosedAt).length || 0);
  return <section className="live-team" aria-label={t("Equipo y actividad real")}>
    <h2>{t("Equipo y actividad en vivo")}</h2>
    <p role="status">{connected ? t("● Conectado") : t("○ Sin actualización en vivo; el estado puede estar desactualizado")}
      {' · '}{connected ? <>{t("Procesos registrados activos:")} {active}</> : t("Actividad actual desconocida")}</p>
    <p className="muted">{t("Preparar organiza dependencias sin consumir IA. Los trabajadores y la integración requieren consentimientos separados. Las pruebas siguen pendientes.")}</p>
    <p className="muted">{t("Si se actualizó el código del servidor, detén y vuelve a iniciar Iniciar.ps1 antes de crear otro flujo. Recargar el navegador solo actualiza la interfaz.")}</p>
    {error && <p className="error" role="alert">{t(error)}</p>}
    <article className="agent-card"><h3>{t("Planificador Codex")}</h3>
      <strong>{planner ? labels[planner.status] || planner.status : t("Sin ejecución")}</strong>
      {planner && <><p>{t("Modelo solicitado:")} {planner.requestedModel}</p><small>{t("Ejecución:")} {planner.id}</small>
        <p>{t("Solicitud:")} {time(planner.startedAt)}<br/>{t("Proceso iniciado:")} {time(planner.processStartedAt)}<br/>{t("Fin:")} {time(planner.finishedAt)}</p>
        {planner.error && <p>{t(planner.error)}</p>}
        {['starting', 'running', 'cancelling'].includes(planner.status) && <button disabled={pending || !connected || planner.status === 'cancelling'}
          onClick={() => post('/planner/' + planner.id + '/cancel')}>{t("Cancelar planificación")}</button>}</>}
    </article>
    <div className="actions"><button disabled={busy || pending || dirty || !connected || !project.approval || project.needsReplanning ||
      (['prepared', 'awaiting_integration', 'integration_starting', 'integration_running',
        'integrated_unverified'].includes(workflow?.status) && !workflow.stale && workflow.workerContracts?.length === 2)}
      onClick={() => post('/coordinator/prepare', { revision: project.revision })}>{t("Preparar equipo con este plan aprobado")}</button></div>
    {workflow && <><h3>{t("Flujo de la revisión")} {workflow.revision} · {labels[workflow.status] || workflow.status}</h3>
      {workflow.stale && <p className="error">{t("El plan cambió: este flujo ya no permite ejecución. Aprueba y prepara la nueva revisión.")}</p>}
      <p className="muted">{t("Límite previsto:")} {workflow.maxParallel} {t("trabajadores. Flujos guardados:")} {snapshot.workflows.length}.</p>
      <p><strong>{t("Ruta prevista para el resultado final:")}</strong> <code>{workflow.resultDirectory}</code></p>
      <p className="muted">{workflow.finalArtifact ? t("La carpeta final se creó; la aplicación sigue sin validar.") :
        t("Esta ruta es solo una previsión: la carpeta app no existe hasta que la integración termine. No se aceptan rutas arbitrarias desde el navegador.")}</p>
      {workflow.status === 'failed' && <p className="error" role="alert">{workflow.tasks.some(task => task.status === 'completed' && ['interface', 'logic'].includes(task.id)) ?
        t("El flujo se detuvo: un trabajador completó su entrega, pero el otro falló. La entrega completada permanece en su carpeta; no existe aplicación final. Revisa el error y prepara un flujo nuevo para reintentar.") :
        t("El flujo se detuvo porque falló un trabajador. El otro se canceló automáticamente. No se creó la aplicación final. Revisa el error de la tarjeta y prepara un flujo nuevo para volver a intentar; no se reanuda este flujo.")}</p>}
      <div className="agent-grid">{workflow.tasks.map(task => <article className="agent-card" key={task.id}>
        <h3>{t(task.label)}</h3><strong>{taskStatus(task)}</strong>
        {['interface', 'logic', 'integration'].includes(task.id) && <p>{t("Modelo solicitado:")} {task.requestedModel}</p>}
        {workflow.workerContracts?.find(contract => contract.role === task.id) &&
          <p>{t("Archivos asignados:")} {workflow.workerContracts.find(contract => contract.role === task.id).owns.join(', ')}</p>}
        {task.processStartedAt && <p>{t("Proceso iniciado:")} {time(task.processStartedAt)}<br/>{t("Fin:")} {time(task.processClosedAt)}</p>}
        {task.runId && <small>{t("Ejecución:")} {task.runId}</small>}
        {task.fileHashes && <p>{t("Archivos entregados:")} {task.fileHashes.length}</p>}
        {task.outputDirectory && <p>{t("Carpeta de entrega creada:")} <code>{task.outputDirectory}</code></p>}
        {task.error && <p className="error">{t(task.error)}</p>}
        <small>{t("Depende de:")} {task.dependencies.map(id => t(workflow.tasks.find(task => task.id === id)?.label || id)).join(', ') || t("Plan aprobado")}</small>
      </article>)}</div>
      {workflow.status === 'prepared' && !workflow.stale && workflow.workerContracts?.length === 2 &&
        <><label className="worker-consent"><input type="checkbox" checked={workerConsent} disabled={pending || busy}
          onChange={event => setWorkerConsent(event.target.checked)}/>
          {t("Confirmo esta carpeta predeterminada y autorizo enviar el plan aprobado a dos trabajadores Codex, con consumo de mi cuenta.")}</label>
          <button className="primary" disabled={pending || busy || dirty || !connected || !workerConsent}
            onClick={() => {
              if (!window.confirm(t("¿Iniciar dos trabajadores Codex para esta revisión en la carpeta mostrada?"))) return;
              post('/coordinator/' + workflow.id + '/start',
                { revision: project.revision, consent: true, destination: 'managed-default' });
              setWorkerConsent(false);
            }}>{t("Iniciar trabajadores de interfaz y lógica")}</button></>}
      {workflow.status === 'awaiting_integration' && !workflow.stale &&
        <><p className="muted">{t("Se verificarán las huellas de ambas entregas antes de enviar su contenido al integrador Codex. El resultado se colocará en la carpeta mostrada, sin ejecutar pruebas ni compilaciones.")}</p>
          <label className="worker-consent"><input type="checkbox" checked={integrationConsent} disabled={pending || busy}
            onChange={event => setIntegrationConsent(event.target.checked)}/>
            {t("Confirmo la carpeta final y autorizo enviar el plan y ambas entregas al integrador Codex, con consumo de mi cuenta.")}</label>
          <button className="primary" disabled={pending || busy || dirty || !connected || !integrationConsent}
            onClick={() => {
              if (!window.confirm(t("¿Integrar las entregas en la carpeta final mostrada?"))) return;
              post('/coordinator/' + workflow.id + '/integrate',
                { revision: project.revision, consent: true, destination: 'managed-default' });
              setIntegrationConsent(false);
            }}>{t("Integrar entregas")}</button></>}
      {['starting', 'running', 'cancelling', 'integration_starting', 'integration_running',
        'integration_cancelling'].includes(workflow.status) &&
        <button disabled={pending || !connected || ['cancelling', 'integration_cancelling'].includes(workflow.status)}
          onClick={() => post('/coordinator/' + workflow.id + '/stop')}>{t("Detener ejecución")}</button>}
      {workflow.finalArtifact && <p><strong>{t("Aplicación ensamblada, todavía sin validar:")}</strong> <code>{workflow.finalArtifact.directory}</code>
        {' · '}{t("Archivos:")} {workflow.finalArtifact.fileHashes.length}</p>}
      {workflow.integrationError && <p className="error">{t(workflow.integrationError)}</p>}
      {workflow.parallelEvidence && <p>{workflow.parallelEvidence.observed ?
        t("Solapamiento real de procesos registrado.") : t("No se registró solapamiento de procesos.")}</p>}
      {workflow.status === 'prepared' && <button disabled={pending || !connected} onClick={() => post('/coordinator/' + workflow.id + '/cancel')}>{t("Cancelar preparación")}</button>}
    </>}
    <h3>{t("Registro del servidor")}</h3><ul className="timeline">{snapshot?.events.map((event, i) => <li key={i}><time>{time(event.at)}</time>{event.message}</li>)}</ul>
  </section>;
}
