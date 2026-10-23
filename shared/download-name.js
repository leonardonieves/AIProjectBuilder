const forbidden = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const reservedWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[. ]|$)/i;

export function projectDownloadFilename(name) {
  const safe = Array.from(String(name || '')
    .normalize('NFC')
    .replace(forbidden, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, ''))
    .slice(0, 100).join('')
    .replace(/^[. ]+|[. ]+$/g, '');
  if (!safe || reservedWindowsName.test(safe)) return 'project';
  return safe;
}

export function projectContentDisposition(name) {
  const filename = `${projectDownloadFilename(name)}.zip`;
  const ascii = filename.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g,
    char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
