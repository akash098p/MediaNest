"use strict";

/* MediaNest Tools — shared client logic for both the index and tool pages. */

const API = "/api/tools";

function $(sel, root = document) { return root.querySelector(sel); }
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.appendChild(c);
  return node;
}

async function fetchTools() {
  const res = await fetch(API);
  if (!res.ok) throw new Error("Could not load tools from the server.");
  const data = await res.json();
  return data.tools || [];
}

/* ------------------------------------------------------------------ */
/* Tool page                                                          */
/* ------------------------------------------------------------------ */
let toolMeta = null;
let lastBlobUrl = null;


/* ------------------------------------------------------------------ */
/* Batch mode + drag-&-drop uploads (auto-detected per tool)           */
/*                                                                     */
/* A tool runs in BATCH mode when one non-multiple upload alone drives */
/* its output (converter, compressor, trimmer, extractor…): files are  */
/* processed one-by-one, each downloadable alone or bundled into a ZIP. */
/* Combination tools (merge / mix / pair image+audio …) get drag-&-drop */
/* file lists feeding the classic single-request submit. All local.     */
/* ------------------------------------------------------------------ */

/** "12.4 MB" style formatter. */
function fmtBytes(n) {
  if (!Number.isFinite(n)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 || u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

/** Strip the extension + characters Windows forbids in file names. */
function safeBase(name) {
  const base = String(name || "").replace(/\.[^.]+$/, "");
  return base.replace(/[\\/:*?"<>|]+/g, "_").trim() || "audio";
}

/** Guarantee unique download names inside the result list / archive. */
function uniqueName(name, taken) {
  if (!taken.has(name.toLowerCase())) {
    taken.add(name.toLowerCase());
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 2;
  let candidate;
  do {
    candidate = `${stem} (${i})${ext}`;
    i++;
  } while (taken.has(candidate.toLowerCase()));
  taken.add(candidate.toLowerCase());
  return candidate;
}

function buildField(f) {
  const field = el("div", { class: "field" });
  field.appendChild(el("label", { text: f.label }));

  if (f.type === "select") {
    const select = el("select", { name: f.name });
    for (const opt of f.options || []) {
      const optEl = el("option", { value: opt, text: opt });
      if (f.default === opt) optEl.selected = true;
      select.appendChild(optEl);
    }
    field.appendChild(select);
  } else if (f.type === "number") {
    field.appendChild(
      el("input", {
        type: "number",
        name: f.name,
        value: f.default ?? "",
        min: f.min, max: f.max, step: f.step,
      }),
    );
  } else if (f.type === "range") {
    const row = el("div", { class: "range-row" });
    const input = el("input", {
      type: "range",
      name: f.name,
      value: f.default ?? 0,
      min: f.min, max: f.max, step: f.step,
    });
    const out = el("output", { text: f.default ?? "" });
    input.addEventListener("input", () => (out.textContent = input.value));
    row.append(input, out);
    field.appendChild(row);
  } else {
    field.appendChild(el("input", { type: "text", name: f.name, value: f.default ?? "" }));
  }
  return field;
}

/* ------------------------------------------------------------------ */
/* Upload engine — every tool gets drag & drop                        */
/*                                                                    */
/* Batch mode  : one non-multiple upload alone drives the output      */
/*               (converters, compressors, trimmers, extractors…)     */
/*               Files run one-by-one; each downloads individually    */
/*               or together as a ZIP.                                */
/* Combine mode: merge/mix/pair tools get the same file lists,        */
/*               feeding the classic single-request submit.           */
/* ------------------------------------------------------------------ */

let resultItems = []; // { name, blob, url, err } — batch outputs
let zipBusy = false;
let lastFormatUsed = "";
let busyProcessing = false;

/** Batch vs combine decision, straight from the registry entry. */
function uploadMode() {
  if (!toolMeta) return false;
  const ins = toolMeta.inputs || [];
  if (ins.length !== 1) return false;
  return !ins[0].multiple;
}
const workVerbCap = () => "Convert";

/** Media-kind guess straight from an input's accept string. */
function kindFor(accept) {
  const a = String(accept || "").toLowerCase();
  if (a.includes("video")) return "video";
  if (a.includes("audio")) return "audio";
  if (a.includes("image") || a.includes("gif")) return "image";
  return "media";
}

const KIND_META = {
  video: { icon: "🎬", label: "video" },
  audio: { icon: "🔊", label: "audio" },
  image: { icon: "🖼️", label: "image" },
  media: { icon: "📁", label: "file" },
};

function fileKind(f) {
  const t = f.type ? String(f.type).split("/")[0].toLowerCase() : "";
  if (t) return t;
  return /\.gif$/i.test(f.name) ? "image" : "media";
}

/** Icon representing the OUTPUT of the current tool. */
function outputIcon() {
  const m = toolMeta || {};
  const ext = String(m.defaultExt || "").toLowerCase();
  const imageExts = ["gif", "png", "jpg", "jpeg", "webp"];
  const videoExts = ["mp4", "webm", "mov", "mkv", "avi"];
  let kind = "audio";
  if (imageExts.includes(ext)) kind = "image";
  else if (videoExts.includes(ext)) kind = "video";
  else if (/gif|to-video/i.test(`${m.id || ""} ${m.name || ""}`)) kind = "image";
  else if (m.group === "Video") kind = "video";
  return KIND_META[kind].icon;
}

/* ------------------------------------------------------------------ */
/* Drag & drop uploader                                               */
/* ------------------------------------------------------------------ */

function isAcceptableFile(file, accept, slotKind) {
  // Kind match is the primary gate (dropping a video into an audio slot
  // should be rejected, not crash the server).
  const fk = fileKind(file);
  if (fk === slotKind) return true;
  if (slotKind === "media") return true;
  if (slotKind === "image" && /\.gif$/i.test(file.name)) return true;

  const rules = String(accept || "").split(",");
  function ruleMatch(r) {
    r = r.trim().toLowerCase();
    if (!r) return false;
    if (r.endsWith("/*")) return fk === r.slice(0, -2); // MIME group, e.g. audio/*
    return file.name.toLowerCase().endsWith(r.charAt(0) === "." ? r : `.${r}`);
  }
  // Files with a real MIME type follow the accept rules.
  if (fk !== "media") return rules.some(ruleMatch);
  // No usable MIME type (fk === "media") — judge by explicit extensions only,
  // since a bare "audio/*" group can't vouch for an untyped file.
  return rules.some((r) => {
    r = r.trim().toLowerCase();
    return r.startsWith(".") && file.name.toLowerCase().endsWith(r);
  });
}

const uploadGroups = {}; // input name -> [{ id, file, status, msg, outSize, outName }]
const uploadRefreshers = {}; // input name -> fn() re-rendering that queue
let uploadUid = 0;

function filesFor(name) {
  uploadGroups[name] = uploadGroups[name] || [];
  return uploadGroups[name];
}

function syncHiddenInput(hiddenInput, items) {
  // Native FileList objects are immutable — swap through DataTransfer.
  try {
    const dt = new DataTransfer();
    for (const it of items) dt.items.add(it.file);
    hiddenInput.files = dt.files;
  } catch (e) {
    /* older browsers: input stays empty; we read our array instead */
  }
}

function setRowState(item, status, msg) {
  item.status = status; // ready | working | done | err
  item.msg = msg || "";
}

function renderUploadList(listEl, hiddenInput, name, accept) {
  const items = filesFor(name);
  syncHiddenInput(hiddenInput, items);
  if (!items.length) {
    listEl.replaceChildren();
    return;
  }

  const totalBytes = items.reduce((s, it) => s + (it.file.size || 0), 0);
  const head = el("div", { class: "queue-head" }, [
    el("span", {
      class: "queue-count",
      text: `${items.length} file${items.length > 1 ? "s" : ""} · ${fmtBytes(totalBytes)}${
        items.some((it) => it.status === "done")
          ? ` · ${items.filter((it) => it.status === "done").length} done`
          : ""
      }`,
    }),
    el("button", {
      type: "button",
      class: "link-danger",
      text: "Remove all",
      onclick: () => {
        if (busyProcessing) return;
        filesFor(name).length = 0;
        uploadRefreshers[name] && uploadRefreshers[name]();
      },
    }),
  ]);

  const rows = items.map((item) => {
    const cls =
      item.status === "done" ? "st-done" :
      item.status === "working" ? "st-work" :
      item.status === "err" ? "st-err" : "st-ready";
    const txt =
      item.status === "done" ? `✔ ${fmtBytes(item.outSize)}` :
      item.status === "working" ? "⏳ Converting…" :
      item.status === "err" ? `✖ ${item.msg || "failed"}` :
      fmtBytes(item.file.size);

    return el("div", { class: "f-row" }, [
      el("span", {
        class: "f-icon",
        text: (KIND_META[fileKind(item.file)] || KIND_META.media).icon,
      }),
      el("div", { class: "f-meta" }, [
        el("div", { class: "f-name", title: item.file.name, text: item.file.name }),
        el("div", { class: "f-size", text: item.outName || "" }),
      ]),
      el("span", { class: `f-status ${cls}`, title: item.msg || "", text: txt }),
      el("button", {
        type: "button",
        class: "remove-btn",
        title: "Remove",
        "aria-label": `Remove ${item.file.name}`,
        onclick: () => {
          if (busyProcessing) return;
          const arr = filesFor(name);
          arr.splice(arr.indexOf(item), 1);
          uploadRefreshers[name] && uploadRefreshers[name]();
        },
      }),
    ]);
  });

  listEl.replaceChildren(head, ...rows);
}

function buildUploader(def) {
  const slotKind = kindFor(def.accept);
  const kmeta = KIND_META[slotKind];
  const plural = !!def.multiple;
  const noun = plural ? `${kmeta.label} files` : kmeta.label;

  const field = el("div", { class: "field" });
  field.appendChild(el("label", { text: def.label }));

  const hiddenInput = el("input", {
    type: "file",
    name: def.name,
    accept: def.accept || "*",
    multiple: "",
  });
  hiddenInput.style.display = "none";

  const dz = el("div", {
    class: "uploader",
    tabindex: "0",
    role: "button",
    "aria-label": `Add ${noun}`,
  }, [
    el("div", { class: "dz-icon", text: `${kmeta.icon}⬆️` }),
    el("div", { class: "dz-main", text: `Drag & drop ${noun} here` }),
    el("div", {
      class: "dz-sub",
      html: `or <u>browse your computer</u>${plural ? " — add as many as you like" : ""}`,
    }),
  ]);

  const listEl = el("div", { class: "upload-list" });

  const openPicker = () => {
    if (!busyProcessing) hiddenInput.click();
  };
  dz.addEventListener("click", openPicker);
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  });

  const ingest = (fileList) => {
    if (busyProcessing || !fileList || !fileList.length) return;
    const items = filesFor(def.name);
    const seen = new Set(items.map((it) => `${it.file.name}::${it.file.size}`));
    let added = 0;
    let skipped = 0;
    for (const f of fileList) {
      if (!isAcceptableFile(f, def.accept, slotKind)) {
        skipped++;
        continue;
      }
      const key = `${f.name}::${f.size}`;
      if (seen.has(key)) continue; // ignore duplicates already queued
      seen.add(key);
      items.push({
        id: ++uploadUid,
        file: f,
        status: "ready",
        msg: "",
        outSize: 0,
        outName: "",
      });
      added++;
    }
    uploadRefreshers[def.name] &&
      uploadRefreshers[def.name]();
    if (skipped) {
      setStatus(
        `⚠ Skipped ${skipped} unsupported file${skipped > 1 ? "s" : ""} — "${def.label}" accepts ${noun}.`,
      );
    } else if (added) {
      setStatus(`${added} file${added > 1 ? "s" : ""} added to the queue.`);
    }
  };

  hiddenInput.addEventListener("change", () => ingest(hiddenInput.files));

  ["dragenter", "dragover"].forEach((evt) =>
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!busyProcessing) dz.classList.add("dragover");
    }),
  );
  ["dragleave", "drop"].forEach((evt) =>
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove("dragover");
    }),
  );
  dz.addEventListener("drop", (e) =>
    ingest(e.dataTransfer && e.dataTransfer.files),
  );

  uploadRefreshers[def.name] = () =>
    renderUploadList(listEl, hiddenInput, def.name, def.accept);

  field.appendChild(hiddenInput);
  field.appendChild(dz);
  field.appendChild(listEl);
  field.appendChild(
    el("div", {
      class: "small",
      text: "Drop straight from Explorer/Finder, or click to pick files. Use ✕ to remove any file.",
    }),
  );
  return field;
}

