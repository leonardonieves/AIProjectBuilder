export const POC_MODEL = 'gpt-6-luna';
export const POC_REASONING = 'low';

// Cost policy, reviewed 2026-10-14. No default-model or expensive-model fallback.
export function plannerModelArgs(env = process.env) {
  if (env.AIPB_MODEL && env.AIPB_MODEL.trim() !== POC_MODEL) {
    throw new Error('POC limitado a ' + POC_MODEL + '. Quita AIPB_MODEL o asigna ese modelo. No se ejecutara una alternativa mas cara.');
  }
  return ['--model', POC_MODEL, '-c', 'model_reasoning_effort="' + POC_REASONING + '"'];
}