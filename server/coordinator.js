import { createHash, randomUUID } from 'node:crypto';
import { POC_MODEL } from './model-policy.js';

const graph = [
  ['contracts', 'Arquitectura y contratos', []],
  ['interface', 'Interfaz', ['contracts']],
  ['logic', 'Lógica', ['contracts']],
  ['integration', 'Integración', ['interface', 'logic']],
  ['tester', 'Pruebas autorizadas', ['integration']],
  ['reviewer', 'Revisión independiente', ['integration']],
  ['documentation', 'Documentación', ['tester', 'reviewer']]
];
export function matchesApproval(project, workflow) {
  const hash = createHash('sha256').update(project.plan).digest('hex');
  return !project.needsReplanning && project.approval?.revision === project.revision &&
    project.approval.sha256 === hash && workflow.revision === project.revision && workflow.approvedHash === hash;
}
export function prepareWorkflow(project) {
  const workflow = { id: randomUUID(), projectId: project.id, revision: project.revision,
    approvedHash: project.approval?.sha256, status: 'prepared', createdAt: new Date().toISOString(),
    maxParallel: 2, tasks: graph.map(([id, label, dependencies]) => ({ id, label, dependencies,
      status: 'not_connected', requestedModel: POC_MODEL, startedAt: null, finishedAt: null })) };
  if (!matchesApproval(project, workflow)) throw Object.assign(new Error('Aprueba la revisión vigente antes de preparar el equipo.'), { status: 409 });
  return workflow;
}
// Preparation only records the approved dependency graph; explicit start routes launch processes.