async function renderTool() {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const head = $("#toolHead");
  const form = $("#toolForm");

  if (!id) {
    head.replaceChildren(
      el("h1", { text: "Missing tool" }),
      el("p", { text: "No tool id given in the URL." }),
    );
    return;
  }

  let tools;
  try {
    tools = await fetchTools();
  } catch (err) {
    head.replaceChildren(
      el("h1", { text: "Server offline" }),
      el("p", { text: err.message }),
      el("p", {
        class: "small",
        html: "Start it with <code>cd server && node server.js</code>",
      }),
    );
    return;
  }

  toolMeta = tools.find((t) => t.id === id);
  if (!toolMeta) {
    head.replaceChildren(
      el("h1", { text: "Unknown tool" }),
      el("p", { text: `No tool with id "${id}".` }),
    );
    return;
  }

  document.title = `${toolMeta.name} — MediaNest Tools`;
  head.replaceChildren(
        el("div", { class: "icon", html: `<img src="../${toolMeta.icon}" alt="${toolMeta.name}">` }),
    el("h1", { text: toolMeta.name }),
    el("p", { text: toolMeta.description || "" }),
    el("span", {
      class: "badge",
      text: `${toolMeta.group} · output .${toolMeta.defaultExt || "ext"}`,
    }),
  );

  $("#toolInputs").replaceChildren(
    ...(toolMeta.inputs || []).map(buildUploader),
  );

  // Single-upload tools prepare the multi-output ("batch") panel up front.
  if (uploadMode()) setupResultPanel();
  $("#toolFields").replaceChildren(...(toolMeta.fields || []).map(buildField));

  $("#toolHint").innerHTML =
    "All processing runs <b>locally</b> — your files never leave this machine.";
  form.hidden = false;
}

