import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, editPlan, approvePlan } from '../server/domain.js';
const project = () => createProject({ name: 'Demo', description: 'Gestor ficticio de tareas' });
test('new project never reports agent execution', () => { const p = project(); assert.equal(p.status, 'draft'); assert.ok(p.stages.every(s => s.status === 'not_connected')); });
test('incomplete plans cannot be approved', () => { const p = project(); assert.throws(() => approvePlan(p, { revision: 1 })); });
test('editing invalidates approval', () => { const p = project(); editPlan(p, { revision: 1, plan: 'Plan completo con criterios.' }); approvePlan(p, { revision: 2 }); assert.ok(p.approval.sha256); editPlan(p, { revision: 2, plan: 'Plan diferente.' }); assert.equal(p.approval, null); assert.equal(p.status, 'draft'); });
test('stale approvals are rejected', () => { const p = project(); editPlan(p, { revision: 1, plan: 'Nuevo plan' }); assert.throws(() => approvePlan(p, { revision: 1 }), { status: 409 }); });
test('empty descriptions rejected', () => assert.throws(() => createProject({ name: 'Demo', description: ' ' })));
