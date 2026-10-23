import path from 'node:path';
import { mkdir, lstat, writeFile, readFile, rename } from 'node:fs/promises';

export async function publishArtifact(stage, destination, files, move = rename) {
  // Windows may deny directory renames after source files have been closed.
  // Exclusive creation preserves existing output, including links and partial work.
  try { await move(stage, destination); }
  catch (error) {
    if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
    await mkdir(destination);
    for (const [name, content] of Object.entries(files)) {
      const parts = name.split('/');
      if (parts.some(part => !part || part === '.' || part === '..' || /[\\:]/.test(part)))
        throw new Error('gen.unsafePath');
      let directory = destination;
      for (const part of parts.slice(0, -1)) {
        directory = path.join(directory, part);
        await mkdir(directory).catch(e => { if (e.code !== 'EEXIST') throw e; });
        const info = await lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('gen.unsafePath');
      }
      const target = path.join(destination, ...parts);
      await writeFile(target, content, { flag: 'wx' });
      if (await readFile(target, 'utf8') !== content) throw new Error('gen.artifactChanged');
    }
  }
}
