import path from 'path';

function parseArguments() {
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

  return {
   offset,      
   padding,     
   cwd,         
   explode,     
   explodePath, 
   useImages,       
   useImagesAbsPath,
   imagesScaling,   
   rects,
  }
}

export default parseArguments;