/* ------------------------------------------------------------------ */
/* Home page                                                          */
/* ------------------------------------------------------------------ */
// Tools pinned to the top of each category card (in listed order);
// unpinned tools keep their server order afterwards.
const PINNED_TOOLS = {
  Audio: [
    "convert-audio",       // Audio Converter
    "compress-audio",      // Audio Compressor
    "increase-volume",     // Increase / Decrease Volume
    "add-image-to-audio",  // Add Cover Art / MP4
    "audio-transition",    // Audio Transition (Fade)
  ],
  Video: [
    "video-compress",          // Video Compressor
    "extract-audio",           // Extract Audio from Video
    "remove-audio-from-video", // Remove Sound from Video
    "replace-audio",           // Replace Audio in Video
    "video-convert",           // Convert Video Format
    "video-trim",              // Trim Video
    "video-merge",             // Merge Videos
  ],
};

/** Stable sort: pinned ids first (PINNED_TOOLS order), the rest keep server order. */
function orderGroup(list, group) {
  const first = PINNED_TOOLS[group];
  if (!first || !first.length) return list;
  const rank = new Map(first.map((id, i) => [id, i]));
  return [...list].sort(
    (a, b) =>
      (rank.has(a.id) ? rank.get(a.id) : first.length) -
      (rank.has(b.id) ? rank.get(b.id) : first.length),
  );
}

