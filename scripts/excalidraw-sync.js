#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Bidirectional sync between a .excalidraw file and an exploded directory.
 *
 * Usage:
 *   node scripts/excalidraw-sync.js <file.excalidraw> [dir]
 *
 * Watches both the .excalidraw file and the exploded directory (scene.json + assets/).
 * When either side changes, syncs to the other.
 *
 * Default directory: <file>.d/  (e.g. drawing.excalidraw → drawing.excalidraw.d/)
 */

const fs = require("fs");
const path = require("path");

const MIME_TO_EXT = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "image/avif": "avif",
  "image/jfif": "jfif",
  "application/octet-stream": "bin",
};

const EXT_TO_MIME = {};
for (const [mime, ext] of Object.entries(MIME_TO_EXT)) {
  EXT_TO_MIME[ext] = mime;
}
EXT_TO_MIME.jpeg = "image/jpeg";

// --- Conversion functions ---

function explode(inputFile, outputDir) {
  const raw = fs.readFileSync(inputFile, "utf-8");
  const data = JSON.parse(raw);

  fs.mkdirSync(path.join(outputDir, "assets"), { recursive: true });

  const filesWithPaths = {};

  if (data.files) {
    for (const [id, fileData] of Object.entries(data.files)) {
      const ext = MIME_TO_EXT[fileData.mimeType] || "bin";
      const assetFileName = `${fileData.id}.${ext}`;
      const assetPath = path.join(outputDir, "assets", assetFileName);

      const dataURL = fileData.dataURL;
      const commaIndex = dataURL.indexOf(",");
      const base64Data = dataURL.slice(commaIndex + 1);
      fs.writeFileSync(assetPath, Buffer.from(base64Data, "base64"));

      filesWithPaths[id] = {
        mimeType: fileData.mimeType,
        id: fileData.id,
        path: `assets/${assetFileName}`,
        created: fileData.created,
      };
    }
  }

  data.files = filesWithPaths;
  fs.writeFileSync(
    path.join(outputDir, "scene.json"),
    JSON.stringify(data, null, 2),
  );
}

function pack(inputDir, outputFile) {
  const sceneFile = path.join(inputDir, "scene.json");
  const raw = fs.readFileSync(sceneFile, "utf-8");
  const data = JSON.parse(raw);

  const filesWithDataURLs = {};

  if (data.files) {
    for (const [id, fileData] of Object.entries(data.files)) {
      if (fileData.path) {
        const assetPath = path.join(inputDir, fileData.path);
        if (!fs.existsSync(assetPath)) {
          console.warn(`  warning: asset not found: ${assetPath}`);
          continue;
        }
        const binary = fs.readFileSync(assetPath);
        const base64 = binary.toString("base64");
        const mimeType =
          fileData.mimeType ||
          EXT_TO_MIME[path.extname(assetPath).slice(1)] ||
          "application/octet-stream";

        filesWithDataURLs[id] = {
          mimeType,
          id: fileData.id,
          dataURL: `data:${mimeType};base64,${base64}`,
          created: fileData.created || Date.now(),
        };
      } else if (fileData.dataURL) {
        filesWithDataURLs[id] = fileData;
      }
    }
  }

  data.files = filesWithDataURLs;
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
}

// --- Sync logic ---

function getMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function getDirMtime(dirPath) {
  let latest = 0;
  try {
    const sceneTime = getMtime(path.join(dirPath, "scene.json"));
    latest = Math.max(latest, sceneTime);

    const assetsDir = path.join(dirPath, "assets");
    if (fs.existsSync(assetsDir)) {
      for (const f of fs.readdirSync(assetsDir)) {
        latest = Math.max(latest, getMtime(path.join(assetsDir, f)));
      }
    }
  } catch {
    // directory may not exist yet
  }
  return latest;
}

// --- Main ---

const [, , excalidrawFile, dirArg] = process.argv;

if (!excalidrawFile) {
  console.log(`Usage: node scripts/excalidraw-sync.js <file.excalidraw> [dir]`);
  process.exit(1);
}

const excalidrawPath = path.resolve(excalidrawFile);
const dirPath = path.resolve(
  dirArg || excalidrawFile.replace(/\.excalidraw$/, ".excalidraw.d"),
);

console.log(`Syncing:`);
console.log(`  file: ${excalidrawPath}`);
console.log(`  dir:  ${dirPath}/`);
console.log();

// Initial sync: if file exists but dir doesn't, explode. Vice versa.
if (
  fs.existsSync(excalidrawPath) &&
  !fs.existsSync(path.join(dirPath, "scene.json"))
) {
  console.log(`Initial explode: file → dir`);
  explode(excalidrawPath, dirPath);
} else if (
  fs.existsSync(path.join(dirPath, "scene.json")) &&
  !fs.existsSync(excalidrawPath)
) {
  console.log(`Initial pack: dir → file`);
  pack(dirPath, excalidrawPath);
}

let lastFileMtime = getMtime(excalidrawPath);
let lastDirMtime = getDirMtime(dirPath);
let syncing = false;

const POLL_MS = 500;

setInterval(() => {
  if (syncing) {
    return;
  }

  const fileMtime = getMtime(excalidrawPath);
  const dirMtime = getDirMtime(dirPath);

  if (fileMtime > lastFileMtime) {
    syncing = true;
    console.log(
      `[${new Date().toLocaleTimeString()}] file changed → exploding to dir`,
    );
    try {
      explode(excalidrawPath, dirPath);
      lastFileMtime = fileMtime;
      lastDirMtime = getDirMtime(dirPath);
    } catch (err) {
      console.error(`  error: ${err.message}`);
    }
    syncing = false;
  } else if (dirMtime > lastDirMtime) {
    syncing = true;
    console.log(
      `[${new Date().toLocaleTimeString()}] dir changed → packing to file`,
    );
    try {
      pack(dirPath, excalidrawPath);
      lastDirMtime = dirMtime;
      lastFileMtime = getMtime(excalidrawPath);
    } catch (err) {
      console.error(`  error: ${err.message}`);
    }
    syncing = false;
  }
}, POLL_MS);

console.log(`Watching for changes (poll every ${POLL_MS}ms)...`);
