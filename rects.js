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
import parseArguments from './parse-args.js';
import { findImages, readImageSize, } from './images.js';

const {
  padding,     
  explode,     
  explodePath, 
  useImages,       
  useImagesAbsPath,
  imagesScaling,   
  rects,
} = parseArguments();

const GAP = 14;

const imageMap = useImages ? findImages(process.cwd()) : {};

// Inkscape-compatible layer group
const layer = (id, lbl, content) =>
  `  <g id="${id}" inkscape:label="${lbl}" inkscape:groupmode="layer">\n${content}\n  </g>`;

function imageSvg(absImgPath, rectX, rectY, rectW, rectH, svgOutputPath = null, clipId = null) {
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

  const { scaledW, scaledH } = computeImageScaledDimensions(imgW, imgH, rectW, rectH,);
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
  const canvasH  = h + padding * 2;
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

  const rectsLayer = layer("layer-rects",  "Rects",  rectEl);
  const labelsLayer = layer("layer-labels", "Labels", textEl);
  
  return renderSvg(canvasW, canvasH, fontSize, rectsLayer, imgLayer, labelsLayer)
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
  const totalH   = Math.max(...rects.map(r => r.h)) + padding * 2;
  const fontSize = `${totalH / 100}mm`;

  const rectEls = positioned
    .map(rectSvg)
    .join("\n");

  const textEls = positioned
    .map(r => labelSvg(r, totalH))
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
  const rectsLayer = layer("layer-rects",  "Rects",  rectEls);
  const labelsLayer = layer("layer-labels", "Labels", textEls);
  
  return renderSvg(totalW, totalH, fontSize, rectsLayer, imgLayerBlock, labelsLayer)
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
    return imageSvg(
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

  ${imageSvg(
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

function labelSvg({ x, y, w, h, label }, totalH) {
  return `    <text class="label" x="${x + w / 2}" y="${y + h + 2 * totalH / 100}">${label}</text>`;
}

function computeImageScaledDimensions(
  imgW, imgH,
  rectW, rectH,
) {
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

  return { scaledW, scaledH };
}

function renderSvg(canvasW, canvasH, fontSize, rectsLayer, imgLayerBlock, labelsLayer) {

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

${rectsLayer}${imgLayerBlock}
${labelsLayer}

</svg>
`;

}