async function renderIndex() {
  const lists = document.querySelectorAll(".tool-list[data-group]");
  if (!lists.length) return;

  let tools;
  try {
    tools = await fetchTools();
  } catch (err) {
    for (const ul of lists) {
      ul.replaceChildren(el("li", { class: "none", text: "Could not load." }));
    }
    const note = $("#serverNote");
    if (note) {
      note.hidden = false;
      note.innerHTML =
        "\u26A0 Could not reach the local server. Start it with <code>cd server && node server.js</code>";
    }
    return;
  }

  const byGroup = {};
  for (const t of tools) (byGroup[t.group] = byGroup[t.group] || []).push(t);

  for (const ul of lists) {
    const group = ul.dataset.group;
    const list = orderGroup(byGroup[group] || [], group);

    const head = ul.closest(".category-card");
    const h3 = head ? head.querySelector("h3") : null;
    if (h3 && !h3.querySelector(".count-pill")) {
      h3.appendChild(el("span", { class: "count-pill", text: `${list.length} tools` }));
    }

    if (!list.length) {
      ul.replaceChildren(el("li", { class: "none", text: "No tools available yet." }));
      continue;
    }

    ul.replaceChildren(
      ...list.map((t) =>
        el("li", {}, [
          el("a", {
            href: `tool.html?id=${encodeURIComponent(t.id)}`,
            title: t.description || t.name,
            text: t.name,
          }),
        ]),
      ),
    );
  }
}

