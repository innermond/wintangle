#!/usr/bin/env node
/**
 * Usage: node rects.js [--offset <value>] [--explode] 100x50 200x80 60x60 ...
 *
 * --offset <value>  Add (positive) or subtract (negative) mm from every W and H.
 * --explode         Write one SVG file per rect instead of a combined stdout SVG.
 *                   Files are named: 1.100x50.svg, 2.200x80.svg, ...
 */

const fs      = require("fs");
const path    = require("path");
const rawArgs = process.argv.slice(2);

if (rawArgs.length === 0) {
  console.error("Usage: node rects.js [--offset <value>] [--explode] <WxH> [<WxH> ...]");
  process.exit(1);
}

// --- Parse flags ---
let offset  = 0;
let explode = false;
const args  = [];

for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--offset") {
    const val = parseFloat(rawArgs[++i]);
    if (isNaN(val)) { console.error(`Invalid --offset value: "${rawArgs[i]}"`); process.exit(1); }
    offset = val;
  } else if (rawArgs[i] === "--explode") {
    explode = true;
  } else {
    args.push(rawArgs[i]);
  }
}

if (args.length === 0) { console.error("No WxH arguments provided."); process.exit(1); }

// --- Parse each WxH argument ---
const rects = args.map((arg) => {
  const match = arg.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i);
  if (!match) { console.error(`Invalid argument "${arg}". Expected format: WxH (e.g. 100x50)`); process.exit(1); }
  const origW = parseFloat(match[1]);
  const origH = parseFloat(match[2]);
  const w = Math.max(0, origW + offset);
  const h = Math.max(0, origH + offset);
  const label = offset !== 0
    ? `${origW}x${origH} ${offset > 0 ? "+" : ""}${offset} = ${w}x${h} mm`
    : `${w}x${h} mm`;
  return { w, h, label, orig: arg };
});

// --- Layout constants (mm) ---
const PADDING      = 10;
const LABEL_HEIGHT = 8;
const GAP          = 14;

// --- SVG builder for a single rect ---
function makeSingleSVG({ w, h, label }) {
  const canvasW  = w + PADDING * 2;
  const canvasH  = h + PADDING * 2 + LABEL_HEIGHT;
  const fontSize = `${canvasH / 100}mm`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${canvasW}mm"
     height="${canvasH}mm"
     viewBox="0 0 ${canvasW} ${canvasH}">

  <style>
    rect.shape { fill: #dbeafe; stroke: #000; stroke-width: 0.4; }
    text.label {
      font-family: monospace, sans-serif;
      font-size: ${fontSize};
      fill: #000;
      text-anchor: middle;
      dominant-baseline: hanging;
    }
  </style>

  <rect class="shape" x="${PADDING}" y="${PADDING}" width="${w}" height="${h}" />
  <text class="label" x="${PADDING + w / 2}" y="${PADDING + h + 2}">${label}</text>

</svg>
`;
}

// --- SVG builder for combined layout ---
function makeCombinedSVG(rects) {
  let x = PADDING;
  const y = PADDING;
  const positioned = rects.map((r) => {
    const pos = { ...r, x, y };
    x += r.w + GAP;
    return pos;
  });
  const totalW   = x - GAP + PADDING;
  const totalH   = Math.max(...rects.map(r => r.h)) + PADDING * 2 + LABEL_HEIGHT;
  const fontSize = `${totalH / 100}mm`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${totalW}mm"
     height="${totalH}mm"
     viewBox="0 0 ${totalW} ${totalH}">

  <style>
    rect.shape { fill: #dbeafe; stroke: #000; stroke-width: 0.4; }
    text.label {
      font-family: monospace, sans-serif;
      font-size: ${fontSize};
      fill: #000;
      text-anchor: middle;
      dominant-baseline: hanging;
    }
  </style>

${positioned.map(({ x, y, w, h, label }) => `  <!-- ${label} -->
  <rect class="shape" x="${x}" y="${y}" width="${w}" height="${h}" />
  <text class="label" x="${x + w / 2}" y="${y + h + 2}">${label}</text>`).join("\n\n")}

</svg>
`;
}

// --- Output ---
if (explode) {
  rects.forEach((rect, i) => {
    const filename = `${i + 1}.${rect.orig}.svg`;
    fs.writeFileSync(filename, makeSingleSVG(rect), "utf8");
    console.error(`Written: ${filename}`);
  });
} else {
  process.stdout.write(makeCombinedSVG(rects));
}
