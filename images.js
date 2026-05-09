import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Resolve images: scan cwd for files matching /^\d+\./
// Map position index (1-based) → relative file path
// ---------------------------------------------------------------------------
const IMAGE_EXTS = new Set([".tif", ".tiff", ".png", ".jpg", ".jpeg",]);

function findImages(dir) {
  const map = {}; // 1-based position → absolute path
  let entries;
  try { entries = fs.readdirSync(dir); }
  catch (e) { console.error(`Cannot read directory "${dir}": ${e.message}`); process.exit(1); }

  for (const entry of entries) {
    const m = entry.match(/^(\d+)\./);
    if (!m) continue;
    const ext = path.extname(entry).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;
    const pos = parseInt(m[1], 10);
    // First match wins if multiple files share the same position prefix
    if (!map[pos]) map[pos] = path.join(dir, entry);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Minimal image dimension reader — PNG, JPEG, TIFF (no external deps)
// ---------------------------------------------------------------------------
function readImageSize(filePath) {
  const fd  = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(256);
  fs.readSync(fd, buf, 0, 256, 0);
  fs.closeSync(fd);

  // PNG: signature 8 bytes, then IHDR chunk: 4 len + 4 "IHDR" + 4 W + 4 H
  if (buf[0] === 0x89 && buf.slice(1, 4).toString() === "PNG") {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // JPEG: scan for SOF marker (0xFF 0xC0–0xC3, 0xC5–0xC7, 0xC9–0xCB, 0xCD–0xCF)
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    const full = fs.readFileSync(filePath);
    let i = 2;
    while (i < full.length - 8) {
      if (full[i] !== 0xFF) break;
      const marker = full[i + 1];
      if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) ||
          (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
        return { width: full.readUInt16BE(i + 7), height: full.readUInt16BE(i + 5) };
      }
      i += 2 + full.readUInt16BE(i + 2);
    }
    throw new Error("Could not find JPEG SOF marker");
  }

  // TIFF: little-endian "II" or big-endian "MM"
  const tiffSig = buf.slice(0, 2).toString();
  if (tiffSig === "II" || tiffSig === "MM") {
    const le      = tiffSig === "II";
    const readU16 = (o) => le ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
    const readU32 = (o) => le ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
    const ifdOff  = readU32(4);
    const full    = fs.readFileSync(filePath);
    const entries = le ? full.readUInt16LE(ifdOff) : full.readUInt16BE(ifdOff);
    let width = null, height = null;
    for (let i = 0; i < entries; i++) {
      const off = ifdOff + 2 + i * 12;
      const tag = le ? full.readUInt16LE(off) : full.readUInt16BE(off);
      const val = le ? full.readUInt32LE(off + 8) : full.readUInt32BE(off + 8);
      if (tag === 256) width  = val;  // ImageWidth
      if (tag === 257) height = val;  // ImageLength
      if (width !== null && height !== null) break;
    }
    if (width !== null && height !== null) return { width, height };
    throw new Error("Could not find TIFF width/height tags");
  }

  throw new Error(`Unrecognised image format in "${filePath}"`);
}

export { findImages, readImageSize };
