#!/usr/bin/env node
/**
 * Usage: node rects.js [options] 100x50 200x80 60x60 ...
 *
 * --offset <value>            Add/subtract mm from every W and H.
 * --padding <value>           Inner padding around rects in the canvas (mm).
 * --cwd <dir>                 Set working directory for image lookup and relative hrefs.
 * --explode                   Write one SVG file per rect (named 1.WxH.svg, 2.WxH.svg ...).
 * --explode-path <dir>        Directory where --explode saves its SVG files.
 * --use-images                Search --cwd for images named like "1.*.{tif,tiff,png,jpg,...}".
 * --use-images-absolute-path  Use absolute hrefs for linked images (default: relative).
 * --images-scaling <mode>     How to scale images inside their rect:
 *                               fit    (default) scale to fit, preserving aspect ratio
 *                               width  force-fit to rect width (may overflow vertically)
 *                               height force-fit to rect height (may overflow horizontally)
 *                               cover  fill the rect completely, clip the overflow
 */

import fs   from 'fs';
import path from 'path';

const rawArgs = process.argv.slice(2);

if (rawArgs.length === 0) {
  console.error("Usage: node rects.js [--offset <n>] [--padding <n>] [--cwd <dir>] [--explode] [--explode-path <dir>] [--use-images] [--use-images-absolute-path] [--images-scaling fit|width|height|cover] <WxH> ...");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse flags
// ---------------------------------------------------------------------------
let offset          = 0;
let padding         = 0;
let cwd             = process.cwd();
let explode         = false;
let explodePath     = null;
let useImages       = false;
let useImagesAbsPath = false;
let imagesScaling   = "fit";   // fit | width | height | cover
const args          = [];

for (let i = 0; i < rawArgs.length; i++) {
  switch (rawArgs[i]) {
    case "--offset": {
      const val = parseFloat(rawArgs[++i]);
      if (isNaN(val)) { console.error(`Invalid --offset value: "${rawArgs[i]}"`); process.exit(1); }
      offset = val;
      break;
    }
    case "--padding": {
      const val = parseFloat(rawArgs[++i]);
      if (isNaN(val)) { console.error(`Invalid --padding value: "${rawArgs[i]}"`); process.exit(1); }
      padding = val;
      break;
    }
    case "--cwd":
      cwd = path.resolve(rawArgs[++i]);
      break;
    case "--explode":
      explode = true;
      break;
    case "--explode-path":
      explodePath = rawArgs[++i];
      break;
    case "--use-images":
      useImages = true;
      break;
    case "--use-images-absolute-path":
      useImagesAbsPath = true;
      break;
    case "--images-scaling": {
      const mode = rawArgs[++i];
      if (!["fit", "width", "height", "cover"].includes(mode)) {
        console.error(`Invalid --images-scaling "${mode}". Expected: fit | width | height | cover`);
        process.exit(1);
      }
      imagesScaling = mode;
      break;
    }
    default:
      args.push(rawArgs[i]);
  }
}

if (args.length === 0) { console.error("No WxH arguments provided."); process.exit(1); }

try { process.chdir(cwd); }
catch (e) { console.error(`Cannot change to --cwd "${cwd}": ${e.message}`); process.exit(1); }

if (explodePath === null) explodePath = process.cwd();
else explodePath = path.resolve(explodePath);

// ---------------------------------------------------------------------------
// Parse WxH arguments
// ---------------------------------------------------------------------------
const rects = args.map((arg) => {
  const match = arg.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i);
  if (!match) { console.error(`Invalid argument "${arg}". Expected WxH (e.g. 100x50)`); process.exit(1); }
  const origW = parseFloat(match[1]);
  const origH = parseFloat(match[2]);
  const w = Math.max(0, origW + offset);
  const h = Math.max(0, origH + offset);
  const label = offset !== 0
    ? `${origW}x${origH} ${offset > 0 ? "+" : ""}${offset} = ${w}x${h} mm`
    : `${w}x${h} mm`;
  return { w, h, label, orig: arg };
});

// ---------------------------------------------------------------------------
// Image lookup
// ---------------------------------------------------------------------------
const IMAGE_EXTS = new Set([".tif", ".tiff", ".png", ".jpg", ".jpeg"]);

function findImages(dir) {
  const map = {};
  let entries;
  try { entries = fs.readdirSync(dir); }
  catch (e) { console.error(`Cannot read directory "${dir}": ${e.message}`); process.exit(1); }
  for (const entry of entries) {
    const m = entry.match(/^(\d+)\./);
    if (!m) continue;
    const ext = path.extname(entry).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;
    const pos = parseInt(m[1], 10);
    if (!map[pos]) map[pos] = path.join(dir, entry);
  }
  return map;
}

