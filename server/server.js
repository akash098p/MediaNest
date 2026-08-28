"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");

const { runFfmpeg, isAvailable, probeMedia } = require("./lib/ffmpeg");
const { getById, publicList } = require("./tools");

const app = express();
const PORT = process.env.PORT || 4000;

// Root of the whole project (serves the main MediaNest editor too).
const ROOT = path.resolve(__dirname, "..");

// Temporary staging area for uploaded inputs + outputs.
const TMP = path.join(os.tmpdir(), "medianest-tools");
fs.mkdirSync(TMP, { recursive: true });

// ------------------------------------------------------------------
// Multer: store uploads to disk with random filenames.
// ------------------------------------------------------------------
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || "";
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB
});

// ------------------------------------------------------------------
// Static serving
// ------------------------------------------------------------------
app.use(express.static(ROOT)); // index.html + js/css/assets + tools/

// ------------------------------------------------------------------
// Routes
// ------------------------------------------------------------------
app.get("/api/tools", (req, res) => {
  res.json({ tools: publicList() });
});

app.get("/api/health", async (req, res) => {
  const ok = await isAvailable();
  res.json({ ok, ffmpeg: process.env.FFMPEG_PATH || "ffmpeg" });
});

app.post("/api/tools/:id", upload.any(), async (req, res) => {
  const tool = getById(req.params.id);
  if (!tool) {
    cleanupAll(req.files || [], null);
    return res.status(404).json({ error: "Unknown tool id." });
  }

  const files = req.files || [];
  const params = req.body || {};

  // ---- Build the ctx helper exposed to each tool's build() ----
  const fileMap = new Map();
  for (const f of files) {
    if (!fileMap.has(f.fieldname)) fileMap.set(f.fieldname, []);
    fileMap.get(f.fieldname).push(f);
  }
  const ctx = {
    rawFiles: files,
    params,
    duration: 0,
    file(name) {
      const list = fileMap.get(name);
      const f = list && list[0];
      if (!f) throw new Error(`Missing required file field: "${name}"`);
      return f.path;
    },
    files(name) {
      const list = fileMap.get(name) || [];
      return list.map((f) => ({ path: f.path, name: f.originalname }));
    },
    upload(name) {
      const list = fileMap.get(name) || [];
      return list.map((f) => ({ path: f.path, name: f.originalname }));
    },
    param(name) {
      const v = params[name];
      return Array.isArray(v) ? v[0] : v;
    },
  };

  // Probe the primary input once so tools can MIRROR the source bitrate
  // (prevents the "800 KB became 3.5 MB" problem on convert/compress).
  ctx.media = {};
  try {
    const primaryName =
      tool.inputs && tool.inputs[0] ? tool.inputs[0].name : null;
    const primaryList = primaryName
      ? fileMap.get(primaryName) || []
      : [];
    const primary = primaryList[0] || files[0];
    if (primary) ctx.media = await probeMedia(primary.path);
  } catch (e) {
    ctx.media = {};
  }

  // For tools that need to know the input duration (e.g. fade-out).
  if (tool.needDuration && !ctx.duration) {
    ctx.duration = ctx.media?.duration || 0;
  }

  let spec;
  try {
    spec = tool.build(ctx);
  } catch (err) {
    cleanupAll(files, null);
    return res.status(400).json({ error: err.message || "Invalid request." });
  }

  if (!spec) {
    cleanupAll(files, null);
    return res.status(400).json({ error: "Tool produced no command." });
  }

  // Multi-output path: tool returns { outputs: [{ name, args, ext }] }.
  // Run every entry, ZIP the results, stream back as one download.
  if (Array.isArray(spec.outputs) && spec.outputs.length) {
    return runMultiOutput(req, res, tool, files, spec);
  }

  if (!Array.isArray(spec.args)) {
    cleanupAll(files, null);
    return res.status(400).json({ error: "Tool produced no command." });
  }

  const ext = (spec.ext || tool.defaultExt || "mp4").replace(/^\./, "");
  const outName = `${crypto.randomUUID()}.${ext}`;
  const outPath = path.join(TMP, outName);

  let processed;
  try {
    processed = await runFfmpeg([...spec.args, outPath], { timeoutMs: 0 });
  } catch (err) {
    cleanupAll(files, outPath);
    return res.status(500).json({ error: err.message });
  }

  // Hand the finished file back to the client.
  res.download(outPath, downloadFileName(files, tool, ext), (err) => {
    cleanupAll(files, outPath);
    if (err && !res.headersSent) {
      res.status(500).send("Download failed.");
    }
  });
});

