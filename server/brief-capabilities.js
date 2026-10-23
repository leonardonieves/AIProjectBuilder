// Only explicit storage/server requirements trigger this guard; do not infer intent from locale.
export function requiresBrowserOnly(brief) {
  const description = typeof brief?.description === 'string' ? brief.description : '';
  return /\blocalStorage\b|\bbrowser[ -](?:only|storage|stored)\b|\bclient[ -]side\s+only\b|\b(?:no|without)\s+backend\b|\b(?:stor(?:e|ed|ing)|sav(?:e|ed|ing))\s+(?:the\s+)?(?:data|tasks|records)\s+in\s+(?:the\s+)?browser\b|\bwithout\s+(?:an?\s+)?(?:(?:application|own)\s+)?server\b|\bno\s+(?:(?:application|own)\s+)?server\b|\b(?:datos|tareas)\s+se\s+guardan\s+en\s+el\s+navegador\b|\bsin\s+(?:servidor|backend)\b|\bno\s+requiere\s+(?:un\s+)?servidor\b/i.test(description);
}

export function assertTemplateMatchesBrief(brief, contract) {
  if (requiresBrowserOnly(brief) && contract.template !== 'react-browser-local-v1')
    throw Object.assign(new Error('gen.templateMismatch'), { status: 409 });
}