const imageMap = useImages ? findImages(process.cwd()) : {};

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
const LABEL_HEIGHT = 8;
const GAP          = 14;

// ---------------------------------------------------------------------------
// Inkscape layer group
// ---------------------------------------------------------------------------
const layer = (id, lbl, content) =>
  `  <g id="${id}" inkscape:label="${lbl}" inkscape:groupmode="layer">\n${content}\n  </g>`;

// ---------------------------------------------------------------------------
// Image dimension reader — PNG, JPEG, TIFF (no external deps)
// ---------------------------------------------------------------------------
function readImageSize(filePath) {
  const fd  = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(256);
  fs.readSync(fd, buf, 0, 256, 0);
  fs.closeSync(fd);

  if (buf[0] === 0x89 && buf.slice(1, 4).toString() === "PNG")
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };

  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    const full = fs.readFileSync(filePath);
    let i = 2;
    while (i < full.length - 8) {
      if (full[i] !== 0xFF) break;
      const marker = full[i + 1];
      if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) ||
          (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF))
        return { width: full.readUInt16BE(i + 7), height: full.readUInt16BE(i + 5) };
      i += 2 + full.readUInt16BE(i + 2);
    }
    throw new Error("Could not find JPEG SOF marker");
  }

  const tiffSig = buf.slice(0, 2).toString();
  if (tiffSig === "II" || tiffSig === "MM") {
    const le     = tiffSig === "II";
    const readU32 = (o) => le ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
    const ifdOff = readU32(4);
    const full   = fs.readFileSync(filePath);
    const entries = le ? full.readUInt16LE(ifdOff) : full.readUInt16BE(ifdOff);
    let width = null, height = null;
    for (let i = 0; i < entries; i++) {
      const off = ifdOff + 2 + i * 12;
      const tag = le ? full.readUInt16LE(off) : full.readUInt16BE(off);
      const val = le ? full.readUInt32LE(off + 8) : full.readUInt32BE(off + 8);
      if (tag === 256) width  = val;
      if (tag === 257) height = val;
      if (width !== null && height !== null) break;
    }
    if (width !== null && height !== null) return { width, height };
    throw new Error("Could not find TIFF width/height tags");
  }

  throw new Error(`Unrecognised image format in "${filePath}"`);
}

// ---------------------------------------------------------------------------
// Image element builder
// Returns { el: string, clipDef: string|null }
//   el      — the <image> SVG element
//   clipDef — a <clipPath> to hoist to the SVG root (only for "cover" mode)
// ---------------------------------------------------------------------------
function imageEl(absImgPath, rectX, rectY, rectW, rectH, svgOutputPath, clipId) {
  const href = useImagesAbsPath
    ? path.resolve(absImgPath)
    : path.relative(
        svgOutputPath ? path.dirname(path.resolve(svgOutputPath)) : process.cwd(),
        absImgPath
      );

  let scaledW = rectW;
  let scaledH = rectH;
  let offsetX = 0;
  let offsetY = 0;

  try {
    const { width: imgW, height: imgH } = readImageSize(absImgPath);
    let scale;

    if (imagesScaling === "width") {
      scale   = rectW / imgW;
      scaledW = rectW;
      scaledH = imgH * scale;
    } else if (imagesScaling === "height") {
      scale   = rectH / imgH;
      scaledH = rectH;
      scaledW = imgW * scale;
    } else if (imagesScaling === "cover") {
      scale   = Math.max(rectW / imgW, rectH / imgH);
      scaledW = imgW * scale;
      scaledH = imgH * scale;
    } else {
      // "fit": scale to fit width, fall back to fit height if it overflows
      scale   = rectW / imgW;
      scaledW = rectW;
      scaledH = imgH * scale;
      if (scaledH > rectH) {
        scale   = rectH / imgH;
        scaledH = rectH;
        scaledW = imgW * scale;
      }
    }
  } catch (e) {
    console.error(`Warning: could not read dimensions of "${absImgPath}": ${e.message}`);
  }

  const x = rectX + (rectW - scaledW) / 2;
  const y = rectY + (rectH - scaledH) / 2;

  const clipAttr = imagesScaling === "cover" ? ` clip-path="url(#${clipId})"` : "";
  const el = `    <image href="${href}" x="${x}" y="${y}" width="${scaledW}" height="${scaledH}"${clipAttr} />`;

  // clipDef: a <clipPath> at SVG root level (not inside any layer)
  const clipDef = imagesScaling === "cover"
    ? `  <clipPath id="${clipId}">\n    <rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" />\n  </clipPath>`
    : null;

  return { el, clipDef };
}

