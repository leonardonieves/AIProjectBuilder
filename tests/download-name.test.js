import test from 'node:test';
import assert from 'node:assert/strict';
import { projectDownloadFilename, projectContentDisposition } from '../shared/download-name.js';

test('project archive names are readable and preserve international project names', () => {
  assert.equal(projectDownloadFilename('My task manager'), 'My task manager');
  assert.equal(projectDownloadFilename('Gestor de tareas ñ'), 'Gestor de tareas ñ');
  assert.equal(projectContentDisposition('Gestor de tareas ñ'),
    "attachment; filename=\"Gestor de tareas n.zip\"; filename*=UTF-8''Gestor%20de%20tareas%20%C3%B1.zip");
});

test('project archive names cannot introduce a path or a reserved Windows device name', () => {
  assert.equal(projectDownloadFilename('..\\CON.txt'), '-CON.txt');
  assert.equal(projectDownloadFilename('CON'), 'project');
  assert.equal(projectDownloadFilename('   '), 'project');
  assert.ok(projectDownloadFilename('x'.repeat(200)).length <= 100);
});