/* ------------------------------------------------------------------ */
/* Status / progress / result                                         */
/* ------------------------------------------------------------------ */

function setBusy(busy) {
  const btn = $("#runBtn");
  if (btn) {
    btn.disabled = busy;
    btn.textContent = busy ? "⏳ Processing…" : "⚡ Start";
  }
  const bar = $("#progressWrap");
  if (bar) bar.hidden = !busy;
}

function setProgress(pct) {
  const bar = $("#progressBar");
  if (bar) bar.style.width = `${Math.max(2, Math.min(100, pct))}%`;
}

function setStatus(text, isError) {
  const status = $("#statusLine");
  if (status) {
    status.className = "status-line" + (isError ? " err" : "");
    status.textContent = text;
  }
}

const isAudioExt = (ext) =>
  ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "wma", "oga"].includes(ext);
const isVideoExt = (ext) =>
  ["mp4", "webm", "mov", "mkv", "avi", "ogv", "mpg", "mpeg"].includes(ext);

/* ------------------------------------------------------------------ */
/* ZIP writer (store method — audio is already compressed)             */
/* Minimal, dependency-free PKZIP archive: good enough for bundling     */
/* converted files, and byte-identical output every time.               */
/* ------------------------------------------------------------------ */

let CRC_TABLE = null;

function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < bytes.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ bytes[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0x0f) << 5) |
    (d.getDate() & 0x1f);
  return { time, date };
}

/** entries: [{ name, data:Uint8Array }] -> application/zip Blob */
function buildZip(entries) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime();
  const dv = (n) => new DataView(new ArrayBuffer(n));
  const parts = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;

    const lh = dv(30);
    lh.setUint32(0, 0x04034b50, true); // local file header signature
    lh.setUint16(4, 20, true);         // version needed
    lh.setUint16(6, 0x0800, true);     // flags: UTF-8 names
    lh.setUint16(8, 0, true);          // method: store
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);      // compressed
    lh.setUint32(22, size, true);      // uncompressed
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);         // extra length
    parts.push(new Uint8Array(lh.buffer), nameBytes, e.data);

    central.push({ nameBytes, crc, size, offset });
    offset += 30 + nameBytes.length + size;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    const ch = dv(46);
    ch.setUint32(0, 0x02014b50, true); // central directory signature
    ch.setUint16(4, 20, true);         // version made by
    ch.setUint16(6, 20, true);         // version needed
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, c.crc, true);
    ch.setUint32(20, c.size, true);
    ch.setUint32(24, c.size, true);
    ch.setUint16(28, c.nameBytes.length, true);
    ch.setUint32(42, c.offset, true);  // offset of local header
    parts.push(new Uint8Array(ch.buffer), c.nameBytes);
    cdSize += 46 + c.nameBytes.length;
  }

  const eo = dv(22);
  eo.setUint32(0, 0x06054b50, true);   // end of central directory
  eo.setUint16(8, central.length, true);
  eo.setUint16(10, central.length, true);
  eo.setUint32(12, cdSize, true);
  eo.setUint32(16, cdStart, true);
  eo.setUint16(20, 0, true);
  parts.push(new Uint8Array(eo.buffer));

  return new Blob(parts, { type: "application/zip" });
}

