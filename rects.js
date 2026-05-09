#!/usr/bin/env node
/**
 * Usage: node rects.js [options] 100x50 200x80 60x60 ...
 *
 * --offset <value>       Add (positive) or subtract (negative) mm from every W and H.
 * --cwd <dir>            Set working directory; used to resolve image lookups and relative
 *                        href paths in the combined SVG. Defaults to process.cwd().
 * --explode              Write one SVG file per rect instead of a combined stdout SVG.
 *                        Files are named: 1.100x50.svg, 2.200x80.svg, ...
 * --explode-path <dir>   Directory where --explode saves its SVG files. Defaults to --cwd.
 * --use-images           Search --cwd for images named like "1.*.{tif,tiff,png,jpg,...}"
 *                        and embed them (linked) scaled-to-fit inside the matching rect.
 * --use-images-absolute-path  Use absolute hrefs for linked images; default is relative.
 * --images-scaling       Strategies used to scale images when they are placed on the rect width | height | cover | fit = default.
 */

import fs from 'fs';
import path from 'path';

const rawArgs = process.argv.slice(2);

if (rawArgs.length === 0) {
  console.error("Usage: node rects.js [--offset <n>] [--cwd <dir>] [--explode] [--explode-path <dir>] [--use-images] [--use-images-absolute-path] [--images-scaling <width | height | cover | fit = default>] <WxH> ...");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse flags
// ---------------------------------------------------------------------------
let offset      = 0;
let padding     = 0;
let cwd         = process.cwd();
let explode     = false;
let explodePath = null;          // resolved after all flags are parsed
let useImages        = false;
let useImagesAbsPath = false;
let imagesScaling    = null;
const args      = [];

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
      const val = rawArgs[++i];

      if (!["width", "height", "cover"].includes(val)) {
        console.error(`Invalid --images-scaling value: "${val}"`);
        process.exit(1);
      }

      imagesScaling = val;
      break;
    }
    default:
      args.push(rawArgs[i]);
  }
}

if (args.length === 0) { console.error("No WxH arguments provided."); process.exit(1); }

// Apply --cwd: shift the process working directory so all relative paths are rooted there
try { process.chdir(cwd); }
catch (e) { console.error(`Cannot change to --cwd "${cwd}": ${e.message}`); process.exit(1); }

// Resolve explodePath after cwd is applied (relative --explode-path is now relative to cwd)
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

const imageMap = useImages ? findImages(process.cwd()) : {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const LABEL_HEIGHT = 8;
const GAP          = 14;

// Inkscape-compatible layer group
const layer = (id, lbl, content) =>
  `  <g id="${id}" inkscape:label="${lbl}" inkscape:groupmode="layer">\n${content}\n  </g>`;

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

function imageEl(absImgPath, rectX, rectY, rectW, rectH, svgOutputPath = null, clipId = null) {
  const href = useImagesAbsPath
    ? path.resolve(absImgPath)
    : path.relative(
        svgOutputPath
          ? path.dirname(path.resolve(svgOutputPath))
          : process.cwd(),
        absImgPath
      );

  let imgW = rectW;
  let imgH = rectH;

  try {
    const size = readImageSize(absImgPath);
    imgW = size.width;
    imgH = size.height;
  } catch (e) {
    console.error(`Warning: could not read dimensions of "${absImgPath}": ${e.message}`);
  }

  let scale;

  switch (imagesScaling) {
    case "width":
      scale = rectW / imgW;
      break;

    case "height":
      scale = rectH / imgH;
      break;

    case "cover":
      scale = Math.max(rectW / imgW, rectH / imgH);
      break;

    default:
      // original behavior
      scale = Math.min(rectW / imgW, rectH / imgH);
      break;
  }

  const scaledW = imgW * scale;
  const scaledH = imgH * scale;

  const x = rectX + (rectW - scaledW) / 2;
  const y = rectY + (rectH - scaledH) / 2;

  const clipAttr = clipId
    ? ` clip-path="url(#${clipId})"`
    : "";

  return `    <image xlink:href="${href}" x="${x}" y="${y}" width="${scaledW}" height="${scaledH}"${clipAttr} />`;
}

// ---------------------------------------------------------------------------
// SVG builder — single rect (explode mode)
// ---------------------------------------------------------------------------
function makeSingleSVG({ w, h, label }, position, outputFilePath) {
  const canvasW  = w + padding * 2;
  const canvasH  = h + padding * 2 + LABEL_HEIGHT;
  const fontSize = `${canvasH / 100}mm`;

  const rectEl  = `    <rect class="shape" x="${padding}" y="${padding}" width="${w}" height="${h}" />`;
  const textEl  = `    <text class="label" x="${padding + w / 2}" y="${h + padding + 2 * canvasH / 100}">${label}</text>`;

  const imgPath = imageMap[position];
  const imgLayer = useImages
    ? `\n${layer("layer-images", "Images",
    imgPath
      ? renderImage(imgPath, x, y, w, h, position, outputFilePath)
      : `    <!-- no image found for position ${position} -->`)}`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="${canvasW}mm"
     height="${canvasH}mm"
     viewBox="0 0 ${canvasW} ${canvasH}">

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

${layer("layer-rects",  "Rects",  rectEl)}${imgLayer}
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
    .map(rectSvg)
    .join("\n");

  const textEls = positioned
    .map(labelSvg)
    .join("\n");

  const imgEls = useImages
    ? positioned.map(({ x, y, w, h, position }) => {
        const imgPath = imageMap[position];
        return imgPath
          ? renderImage(imgPath, x, y, w, h, position,)        
          : `    <!-- no image found for position ${position} -->`;
    }).join("\n")
  : null;

  const imgLayerBlock = imgEls != null
    ? `\n${layer("layer-images", "Images", imgEls)}`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="${totalW}mm"
     height="${totalH}mm"
     viewBox="0 0 ${totalW} ${totalH}">

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

${layer("layer-rects",  "Rects",  rectEls)}${imgLayerBlock}
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

function renderImage(
  imgPath,
  x, y,
  w, h,
  position,
  svgOutputFilePath,
) {
  if (!imgPath) {
    return `    <!-- no image found for position ${position} -->`;
  }

  if (imagesScaling !== "cover") {
    return imageEl(
      imgPath,
      x, y,
      w, h,
      svgOutputFilePath,
    );
  }

  const clipId = `rect-${position}-clip`;

  return `
<defs>
  <clipPath id="${clipId}">
    <rect id="${clipId}-rect"
          x="${x}"
          y="${y}"
          width="${w}"
          height="${h}" />
  </clipPath>
</defs>

<rect id="${clipId}"
      x="${x}"
      y="${y}"
      width="${w}"
      height="${h}"
      fill="none" />

  ${imageEl(
    imgPath,
    padding,
    padding,
    w,
    h,
    svgOutputFilePath,
    clipId
  )}`;
}

function rectSvg({x, y, w, h, label}) {
  return `    <!-- ${label} -->\n    <rect class="shape" x="${x}" y="${y}" width="${w}" height="${h}" />`;
}

function labelSvg({ x, y, w, h, label }) {
  return `    <text class="label" x="${x + w / 2}" y="${y + h + 2 * totalH / 100}">${label}</text>`;
}
