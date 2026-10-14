/**
 * Minimal but correct OLE2 (Compound File Binary) builder for deterministic
 * MSG tests. Layout:
 *   sector 0: header
 *   sector 1: FAT
 *   sector 2: directory
 *   sector 3: mini stream
 *   sector 4: mini FAT
 * All streams are < 4096 bytes so they live in the mini stream.
 *
 * Exported layout constants let the adversarial tests (P2-034) corrupt one field of an otherwise valid file:
 * header at file offset 0, sector s at (s + 1) * 512, FAT in sector 0, directory from sector 1 (128-byte entries).
 */
import { createHash } from "node:crypto";

export const SECTOR = 512;
const MINI = 64;
export const END = 0xfffffffe;
export const FREE = 0xffffffff;
const FATSECT = 0xfffffffd;

interface Stream {
  name: string;
  data?: Buffer;
  isStorage?: boolean;
  children?: Stream[];
}

function dirEntry(name: string, type: number, start: number, size: number, child: number): Buffer {
  const b = Buffer.alloc(128);
  const nb = Buffer.from(name, "utf16le");
  nb.copy(b, 0, 0, Math.min(nb.length, 62));
  b.writeUInt16LE(Math.min(nb.length + 2, 64), 0x40);
  b.writeUInt8(type, 0x42);
  b.writeUInt8(1, 0x43);
  b.writeUInt32LE(FREE, 0x44);
  b.writeUInt32LE(FREE, 0x48);
  b.writeUInt32LE(child, 0x4c);
  b.writeUInt32LE(start, 0x74);
  b.writeBigUInt64LE(BigInt(size), 0x78);
  return b;
}

function propEntry(tag: number, type: number, value: Buffer | number | string, subs: Stream[]): Buffer {
  const e = Buffer.alloc(16);
  e.writeUInt32LE((type << 16) | tag, 0);
  e.writeUInt32LE(0, 4);
  if (typeof value === "number") {
    e.writeInt32LE(value, 8);
  } else {
    const data = typeof value === "string" ? Buffer.from(value, "utf16le") : value;
    subs.push({ name: `__substg1.0_${((type << 16) | tag).toString(16).padStart(8, "0").toUpperCase()}`, data });
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(0, 12);
  }
  return e;
}

export interface MsgSpec {
  subject: string;
  senderEmail: string;
  displayTo: string;
  transportHeaders: string;
  body: string;
  attachmentFilename: string;
  attachmentData: Buffer;
}