/** Programmatic click-to-save for generated blobs. */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function showResult(blob, filename) {
  if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
  lastBlobUrl = URL.createObjectURL(blob);
  const media = $("#resultMedia");
  const actions = $("#resultActions");
  media.replaceChildren();

  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (isVideoExt(ext)) {
    media.appendChild(
      el("video", { controls: "", src: lastBlobUrl, class: "result-media" }),
    );
  } else if (isAudioExt(ext)) {
    media.appendChild(
      el("audio", { controls: "", src: lastBlobUrl, class: "result-media" }),
    );
  } else if (ext === "gif") {
    media.appendChild(el("img", { src: lastBlobUrl, class: "result-media", alt: "result" }));
  }

  actions.replaceChildren(
    el("a", {
      class: "btn btn-primary",
      href: lastBlobUrl,
      download: filename,
      text: "⬇️ Download",
    }),
  );
  setProgress(100);
  setStatus("Done ✔ — ready to download.", false);
}

/* ------------------------------------------------------------------ */
/* Result panel — batch mode                                          */
/* ------------------------------------------------------------------ */

/** One-time Output-panel prep: hint under the empty-state placeholder. */
function setupResultPanel() {
  const drop = $("#resultDrop");
  if (drop && !drop.dataset.hinted) {
    drop.dataset.hinted = "1";
    drop.appendChild(
      el("p", {
        class: "small drop-hint",
        text: "Converted files will appear here one by one — download individually, or grab everything as one ZIP.",
      }),
    );
  }
}

/** The extension a batch run produces ('format' select wins when present). */
function resultExt() {
  const form = $("#toolForm");
  const node = form && form.querySelector('[name="format"]');
  const fallback = (toolMeta && toolMeta.defaultExt) ||
    ((toolMeta && toolMeta.group) === "Video" ? "mp4" : "mp3");
  return ((node && node.value) || fallback).replace(/^\./, "").toLowerCase();
}

/** Smart archive name derived from what's actually inside. */
function batchZipName(n) {
  const ext = String(lastFormatUsed || resultExt() || "").toLowerCase();
  const kind = ["mp4", "webm", "mov", "mkv", "avi"].includes(ext)
    ? "videos"
    : ["gif", "png", "jpg", "jpeg", "webp"].includes(ext)
      ? "images"
      : "converted";
  return `medinest-${kind}-${ext || "files"}-${n}-${new Date()
    .toISOString()
    .slice(0, 10)}.zip`;
}

const isPlayableExt = (ext) => isAudioExt(ext) || isVideoExt(ext) || ext === "gif";

/** Register a converted blob and repaint the Result panel. */
function pushResultItem(blob, srcName, ext) {
  const taken = new Set(
    resultItems.filter((r) => !r.err).map((r) => r.name.toLowerCase()),
  );
  const name = uniqueName(`${safeBase(srcName)}.${ext}`, taken);
  resultItems.push({ name, blob, url: URL.createObjectURL(blob), err: null });
  renderResults();
  return resultItems[resultItems.length - 1];
}

function clearResults() {
  for (const r of resultItems) if (r.url) URL.revokeObjectURL(r.url);
  resultItems.length = 0;
  renderResults();
}

