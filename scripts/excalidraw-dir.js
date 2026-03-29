#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Convert between .excalidraw (single JSON file) and exploded directory format.
 *
 * Usage:
 *   node scripts/excalidraw-dir.js explode  drawing.excalidraw  [output-dir]
 *   node scripts/excalidraw-dir.js pack     drawing.excalidraw/  [output-file]
 *
 * explode: single .excalidraw → directory with scene.json + assets/
 * pack:    directory with scene.json + assets/ → single .excalidraw
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

function explode(inputFile, outputDir) {
  const raw = fs.readFileSync(inputFile, "utf-8");
  const data = JSON.parse(raw);

  if (!outputDir) {
    outputDir = inputFile.replace(/\.excalidraw$/, ".excalidraw.d");
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const assetsDir = path.join(outputDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  const filesWithPaths = {};

  if (data.files) {
    for (const [id, fileData] of Object.entries(data.files)) {
      const ext = MIME_TO_EXT[fileData.mimeType] || "bin";
      const assetFileName = `${fileData.id}.${ext}`;
      const assetPath = path.join(assetsDir, assetFileName);

      // Decode dataURL to binary
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

  const assetCount = Object.keys(filesWithPaths).length;
  console.log(
    `Exploded ${inputFile} → ${outputDir}/ (${assetCount} asset${
      assetCount !== 1 ? "s" : ""
    })`,
  );
}

function pack(inputDir, outputFile) {
  const sceneFile = path.join(inputDir, "scene.json");
  if (!fs.existsSync(sceneFile)) {
    console.error(`Error: ${sceneFile} not found`);
    process.exit(1);
  }

  const raw = fs.readFileSync(sceneFile, "utf-8");
  const data = JSON.parse(raw);

  if (!outputFile) {
    outputFile = `${inputDir
      .replace(/\/?$/, "")
      .replace(/\.d$/, "")}.excalidraw`;
    if (outputFile === `${inputDir}.excalidraw`) {
      outputFile = `${inputDir.replace(/\/?$/, "")}.packed.excalidraw`;
    }
  }

  const filesWithDataURLs = {};

  if (data.files) {
    for (const [id, fileData] of Object.entries(data.files)) {
      if (fileData.path) {
        const assetPath = path.join(inputDir, fileData.path);
        if (!fs.existsSync(assetPath)) {
          console.error(`Warning: asset not found: ${assetPath}`);
          continue;
        }
        const binary = fs.readFileSync(assetPath);
        const base64 = binary.toString("base64");
        const mimeType =
          fileData.mimeType ||
          EXT_TO_MIME[path.extname(assetPath).slice(1)] ||
          "application/octet-stream";
        const dataURL = `data:${mimeType};base64,${base64}`;

        filesWithDataURLs[id] = {
          mimeType,
          id: fileData.id,
          dataURL,
          created: fileData.created || Date.now(),
        };
      } else if (fileData.dataURL) {
        filesWithDataURLs[id] = fileData;
      }
    }
  }

  data.files = filesWithDataURLs;
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));

  const assetCount = Object.keys(filesWithDataURLs).length;
  console.log(
    `Packed ${inputDir}/ → ${outputFile} (${assetCount} asset${
      assetCount !== 1 ? "s" : ""
    })`,
  );
}

// CLI
const [, , command, input, output] = process.argv;

if (!command || !input) {
  console.log(`Usage:
  node scripts/excalidraw-dir.js explode <file.excalidraw> [output-dir]
  node scripts/excalidraw-dir.js pack    <dir/>             [output-file]`);
  process.exit(1);
}

switch (command) {
  case "explode":
    explode(input, output);
    break;
  case "pack":
    pack(input, output);
    break;
  default:
    console.error(`Unknown command: ${command}. Use "explode" or "pack".`);
    process.exit(1);
}