export function buildMsg(spec: MsgSpec): Buffer {
  const mainSubs: Stream[] = [];
  const mainEntries = [
    propEntry(0x0037, 0x001f, spec.subject, mainSubs),
    propEntry(0x0c1f, 0x001f, spec.senderEmail, mainSubs),
    propEntry(0x0e03, 0x001f, spec.displayTo, mainSubs),
    propEntry(0x007d, 0x001f, spec.transportHeaders, mainSubs),
    propEntry(0x1000, 0x001f, spec.body, mainSubs),
    propEntry(0x3701, 0x0002, 1, mainSubs),
  ];
  const mainHead = Buffer.alloc(8);
  mainHead.writeUInt32LE(mainEntries.length, 4);
  const mainProps = Buffer.concat([mainHead, ...mainEntries]);

  const attachSubs: Stream[] = [];
  const attachEntries = [
    propEntry(0x370a, 0x001f, spec.attachmentFilename, attachSubs),
    propEntry(0x370e, 0x0040, spec.attachmentData, attachSubs),
  ];
  const attachHead = Buffer.alloc(8);
  attachHead.writeUInt32LE(attachEntries.length, 4);
  const attachProps = Buffer.concat([attachHead, ...attachEntries]);

  const attachStorage: Stream = {
    name: "__attach_version1.0_#00000000",
    isStorage: true,
    children: [{ name: "__properties_version1.0", data: attachProps }, ...attachSubs],
  };

  const streams: Stream[] = [{ name: "__properties_version1.0", data: mainProps }, ...mainSubs, attachStorage];

  // Assign mini-stream offsets (each stream padded to 64 bytes).
  let offset = 0;
  const assign = (s: Stream) => {
    if (s.isStorage) {
      s.children?.forEach(assign);
    } else {
      (s as Stream & { start?: number }).start = offset;
      offset += Math.ceil((s.data as Buffer).length / MINI) * MINI;
    }
  };
  streams.forEach(assign);

  // Build mini stream.
  const miniStream = Buffer.alloc(offset);
  const writeMini = (s: Stream) => {
    if (s.isStorage) {
      s.children?.forEach(writeMini);
    } else {
      const st = s as Stream & { start: number };
      (s.data as Buffer).copy(miniStream, st.start);
    }
  };
  streams.forEach(writeMini);

  // Mini FAT: one entry per mini sector; each stream's chain is contiguous.
  const miniSectorCount = Math.max(1, Math.ceil(offset / MINI));
  const miniFat = new Array(miniSectorCount).fill(END);
  const markMini = (s: Stream) => {
    if (s.isStorage) {
      s.children?.forEach(markMini);
    } else {
      const st = s as Stream & { start: number };
      const n = Math.ceil((s.data as Buffer).length / MINI);
      for (let k = 0; k < n; k++) {
        miniFat[st.start / MINI + k] = k + 1 < n ? st.start / MINI + k + 1 : END;
      }
    }
  };
  streams.forEach(markMini);

  // Directory entries: root (child=1), then each stream.
  const dirs: Buffer[] = [];
  const addDir = (s: Stream) => {
    if (s.isStorage) {
      const childIdx = dirs.length + 1;
      dirs.push(dirEntry(s.name, 1, 0, 0, childIdx));
      s.children?.forEach(addDir);
    } else {
      const st = s as Stream & { start: number };
      dirs.push(dirEntry(s.name, 2, st.start / MINI, (s.data as Buffer).length, FREE));
    }
  };
  // Root entry first; its start (mini stream sector) is filled after layout.
  dirs.push(dirEntry("Root Entry", 5, 0, offset, 1));
  streams.forEach(addDir);
  const dirSectorCount = Math.max(1, Math.ceil(dirs.length / 4));

  // Sector layout: 0 FAT, 1..(1+dirSectorCount-1) directory, then mini stream, then mini FAT.
  const miniStreamSectors = Math.max(1, Math.ceil(offset / SECTOR));
  const miniStreamStart = 1 + dirSectorCount;
  const miniFatSector = miniStreamStart + miniStreamSectors;
  const sectorCount = miniFatSector + 1;
  const fat = new Array(sectorCount).fill(END);
  fat[0] = FATSECT;
  for (let i = 1; i < miniStreamStart; i++) fat[i] = i + 1 < miniStreamStart ? i + 1 : END;
  for (let i = miniStreamStart; i < miniFatSector; i++) fat[i] = i + 1 < miniFatSector ? i + 1 : END;
  fat[miniFatSector] = END;

  // Root entry start = mini stream start sector.
  const rootEntry = dirEntry("Root Entry", 5, miniStreamStart, offset, 1);
  rootEntry.copy(dirs[0], 0);

  const dirSector = Buffer.alloc(dirSectorCount * SECTOR);
  dirs.forEach((e, i) => e.copy(dirSector, i * 128));

  const miniFatBuf = Buffer.alloc(SECTOR);
  miniFat.forEach((v, i) => miniFatBuf.writeUInt32LE(v, i * 4));

  const fatBuf = Buffer.alloc(SECTOR);
  fat.forEach((v, i) => fatBuf.writeUInt32LE(v, i * 4));

  const header = Buffer.alloc(SECTOR);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  // [MS-CFB] 2.2 header (P2-034: offsets from 0x34 were previously shifted by 4 bytes, in step with the parser).
  header.writeUInt16LE(0x3e, 0x18); // minor version
  header.writeUInt16LE(3, 0x1a); // major version 3 (512-byte sectors)
  header.writeUInt16LE(0xfffe, 0x1c); // byte order: little-endian
  header.writeUInt16LE(9, 0x1e); // sector shift (512)
  header.writeUInt16LE(6, 0x20); // mini sector shift (64)
  header.writeUInt32LE(0, 0x28); // number of directory sectors (must be 0 for version 3)
  header.writeUInt32LE(1, 0x2c); // number of FAT sectors
  header.writeUInt32LE(1, 0x30); // first directory sector
  header.writeUInt32LE(0, 0x34); // transaction signature
  header.writeUInt32LE(4096, 0x38); // mini stream cutoff
  header.writeUInt32LE(miniFatSector, 0x3c); // first mini FAT sector
  header.writeUInt32LE(1, 0x40); // number of mini FAT sectors
  header.writeUInt32LE(END, 0x44); // first DIFAT sector (none)
  header.writeUInt32LE(0, 0x48); // number of DIFAT sectors
  header.writeUInt32LE(0, 0x4c); // DIFAT[0] = FAT sector 0
  for (let i = 1; i < 109; i++) header.writeUInt32LE(FREE, 0x4c + i * 4);

  const miniStreamBuf = Buffer.alloc(miniStreamSectors * SECTOR);
  miniStream.copy(miniStreamBuf, 0);

  return Buffer.concat([header, fatBuf, dirSector, miniStreamBuf, miniFatBuf]);
}

export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