/** Bundle every successful conversion into one ZIP and save it. */
async function downloadAllZip() {
  const items = resultItems.filter((r) => r.blob && !r.err);
  if (!items.length || zipBusy) return;
  zipBusy = true;
  renderResults();
  setStatus(`📦 Zipping ${items.length} file(s)…`);
  try {
    const entries = [];
    for (const r of items) {
      entries.push({
        name: r.name,
        data: new Uint8Array(await r.blob.arrayBuffer()),
      });
    }
    const zipBlob = buildZip(entries);
    triggerDownload(zipBlob, batchZipName(items.length));
    setStatus(
      `📦 ZIP ready — ${items.length} converted file${items.length > 1 ? "s" : ""} inside.`,
    );
  } catch (err) {
    setStatus(`✖ Could not build the ZIP: ${err.message}`, true);
  } finally {
    zipBusy = false;
    renderResults();
  }
}

function renderResults() {
  const drop = $("#resultDrop");
  const mediaBox = $("#resultMedia");
  const actions = $("#resultActions");
  if (!mediaBox || !actions) return;

  const items = resultItems;
  if (drop) drop.style.display = items.length ? "none" : "";

  if (!items.length) {
    mediaBox.replaceChildren();
    actions.replaceChildren();
    return;
  }

  const totalBytes = items.reduce((s, r) => s + (r.blob ? r.blob.size : 0), 0);
  const anyOut = items.some((r) => r.blob && !r.err);
  const oIcon = outputIcon();

  mediaBox.replaceChildren(
    el("div", {
      class: "results-summary",
      text: `${items.length} output${items.length > 1 ? "s" : ""} · ${fmtBytes(totalBytes)} total`,
    }),
    ...items.map((r) =>
      el("div", { class: "r-row" }, [
        el("span", { class: "f-icon", text: oIcon }),
        el("div", { class: "f-meta" }, [
          (r.url && isPlayableExt((r.name.split(".").pop() || "").toLowerCase())
            ? el("a", {
                class: "f-name link-like",
                href: r.url,
                target: "_blank",
                rel: "noopener",
                title: `Preview ${r.name}`,
                text: r.name,
              })
            : el("div", { class: "f-name", title: r.name, text: r.name })),
          el("div", { class: "f-size", text: fmtBytes(r.blob.size) }),
        ]),
        el("a", {
          class: "btn btn-sm btn-primary",
          href: r.url,
          download: r.name,
          text: "⬇️ Download",
        }),
      ]),
    ),
  );

  actions.replaceChildren(
    el("button", {
      type: "button",
      class: "btn btn-primary",
      onclick: downloadAllZip,
      disabled: anyOut ? "" : "disabled",
      text: zipBusy
        ? "⏳ Zipping…"
        : `📦 Download all (${items.filter((r) => !r.err).length}) as ZIP`,
    }),
    el("button", {
      type: "button",
      class: "btn btn-sm",
      onclick: clearResults,
      text: "🧹 Clear results",
    }),
  );
}

function refreshQueues() {
  for (const name of Object.keys(uploadRefreshers)) uploadRefreshers[name]();
}

/* ------------------------------------------------------------------ */
/* Submit                                                              */
/* ------------------------------------------------------------------ */
async function submitForm(ev) {
  ev.preventDefault();
  if (!toolMeta) return;
  try {
    if (uploadMode()) await submitMultiForm();
    else await submitSingle(ev);
  } finally {
    setBusy(false);
    const bar = $("#progressWrap");
    if (bar) bar.hidden = true;
  }
}

/* Legacy single-request flow — unchanged behaviour. */
async function submitSingle(ev) {
  const fd = new FormData(ev.target);

  for (const def of toolMeta.inputs || []) {
    const files = fd.getAll(def.name).filter((f) => f.size > 0);
    if (!files.length) {
      setStatus(`Please choose ${def.label.toLowerCase()}.`, true);
      return;
    }
  }

  setBusy(true);
  busyProcessing = true;
  setProgress(8);
  setStatus("Uploading to local server…");

  try {
    const res = await fetch(`${API}/${encodeURIComponent(toolMeta.id)}`, {
      method: "POST",
      body: fd,
    });

    if (!res.ok) {
      let msg = `Server error (${res.status})`;
      try {
        const j = await res.json();
        if (j && j.error) msg = j.error;
      } catch (e) {}
      throw new Error(msg);
    }

    setProgress(75);
    setStatus("Processing… almost there.");
    const blob = await res.blob();

    const cd = res.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename="?([^";]+)"?/);
    const filename =
      m ? m[1] : `processed-${Date.now()}.${toolMeta.defaultExt || "bin"}`;

    showResult(blob, filename);
  } catch (err) {
    setStatus(`✖ ${err.message}`, true);
    setProgress(0);
  } finally {
    busyProcessing = false;
    refreshQueues();
  }
}

