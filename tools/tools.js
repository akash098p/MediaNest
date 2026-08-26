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

function buildInput(def) {
  const field = el("div", { class: "field" });
  field.appendChild(el("label", { text: def.label }));
  const attrs = {
    type: "file",
    name: def.name,
    accept: def.accept || "*",
  };
  if (def.multiple) attrs.multiple = "";
  const input = el("input", attrs);
  if (def.multiple) input.classList.add("multiple");
  field.appendChild(input);
  const picked = el("div", { class: "small" });
  input.addEventListener("change", () => {
    const n = input.files.length;
    picked.textContent = n ? `${n} file${n > 1 ? "s" : ""} selected` : "";
  });
  field.appendChild(picked);
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

  $("#toolInputs").replaceChildren(...(toolMeta.inputs || []).map(buildInput));
  $("#toolFields").replaceChildren(...(toolMeta.fields || []).map(buildField));

  $("#toolHint").innerHTML =
    "All processing runs <b>locally</b> — your files never leave this machine.";
  form.hidden = false;
}

/* ------------------------------------------------------------------ */
/* Home page                                                          */
/* ------------------------------------------------------------------ */
async function renderIndex() {
  const container = $("#toolIndex");
  if (!container) return;
  try {
    const tools = await fetchTools();
    const groups = {};
    for (const t of tools) (groups[t.group] = groups[t.group] || []).push(t);

    const frag = document.createDocumentFragment();
    for (const [group, list] of Object.entries(groups)) {
      frag.appendChild(el("h2", { class: "group-title", text: group }));
      const grid = el("div", { class: "grid" });
      for (const t of list) {
        grid.appendChild(
          el("a", {
            class: "card",
            href: `tool.html?id=${encodeURIComponent(t.id)}`,
            style: "text-decoration:none;color:inherit",
          }, [
                        el("div", { class: "icon", html: `<img src="../${t.icon}" alt="${t.name}">` }),
            el("h3", { text: t.name }),
            el("p", { text: t.description || "" }),
            el("span", { class: "go", text: "Use tool →" }),
          ]),
        );
      }
      frag.appendChild(grid);
    }
    container.replaceChildren(frag);
  } catch (err) {
    container.replaceChildren(
      el("p", { class: "status-line err", text: `⚠ ${err.message}` }),
      el("p", {
        class: "small",
        html:
          "Start the backend first:<br><code>cd server &amp;&amp; npm install &amp;&amp; node server.js</code><br>then open <code>http://localhost:4000/tools/index.html</code>",
      }),
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
/* Submit                                                             */
/* ------------------------------------------------------------------ */
async function submitForm(ev) {
  ev.preventDefault();
  if (!toolMeta) return;

  const fd = new FormData(ev.target);

  for (const def of toolMeta.inputs || []) {
    const files = fd.getAll(def.name).filter((f) => f.size > 0);
    if (!files.length) {
      setStatus(`Please choose ${def.label.toLowerCase()}.`, true);
      return;
    }
  }

  setBusy(true);
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
    setBusy(false);
    $("#progressWrap").hidden = true;
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  if ($("#toolIndex")) {
    renderIndex();
  } else if ($("#toolForm")) {
    renderTool();
    $("#toolForm").addEventListener("submit", submitForm);
  }
});