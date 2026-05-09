#!/usr/bin/env node
/**
 * Usage: node rects.js [--offset <value>] [--explode] [--path-prefix <dir>] [--use-images] 100x50 ...
 *
 * --offset <value>    Add/subtract mm from every W and H.
 * --explode           Write one SVG file per rect (named 1.WxH.svg ...).
 * --path-prefix <dir> Base dir for --explode output and --use-images lookup.
 * --use-images        Search --path-prefix for images named "1.*.{tif,png,...}" and
 *                     embed them scaled-to-fit inside the matching rect.
 */

const fs      = require("fs");
const path    = require("path");
const rawArgs = process.argv.slice(2);

if (rawArgs.length === 0) { console.error("Usage: node rects.js [options] <WxH> ..."); process.exit(1); }

let offset     = 0;
let explode    = false;
let pathPrefix = ".";
let useImages  = false;
const args     = [];

for (let i = 0; i < rawArgs.length; i++) {
  switch (rawArgs[i]) {
    case "--offset":
      const val = parseFloat(rawArgs[++i]);
      if (isNaN(val)) { console.error(`Invalid --offset value`); process.exit(1); }
      offset = val; break;
    case "--explode":    explode = true; break;
    case "--path-prefix": pathPrefix = rawArgs[++i]; break;
    case "--use-images":  useImages = true; break;
    default: args.push(rawArgs[i]);
  }
}

if (args.length === 0) { console.error("No WxH arguments provided."); process.exit(1); }

const rects = args.map((arg) => {
  const match = arg.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i);
  if (!match) { console.error(`Invalid argument "${arg}".`); process.exit(1); }
  const origW = parseFloat(match[1]), origH = parseFloat(match[2]);
  const w = Math.max(0, origW + offset), h = Math.max(0, origH + offset);
  const label = offset !== 0
    ? `${origW}x${origH} ${offset > 0 ? "+" : ""}${offset} = ${w}x${h} mm`
    : `${w}x${h} mm`;
  return { w, h, label, orig: arg };
});

const IMAGE_EXTS = new Set([".tif", ".tiff", ".png", ".jpg", ".jpeg"]);

function findImages(dir) {
  const map = {};
  let entries;
  try { entries = fs.readdirSync(dir); }
  catch (e) { console.error(`Cannot read "${dir}": ${e.message}`); process.exit(1); }
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

const imageMap = useImages ? findImages(pathPrefix) : {};

const PADDING      = 10;
const LABEL_HEIGHT = 8;
const GAP          = 14;

const layer = (id, lbl, content) =>
  `  <g id="${id}" inkscape:label="${lbl}" inkscape:groupmode="layer">\n${content}\n  </g>`;

function imageEl(absImgPath, rectX, rectY, rectW, rectH, svgOutputPath) {
  const svgDir = svgOutputPath ? path.dirname(path.resolve(svgOutputPath)) : path.resolve(".");
  const href   = path.relative(svgDir, absImgPath);
  return `    <image href="${href}" x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" preserveAspectRatio="xMidYMid meet" />`;
}

function makeSingleSVG({ w, h, label }, position, outputFilePath) {
  const canvasW  = w + PADDING * 2, canvasH = h + PADDING * 2 + LABEL_HEIGHT;
  const fontSize = `${canvasH / 100}mm`;
  const rectEl   = `    <rect class="shape" x="${PADDING}" y="${PADDING}" width="${w}" height="${h}" />`;
  const textEl   = `    <text class="label" x="${PADDING + w / 2}" y="${PADDING + h + 2}">${label}</text>`;
  const imgPath  = imageMap[position];
  const imgLayer = useImages
    ? `\n${layer("layer-images", "Images", imgPath
        ? imageEl(imgPath, PADDING, PADDING, w, h, outputFilePath)
        : `    <!-- no image for position ${position} -->`)}`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="${canvasW}mm" height="${canvasH}mm" viewBox="0 0 ${canvasW} ${canvasH}">
  <style>
    rect.shape { fill: #dbeafe; stroke: #000; stroke-width: 0.4; }
    text.label { font-family: monospace, sans-serif; font-size: ${fontSize}; fill: #000; text-anchor: middle; dominant-baseline: hanging; }
  </style>
${layer("layer-rects", "Rects", rectEl)}${imgLayer}
${layer("layer-labels", "Labels", textEl)}
</svg>
`;
}

function makeCombinedSVG(rects) {
  let x = PADDING; const y = PADDING;
  const positioned = rects.map((r, i) => { const pos = { ...r, x, y, position: i + 1 }; x += r.w + GAP; return pos; });
  const totalW = x - GAP + PADDING;
  const totalH = Math.max(...rects.map(r => r.h)) + PADDING * 2 + LABEL_HEIGHT;
  const fontSize = `${totalH / 100}mm`;
  const rectEls = positioned.map(({ x, y, w, h, label }) =>
    `    <!-- ${label} -->\n    <rect class="shape" x="${x}" y="${y}" width="${w}" height="${h}" />`).join("\n");
  const textEls = positioned.map(({ x, y, w, h, label }) =>
    `    <text class="label" x="${x + w / 2}" y="${y + h + 2}">${label}</text>`).join("\n");
  const imgEls = useImages ? positioned.map(({ x, y, w, h, position }) => {
    const imgPath = imageMap[position];
    return imgPath ? imageEl(imgPath, x, y, w, h, null) : `    <!-- no image for position ${position} -->`;
  }).join("\n") : null;
  const imgLayerBlock = imgEls != null ? `\n${layer("layer-images", "Images", imgEls)}` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="${totalW}mm" height="${totalH}mm" viewBox="0 0 ${totalW} ${totalH}">
  <style>
    rect.shape { fill: #dbeafe; stroke: #000; stroke-width: 0.4; }
    text.label { font-family: monospace, sans-serif; font-size: ${fontSize}; fill: #000; text-anchor: middle; dominant-baseline: hanging; }
  </style>
${layer("layer-rects", "Rects", rectEls)}${imgLayerBlock}
${layer("layer-labels", "Labels", textEls)}
</svg>
`;
}

if (explode) {
  rects.forEach((rect, i) => {
    const position = i + 1;
    const filename = path.join(pathPrefix, `${position}.${rect.orig}.svg`);
    fs.mkdirSync(pathPrefix, { recursive: true });
    fs.writeFileSync(filename, makeSingleSVG(rect, position, filename), "utf8");
    const imgNote = useImages ? (imageMap[position] ? ` [image: ${path.basename(imageMap[position])}]` : " [no image]") : "";
    console.error(`Written: ${filename}${imgNote}`);
  });
} else {
  process.stdout.write(makeCombinedSVG(rects));
}