/* Multi-file flow: convert each queued file one-by-one against the
   normal endpoint so every output can be downloaded individually —
   or bundled into one ZIP afterwards. Failures never stop the queue. */
async function submitMultiForm() {
  const form = $("#toolForm");

  // Tool options (format/bitrate/…) straight from the rendered fields.
  const params = [];
  for (const f of toolMeta.fields || []) {
    const node = form.querySelector(`[name="${f.name}"]`);
    if (node) params.push([f.name, node.value]);
  }
  const primaryInput = (toolMeta.inputs || [])[0] || {};

  // Output extension: the 'format' select wins when this tool has one,
  // otherwise the registry default — per input slot.
  const extFor = (def) => {
    const fmtNode = form.querySelector('[name="format"]');
    const raw =
      def && def.name === primaryInput.name && fmtNode && fmtNode.value
        ? fmtNode.value
        : toolMeta.defaultExt || "out";
    return String(raw).replace(/^\./, "").toLowerCase();
  };
  lastFormatUsed = resultExt();

  // Flatten every input queue into an ordered job list.
  const jobs = [];
  for (const def of toolMeta.inputs || []) {
    for (const item of filesFor(def.name)) jobs.push({ def, item });
  }
  if (!jobs.length) {
    setStatus(
      `Please add at least one ${String(
        ((toolMeta.inputs || [])[0] || {}).label || "file",
      ).toLowerCase()} to the queue.`,
      true,
    );
    return;
  }

  busyProcessing = true;
  setBusy(true);
  setProgress(4);
  document.querySelectorAll(".uploader").forEach((u) => u.classList.add("disabled"));
  refreshQueues();

  let done = 0;
  let failed = 0;

  for (let i = 0; i < jobs.length; i++) {
    const { def, item } = jobs[i];
    setStatus(`${workVerbCap()} ${i + 1} of ${jobs.length}: ${item.file.name}`);
    setRowState(item, "working");
    refreshQueues();

    const fd = new FormData();
    for (const [k, v] of params) fd.append(k, v);
    fd.append(def.name, item.file, item.file.name);

    try {
      const res = await fetch(`${API}/${encodeURIComponent(toolMeta.id)}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        let msg = `Server error (${res.status})`;
        try {
          const j = await res.json();
          if (j && j.error) msg = j.error;
        } catch (e) {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      item.outSize = blob.size;
      item.outName = `${safeBase(item.file.name)}.${extFor(def)}`;
      setRowState(item, "done");
      pushResultItem(blob, item.file.name, extFor(def));
      done++;
    } catch (err) {
      failed++;
      setRowState(item, "err", err.message);
    }

    setProgress(Math.round(((i + 1) / jobs.length) * 100));
    refreshQueues();
  }

  busyProcessing = false;
  document.querySelectorAll(".uploader").forEach((u) =>
    u.classList.remove("disabled"),
  );
  refreshQueues();
  renderResults();

  if (failed) {
    setStatus(
      `Finished — ${done} ok, ${failed} failed (see ✖ rows above).`,
    );
  } else {
    setStatus(
      done === 1
        ? "Done ✔ — ready to download."
        : `Done ✔ ${done} files processed.`,
    );
  }

  // Queue drained — re-arm the panel so a fresh drop starts a new batch.
  if (!resultItems.some((r) => r.blob)) setupResultPanel();
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  if ($("#categoryGrid")) {
    renderIndex();
  } else if ($("#toolForm")) {
    renderTool();
    $("#toolForm").addEventListener("submit", submitForm);
  }
});