// Minimal ZIP STORE writer: bounded, manifest-controlled UTF-8 text files only.
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) { crc ^= byte; for (let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); } return (crc^0xffffffff)>>>0; }
export function zipFiles(files) {
  const local = [], central = []; let offset = 0, count = 0;
  for (const [name, content] of Object.entries(files).sort(([a],[b]) => a.localeCompare(b))) {
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(p=>!p||p==='..') || name.includes(':')) throw new Error('gen.unsafePath');
    const filename=Buffer.from(name), data=Buffer.from(content), crc=crc32(data);
    const header=Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4); header.writeUInt16LE(0x800,6);
    header.writeUInt16LE(0x21,12); header.writeUInt32LE(crc,14); header.writeUInt32LE(data.length,18); header.writeUInt32LE(data.length,22); header.writeUInt16LE(filename.length,26);
    local.push(header,filename,data);
    const directory=Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20,4); directory.writeUInt16LE(20,6); directory.writeUInt16LE(0x800,8);
    directory.writeUInt16LE(0x21,14); directory.writeUInt32LE(crc,16); directory.writeUInt32LE(data.length,20); directory.writeUInt32LE(data.length,24); directory.writeUInt16LE(filename.length,28); directory.writeUInt32LE(offset,42);
    central.push(directory,filename); offset+=header.length+filename.length+data.length; count++;
  }
  if(offset>5*1024*1024 || count>100) throw new Error('gen.outputLimit');
  const directory=Buffer.concat(central), end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count,8); end.writeUInt16LE(count,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
