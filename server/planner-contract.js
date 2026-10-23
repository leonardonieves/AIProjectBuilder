import { technicalSchema, contractBlock } from './generation-contract.js';
export const sections = {
  summary: 'Objective and summary', scope: 'Included scope', exclusions: 'Out of scope',
  architecture: 'Architecture and technical decisions', files: 'Planned files',
  tasks: 'Tasks, owners, and dependencies', acceptance: 'Acceptance criteria',
  tests: 'Proposed checks not executed', risks: 'Risks',
  assumptions: 'Assumptions and open questions'
};
export const planSchema = {
  type: 'object', additionalProperties: false, required: [...Object.keys(sections), 'technical'],
  properties: { ...Object.fromEntries(Object.keys(sections).map(key => [key, { type: 'string' }])), technical: technicalSchema }
};
export function validatePlan(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Codex did not return a structured plan.');
  if (!value.technical || !value.technical.template) throw new Error('gen.contractRequired');
  for (const key of Object.keys(sections)) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 10000)
      throw new Error('Incomplete or oversized response: ' + key);
  }
  if (Object.keys(value).some(key => !(key in sections) && key !== 'technical')) throw new Error('Unexpected fields in the response.');
  const markdown = '# Codex-generated plan\n\n' + Object.entries(sections).map(([key, title]) => '## ' + title + '\n' + value[key].trim()).join('\n\n') +
    contractBlock(value.technical);
  if (markdown.length > 50000) throw new Error('The plan exceeds the allowed size.');
  return markdown;
}
