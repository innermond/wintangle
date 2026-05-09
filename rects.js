#!/usr/bin/env node
/**
 * Usage: node rects.js [--offset <value>] 100x50 200x80 60x60 ...
 * Outputs an SVG to stdout with one rect per argument, dimensions in millimeters.
 *
 * --offset <value>  Add (positive) or subtract (negative) mm from every W and H.
 */

const rawArgs = process.argv.slice(2);

if (rawArgs.length === 0) {
  console.error("Usage: node rects.js [--offset <value>] <WxH> [<WxH> ...]");
  console.error("Example: node rects.js --offset -5 100x50 200x80 60x60");
  process.exit(1);
}

// --- Pull out --offset flag ---
let offset = 0;
const args = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--offset") {
    const val = parseFloat(rawArgs[++i]);
    if (isNaN(val)) {
      console.error(`Invalid --offset value: "${rawArgs[i]}"`);
      process.exit(1);
    }
    offset = val;
  } else {
    args.push(rawArgs[i]);
  }
}

if (args.length === 0) {
  console.error("No WxH arguments provided.");
  process.exit(1);
}

// --- Parse each WxH argument ---
const rects = args.map((arg) => {
  const match = arg.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i);
  if (!match) {
    console.error(`Invalid argument "${arg}". Expected format: WxH (e.g. 100x50)`);
    process.exit(1);
  }
  const origW = parseFloat(match[1]);
  const origH = parseFloat(match[2]);
  const w = Math.max(0, origW + offset);
  const h = Math.max(0, origH + offset);
  const label = offset !== 0
    ? `${origW}x${origH} ${offset > 0 ? "+" : ""}${offset} = ${w}x${h} mm`
    : `${w}x${h} mm`;
  return { w, h, label, orig: arg };
});

// --- Layout constants (all in mm) ---
const PADDING      = 10;
const LABEL_HEIGHT = 8;
const GAP          = 14;

// Single-row layout
let x = PADDING;
const y = PADDING;
const positioned = rects.map((r) => {
  const pos = { ...r, x, y };
  x += r.w + GAP;
  return pos;
});

// --- SVG canvas size ---
const totalW = x - GAP + PADDING;
const totalH = Math.max(...rects.map(r => r.h)) + PADDING * 2 + LABEL_HEIGHT;

// Font size proportional to tallest rect
const fontSize = `${totalH / 100}mm`;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${totalW}mm"
     height="${totalH}mm"
     viewBox="0 0 ${totalW} ${totalH}">

  <style>
    rect.shape {
      fill: #dbeafe;
      stroke: #1d4ed8;
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

${positioned.map(({ x, y, w, h, label }) => `  <!-- ${label} -->
  <rect class="shape" x="${x}" y="${y}" width="${w}" height="${h}" />
  <text class="label" x="${x + w / 2}" y="${y + h + 2}">${label}</text>`).join("\n\n")}

</svg>
`;

process.stdout.write(svg);
