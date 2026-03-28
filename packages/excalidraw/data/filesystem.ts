import {
  fileOpen as _fileOpen,
  fileSave as _fileSave,
  supported as nativeFileSystemSupported,
} from "browser-fs-access";

import { IMAGE_MIME_TYPES, MIME_TYPES } from "@excalidraw/common";

import type { ValueOf } from "@excalidraw/common/utility-types";

import { getDataURL } from "./blob";

import { normalizeFile } from "./blob";

import type { BinaryFileData, BinaryFiles, DataURL } from "../types";

type FILE_EXTENSION = Exclude<keyof typeof MIME_TYPES, "binary">;

export const fileOpen = async <M extends boolean | undefined = false>(opts: {
  extensions?: FILE_EXTENSION[];
  description: string;
  multiple?: M;
}): Promise<M extends false | undefined ? File : File[]> => {
  // an unsafe TS hack, alas not much we can do AFAIK
  type RetType = M extends false | undefined ? File : File[];

  const mimeTypes = opts.extensions?.reduce((mimeTypes, type) => {
    mimeTypes.push(MIME_TYPES[type]);

    return mimeTypes;
  }, [] as string[]);

  const extensions = opts.extensions?.reduce((acc, ext) => {
    if (ext === "jpg") {
      return acc.concat(".jpg", ".jpeg");
    }
    return acc.concat(`.${ext}`);
  }, [] as string[]);

  const files = await _fileOpen({
    description: opts.description,
    extensions,
    mimeTypes,
    multiple: opts.multiple ?? false,
  });

  if (Array.isArray(files)) {
    return (await Promise.all(
      files.map((file) => normalizeFile(file)),
    )) as RetType;
  }
  return (await normalizeFile(files)) as RetType;
};

export const fileSave = (
  blob: Blob | Promise<Blob>,
  opts: {
    /** supply without the extension */
    name: string;
    /** file extension */
    extension: FILE_EXTENSION;
    mimeTypes?: string[];
    description: string;
    /** existing FileSystemFileHandle */
    fileHandle?: FileSystemFileHandle | null;
  },
) => {
  return _fileSave(
    blob,
    {
      fileName: `${opts.name}.${opts.extension}`,
      description: opts.description,
      extensions: [`.${opts.extension}`],
      mimeTypes: opts.mimeTypes,
    },
    opts.fileHandle,
    false,
  );
};

export { nativeFileSystemSupported };

// ---------------------------------------------------------------------------
// Directory-based .excalidraw format
// ---------------------------------------------------------------------------

const mimeToExt: Record<string, string> = {};
for (const [ext, mime] of Object.entries(IMAGE_MIME_TYPES)) {
  mimeToExt[mime] = ext;
}
mimeToExt[MIME_TYPES.binary] = "bin";

/**
 * Open a .excalidraw directory via showDirectoryPicker.
 * Reads scene.json and resolves asset paths into BinaryFileData with dataURLs.
 */
export const openExcalidrawDirectory = async (): Promise<{
  sceneJSON: string;
  files: BinaryFiles;
  directoryHandle: FileSystemDirectoryHandle;
}> => {
  const directoryHandle = await (window as any).showDirectoryPicker({
    id: "excalidraw-open",
  });

  // Read scene.json
  const sceneFileHandle = await directoryHandle.getFileHandle("scene.json");
  const sceneFile = await sceneFileHandle.getFile();
  const sceneJSON = await sceneFile.text();

  // Parse to find file references with paths
  const parsed = JSON.parse(sceneJSON);
  const files: BinaryFiles = {};

  if (parsed.files) {
    let assetsDir: FileSystemDirectoryHandle | null = null;
    try {
      assetsDir = await directoryHandle.getDirectoryHandle("assets");
    } catch {
      // no assets directory — that's fine if there are no path-based refs
    }

    for (const [id, fileData] of Object.entries(
      parsed.files as Record<string, any>,
    )) {
      if (fileData.path && assetsDir) {
        // Path-based reference — read the asset file and convert to dataURL
        const assetFileName = fileData.path.replace(/^assets\//, "");
        const assetFileHandle = await assetsDir.getFileHandle(assetFileName);
        const assetFile = await assetFileHandle.getFile();
        const dataURL = await getDataURL(assetFile);
        files[id] = {
          mimeType: fileData.mimeType,
          id: fileData.id,
          dataURL,
          created: fileData.created,
          lastRetrieved: Date.now(),
        } as BinaryFileData;
      } else if (fileData.dataURL) {
        // Inline dataURL — use as-is
        files[id] = fileData as BinaryFileData;
      }
    }
  }

  // Return scene JSON with files stripped (they're resolved separately)
  return { sceneJSON, files, directoryHandle };
};

/**
 * Save scene + assets to a .excalidraw directory.
 * Writes scene.json (with path refs instead of dataURLs) and assets/ files.
 */
export const saveToExcalidrawDirectory = async (opts: {
  sceneJSON: string;
  files: BinaryFiles;
  directoryHandle?: FileSystemDirectoryHandle | null;
  name: string;
}): Promise<{ directoryHandle: FileSystemDirectoryHandle }> => {
  let directoryHandle = opts.directoryHandle;

  if (!directoryHandle) {
    directoryHandle = await (window as any).showDirectoryPicker({
      id: "excalidraw-save",
      mode: "readwrite",
      startIn: "documents",
    });
  }

  // Request write permission if needed
  const perm = await (directoryHandle as any).requestPermission({
    mode: "readwrite",
  });
  if (perm !== "granted") {
    throw new Error("Write permission denied for directory");
  }

  const parsed = JSON.parse(opts.sceneJSON);
  const assetsDir = await directoryHandle!.getDirectoryHandle("assets", {
    create: true,
  });

  // Write each binary file to assets/ and replace dataURL with path
  const filesWithPaths: Record<string, any> = {};

  if (parsed.files) {
    for (const [id, fileData] of Object.entries(
      parsed.files as Record<string, BinaryFileData>,
    )) {
      const ext =
        mimeToExt[fileData.mimeType as string] ||
        mimeToExt[MIME_TYPES.binary];
      const assetFileName = `${fileData.id}.${ext}`;

      // Decode dataURL to binary and write to asset file
      const dataURL = fileData.dataURL as string;
      const dataIndexStart = dataURL.indexOf(",");
      const byteString = atob(dataURL.slice(dataIndexStart + 1));
      const mimeType = dataURL.slice(0, dataIndexStart).split(":")[1].split(";")[0];

      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }

      const assetFileHandle = await assetsDir.getFileHandle(assetFileName, {
        create: true,
      });
      const writable = await (assetFileHandle as any).createWritable();
      await writable.write(new Blob([ab], { type: mimeType }));
      await writable.close();

      filesWithPaths[id] = {
        mimeType: fileData.mimeType,
        id: fileData.id,
        path: `assets/${assetFileName}`,
        created: fileData.created,
      };
    }
  }

  // Write scene.json with path references instead of dataURLs
  parsed.files = filesWithPaths;
  const sceneFileHandle = await directoryHandle!.getFileHandle("scene.json", {
    create: true,
  });
  const writable = await (sceneFileHandle as any).createWritable();
  await writable.write(
    new Blob([JSON.stringify(parsed, null, 2)], { type: MIME_TYPES.json }),
  );
  await writable.close();

  return { directoryHandle: directoryHandle! };
};
