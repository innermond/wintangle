#!/usr/bin/env node
/**
 * Usage: node rects.js 100x50 200x80 60x60 ...
 * Outputs an SVG to stdout with one rect per argument, dimensions in millimeters.
 */

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node rects.js <WxH> [<WxH> ...]");
  console.error("Example: node rects.js 100x50 200x80 60x60");
  process.exit(1);
}

// Parse each WxH argument
const rects = args.map((arg, i) => {
  const match = arg.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i);
  if (!match) {
    console.error(`Invalid argument "${arg}". Expected format: WxH (e.g. 100x50)`);
    process.exit(1);
  }
  return { w: parseFloat(match[1]), h: parseFloat(match[2]) };
});

// Layout constants (all in mm)
const PADDING      = 10;   // gap around each rect
const LABEL_HEIGHT = 8;    // space below each rect for the label
const GAP          = 14;   // horizontal gap between rects

// Compute positions — single row layout
let x = PADDING;
const y = PADDING;

const positioned = rects.map((r) => {
  const pos = { ...r, x, y };
  x += r.w + GAP;
  return pos;
});

// Overall SVG canvas size (mm)
const totalW = x - GAP + PADDING;
const totalH = Math.max(...rects.map(r => r.h)) + PADDING * 2 + LABEL_HEIGHT;

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
      font-size: 4px;
      fill: #000;
      text-anchor: middle;
      dominant-baseline: hanging;
    }
  </style>

${positioned.map(({ x, y, w, h }) => `  <!-- ${w}x${h} mm -->
  <rect class="shape" x="${x}" y="${y}" width="${w}" height="${h}" />
  <text class="label" x="${x + w / 2}" y="${y + h + 2}">${w}x${h} mm</text>`).join("\n\n")}

</svg>
`;

process.stdout.write(svg);