// ---------------------------------------------------------------------------
// SVG builder — single rect (explode mode)
// ---------------------------------------------------------------------------
function makeSingleSVG({ w, h, label }, position, outputFilePath) {
  const canvasW  = w + padding * 2;
  const canvasH  = h + padding * 2 + LABEL_HEIGHT;
  const fontSize = `${canvasH / 100}mm`;

  const rectEl = `    <rect class="shape" x="${padding}" y="${padding}" width="${w}" height="${h}" />`;
  const textEl = `    <text class="label" x="${padding + w / 2}" y="${h + padding + 2 * canvasH / 100}">${label}</text>`;

  let imgLayerBlock = "";
  let clipDefs      = "";

  if (useImages) {
    const imgPath = imageMap[position];
    const clipId  = `rect-${position}-clip`;
    if (imgPath) {
      const { el, clipDef } = imageEl(imgPath, padding, padding, w, h, outputFilePath, clipId);
      if (clipDef) clipDefs = `\n${clipDef}`;
      imgLayerBlock = `\n${layer("layer-images", "Images", el)}`;
    } else {
      imgLayerBlock = `\n${layer("layer-images", "Images", `    <!-- no image found for position ${position} -->`)}`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="${canvasW}mm"
     height="${canvasH}mm"
     viewBox="0 0 ${canvasW} ${canvasH}">${clipDefs}

  <style>
    rect.shape {
      fill: #dbeafe;
      stroke: #000;
      stroke-width: 0.4;
    }
    text.label {
      font-family: monospace, sans-serif;
      font-size: ${fontSize};
      fill: #000;
      text-anchor: middle;
      dominant-baseline: hanging;
    }
  </style>

${layer("layer-rects", "Rects", rectEl)}${imgLayerBlock}
${layer("layer-labels", "Labels", textEl)}

</svg>
`;
}

// ---------------------------------------------------------------------------
// SVG builder — combined layout (stdout mode)
// ---------------------------------------------------------------------------
function makeCombinedSVG(rects) {
  let x = padding;
  const y = padding;

  const positioned = rects.map((r, i) => {
    const pos = { ...r, x, y, position: i + 1 };
    x += r.w + GAP;
    return pos;
  });

  const totalW   = x - GAP + padding;
  const totalH   = Math.max(...rects.map(r => r.h)) + padding * 2 + LABEL_HEIGHT;
  const fontSize = `${totalH / 100}mm`;

  const rectEls = positioned
    .map(({ x, y, w, h, label }) =>
      `    <!-- ${label} -->\n    <rect class="shape" x="${x}" y="${y}" width="${w}" height="${h}" />`)
    .join("\n");

  const textEls = positioned
    .map(({ x, y, w, h, label }) =>
      `    <text class="label" x="${x + w / 2}" y="${y + h + 2 * totalH / 100}">${label}</text>`)
    .join("\n");

  let imgLayerBlock = "";
  let clipDefs      = "";

  if (useImages) {
    const imgEls  = [];
    const clipBuf = [];

    for (const { x, y, w, h, position } of positioned) {
      const imgPath = imageMap[position];
      const clipId  = `rect-${position}-clip`;
      if (imgPath) {
        const { el, clipDef } = imageEl(imgPath, x, y, w, h, null, clipId);
        imgEls.push(el);
        if (clipDef) clipBuf.push(clipDef);
      } else {
        imgEls.push(`    <!-- no image found for position ${position} -->`);
      }
    }

    if (clipBuf.length) clipDefs = `\n${clipBuf.join("\n")}`;
    imgLayerBlock = `\n${layer("layer-images", "Images", imgEls.join("\n"))}`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="${totalW}mm"
     height="${totalH}mm"
     viewBox="0 0 ${totalW} ${totalH}">${clipDefs}

  <style>
    rect.shape {
      fill: #dbeafe;
      stroke: #000;
      stroke-width: 0.4;
    }
    text.label {
      font-family: monospace, sans-serif;
      font-size: ${fontSize};
      fill: #000;
      text-anchor: middle;
      dominant-baseline: hanging;
    }
  </style>

${layer("layer-rects", "Rects", rectEls)}${imgLayerBlock}
${layer("layer-labels", "Labels", textEls)}

</svg>
`;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
if (explode) {
  rects.forEach((rect, i) => {
    const position = i + 1;
    const filename = path.join(explodePath, `${position}.${rect.orig}.svg`);
    fs.mkdirSync(explodePath, { recursive: true });
    fs.writeFileSync(filename, makeSingleSVG(rect, position, filename), "utf8");
    const imgNote = useImages
      ? (imageMap[position] ? ` [image: ${path.basename(imageMap[position])}]` : " [no image]")
      : "";
    console.error(`Written: ${filename}${imgNote}`);
  });
} else {
  process.stdout.write(makeCombinedSVG(rects));
}
