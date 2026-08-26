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

  if (!spec || !Array.isArray(spec.args)) {
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