function downloadFileName(files, tool, ext) {
  const first = files.find((f) => f.originalname && !f.originalname.startsWith("."));
  const base = first ? first.originalname.replace(/\.[^.]+$/, "") : tool.id;
  return `${base}-${tool.id}.${ext}`;
}

/**
 * Multi-output pipeline: run every entry in `spec.outputs`, then ZIP the
 * results together and stream the archive to the client.  Cleans up
 * everything on both success and failure paths.
 */
async function runMultiOutput(req, res, tool, files, spec) {
  const outputs = spec.outputs;
  const tmpOutputs = []; // { name, path, ext }
  try {
    for (let i = 0; i < outputs.length; i++) {
      const o = outputs[i] || {};
      if (!Array.isArray(o.args)) {
        throw new Error(`Output #${i + 1} has no ffmpeg args.`);
      }
      const ext = (o.ext || spec.ext || tool.defaultExt || "out").replace(/^\./, "");
      const outName = `${crypto.randomUUID()}.${ext}`;
      const outPath = path.join(TMP, outName);
      tmpOutputs.push({
        name: o.name || `${tool.id}-${i + 1}.${ext}`,
        path: outPath,
        ext,
      });
      await runFfmpeg([...o.args, outPath], { timeoutMs: 0 });
    }
  } catch (err) {
    for (const t of tmpOutputs) safeUnlink(t.path);
    cleanupAll(files, null);
    return res.status(500).json({ error: err.message });
  }

  let zipBuf;
  try {
    zipBuf = buildServerZip(tmpOutputs);
  } catch (err) {
    for (const t of tmpOutputs) safeUnlink(t.path);
    cleanupAll(files, null);
    return res.status(500).json({ error: `ZIP failed: ${err.message}` });
  }

  const zipName = `${tool.id}-bundle.zip`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
  res.setHeader("Content-Length", zipBuf.length);
  res.end(zipBuf, () => {
    for (const t of tmpOutputs) safeUnlink(t.path);
    cleanupAll(files, null);
  });
}

function safeUnlink(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
}

/**
 * Build a stored (no-compression) ZIP archive from a list of file entries
 * already on disk.  Returns a Buffer.  Self-contained so server.js has no
 * new runtime deps.
 */
function buildServerZip(entries) {
  const localParts = [];
  const central = [];
  let offset = 0;
  const encoder = (s) => Buffer.from(s, "utf8");
  for (const e of entries) {
    const data = fs.readFileSync(e.path);
    let name = path.basename(e.name || e.path);
    if (!name) name = "file";
    const nameBuf = encoder(name);
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    localParts.push(Buffer.concat([lh, nameBuf, data]));

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));

    offset += lh.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralBuf, eocd]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function cleanupAll(files, outPath) {
  try {
    for (const f of files || []) {
      if (f && f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
    }
    if (outPath && fs.existsSync(outPath)) fs.unlinkSync(outPath);
  } catch (e) {
    /* ignore */
  }
}

// ------------------------------------------------------------------
// Startup
// ------------------------------------------------------------------
app.listen(PORT, async () => {
  const ok = await isAvailable();
  console.log(`🎛️  MediaNest Tools server running at http://localhost:${PORT}`);
  console.log(`  → Tools home:      http://localhost:${PORT}/tools/index.html`);
  console.log(`  → Main editor:     http://localhost:${PORT}/index.html`);
  if (!ok) {
    console.warn(
      "  ⚠  FFmpeg was not detected. Install FFmpeg or set FFMPEG_PATH.",
    );
  } else {
    console.log("  ✅ FFmpeg detected.");
  }
});
