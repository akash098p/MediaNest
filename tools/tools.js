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
  if (f.name) field.setAttribute("data-field", f.name);
  field.appendChild(el("label", { text: f.label }));

  if (f.type === "editor") {
    // The visual editor is built later, in renderTool(), once the user
    // has chosen a file (we need a frame to draw into). Here we only
    // leave a clearly-labelled container so the layout doesn't jump.
    const slot = el("div", { class: "vjs-editor-slot", "data-editor-kind": f.editor.kind });
    slot.appendChild(el("p", {
      class: "small",
      text: "🎨 Add a file above to load the visual editor.",
    }));
    field.appendChild(slot);
    return field;
  }

  if (f.type === "select") {
    const select = el("select", { name: f.name });
    for (const opt of f.options || []) {
      const val = typeof opt === "object" ? opt.value : opt;
      const text = typeof opt === "object" ? opt.text : opt;
      const optEl = el("option", { value: val, text });
      if (f.default === val) optEl.selected = true;
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
    if (f.note) {
      field.appendChild(
        el("div", { class: "field-note", text: f.note }),
      );
    }
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
    if (f.note) field.appendChild(el("div", { class: "field-note", text: f.note }));
  }
  return field;
}

/* ------------------------------------------------------------------ */
/* Conditional field visibility (fields with a `dependsOn` rule are    */
/* shown/hidden based on a controlling select — e.g. the compressor's  */
/* mode selector reveals the matching compression control).            */
/* ------------------------------------------------------------------ */
function applyFieldVisibility() {
  const form = $("#toolForm");
  if (!form || !toolMeta) return;
  for (const f of toolMeta.fields || []) {
    if (!f.dependsOn) continue;
    const ctrl = form.querySelector(`[name="${f.dependsOn.field}"]`);
    const target = form.querySelector(`[data-field="${f.name}"]`);
    if (!target) continue;
    const show =
      !ctrl || ctrl.tagName !== "SELECT" || ctrl.value === String(f.dependsOn.value);
    target.style.display = show ? "" : "none";
  }
}

function wireFieldVisibility() {
  const form = $("#toolForm");
  if (!form || !toolMeta) return;
  for (const f of toolMeta.fields || []) {
    if (!f.dependsOn) continue;
    const ctrl = form.querySelector(`[name="${f.dependsOn.field}"]`);
    if (ctrl && ctrl.tagName === "SELECT" && !ctrl.dataset.fieldWired) {
      ctrl.dataset.fieldWired = "1";
      ctrl.addEventListener("change", applyFieldVisibility);
    }
  }
  applyFieldVisibility();
}

/* ------------------------------------------------------------------ */
/* Visual editor — drag-to-crop / drag-to-resize / drag-to-rotate      */
/* ------------------------------------------------------------------ */
function findEditorField() {
  return (toolMeta?.fields || []).find((f) => f.type === "editor") || null;
}
function pickEditorFile() {
  const editor = findEditorField();
  if (!editor) return null;
  const primary =
    (toolMeta.inputs || []).find((i) => !i.multiple) || (toolMeta.inputs || [])[0];
  if (!primary) return null;
  const items = filesFor(primary.name);
  if (!items.length) return null;
  return items[0]?.file || null;
}
function writeEditorOutputs(values) {
  const form = $("#toolForm");
  if (!form) return;
  for (const [k, v] of Object.entries(values || {})) {
    const node = form.querySelector(`[name="${k}"]`);
    if (node) node.value = String(v);
  }
}
function isVideoFile(f) {
  if (!f) return false;
  if (f.type && String(f.type).startsWith("video/")) return true;
  return /\.(mp4|webm|mov|mkv|avi|ogv|m4v)$/i.test(f.name || "");
}
function videoReady(v) {
  // Wait for a decoded frame to be available — `loadedmetadata` alone is
  // not enough because some codecs (e.g. webm) report dimensions only
  // after `loadeddata`. Without this, videoWidth/videoHeight can read 0
  // and the editor falls into its "could not read dimensions" branch.
  return new Promise((resolve, reject) => {
    if (v.readyState >= 2) return resolve();
    const ok = () => resolve();
    v.addEventListener("loadeddata", ok, { once: true });
    v.addEventListener("canplay", ok, { once: true });
    v.addEventListener("error", () => reject(new Error("Could not read the video file.")), { once: true });
  });
}
function getFormNumber(name) {
  const node = document.querySelector(`#toolForm [name="${name}"]`);
  if (!node) return 0;
  const v = Number(node.value);
  return Number.isFinite(v) ? v : 0;
}

async function mountVisualEditor() {
  const editor = findEditorField();
  if (!editor) return;
  const slot = document.querySelector(".vjs-editor-slot");
  if (!slot) return;

  const file = pickEditorFile();
  if (!file) {
    slot.replaceChildren(
      el("p", { class: "small", text: "🎨 Add a file above to load the visual editor." }),
    );
    return;
  }

  slot.replaceChildren();
  slot.appendChild(el("p", { class: "small", text: "Loading preview…" }));

  // ---- load the source frame (or first video frame) ----
  let srcW = 0, srcH = 0, drawable = null;
  let videoEl = null; // visible player (kept in the timeline bar), drives the canvas.
  try {
    const url = URL.createObjectURL(file);
    if (isVideoFile(file)) {
      // The <video> needs to be in the DOM for the browser to decode
      // frames (some browsers won't draw a detached <video> onto a
      // canvas). We append it to the slot now (parked off-screen via
      // CSS — see .vjs-frame-sink) and later move it into the timeline
      // bar. We deliberately do NOT use `display: none` to hide it:
      // most browsers suspend frame decoding for `display: none`
      // videos, which leaves the canvas permanently blank. The
      // `.vjs-frame-sink` class is applied here so the off-screen
      // positioning kicks in immediately, before the first paint.
      videoEl = el("video", { src: url, muted: "", playsinline: "", preload: "auto", class: "vjs-frame-sink" });
      slot.appendChild(videoEl);
      await videoReady(videoEl);
      // Seek a hair into the clip so the first frame the canvas paints
      // is the actual content, not a black opening frame. For very
      // short clips (under ~0.4s) this resolves to time 0.
      videoEl.currentTime = Math.min(0.1, (videoEl.duration || 0) / 4 || 0);
      await new Promise((res) => videoEl.addEventListener("seeked", res, { once: true }));
      srcW = videoEl.videoWidth; srcH = videoEl.videoHeight;
      drawable = videoEl;
    } else {
      const img = new Image();
      img.src = url;
      await new Promise((res, rej) => {
        img.onload = res; img.onerror = () => rej(new Error("Could not read the image."));
      });
      srcW = img.naturalWidth; srcH = img.naturalHeight;
      drawable = img;
    }
  } catch (err) {
    // Make sure we don't leak a detached <video> if we abort here.
    if (videoEl && videoEl.parentNode) videoEl.parentNode.removeChild(videoEl);
    slot.replaceChildren(el("p", { class: "small", text: `⚠ ${err.message}` }));
    return;
  }

  if (!srcW || !srcH) {
    if (videoEl && videoEl.parentNode) videoEl.parentNode.removeChild(videoEl);
    slot.replaceChildren(el("p", { class: "small", text: "⚠ Could not read the file dimensions." }));
    return;
  }

  // For videos, some browsers (notably webm on Chromium) report
  // videoWidth/videoHeight = 0 even after `loadedmetadata` and a
  // successful seek. If that happens, fall back to the natural canvas
  // size and wait one more frame for the decoder to publish real
  // dimensions. We don't abort the editor — we just retry the read.
  if (drawable && drawable.tagName === "VIDEO" && (drawable.videoWidth === 0 || drawable.videoHeight === 0)) {
    await new Promise((res) => drawable.addEventListener("loadeddata", res, { once: true }));
    if (drawable.videoWidth > 0 && drawable.videoHeight > 0) {
      srcW = drawable.videoWidth;
      srcH = drawable.videoHeight;
    } else {
      // Last-resort default so the editor at least renders something
      // usable instead of crashing on a 0-size canvas.
      srcW = srcW || 1920;
      srcH = srcH || 1080;
    }
  }

  const cfg = editor.editor;
  const out = {};
  for (const k of cfg.emits) out[k] = Number(getFormNumber(k)) || 0;
  if (cfg.kind === "crop" || cfg.kind === "resize") {
    // Pick a sensible initial box that scales with the source, instead
    // of relying on the (often tiny) form defaults. The form values
    // are still used when the user has set something meaningful (e.g.
    // re-opened an edited file), so we only override when the form
    // value is "clearly too small" (less than 30% of the source on
    // its longest side).
    const minW = Math.max(8, Math.round(srcW * 0.3));
    const minH = Math.max(8, Math.round(srcH * 0.3));
    const defW = Math.min(srcW, Math.max(minW, Math.round(srcW * 0.6)));
    const defH = Math.min(srcH, Math.max(minH, Math.round(srcH * 0.6)));
    if (cfg.emits.includes("w") && (!out.w || out.w < minW)) out.w = defW;
    if (cfg.emits.includes("h") && (!out.h || out.h < minH)) out.h = defH;
    if (cfg.emits.includes("x") && (!out.x || out.x + (out.w || 0) > srcW))
      out.x = Math.max(0, Math.round((srcW - (out.w || defW)) / 2));
    if (cfg.emits.includes("y") && (!out.y || out.y + (out.h || 0) > srcH))
      out.y = Math.max(0, Math.round((srcH - (out.h || defH)) / 2));
    if (cfg.emits.includes("width")  && (!out.width  || out.width  < minW)) out.width  = srcW;
    if (cfg.emits.includes("height") && (out.height == null || out.height < 0)) out.height = 0;
  }
  if (cfg.kind === "rotate" && (out.degrees == null || isNaN(out.degrees))) out.degrees = 0;
  writeEditorOutputs(out);

  // The "trim" editor is video-only and uses a totally different layout — a
  // playable <video> with a draggable in/out timeline — so it's assembled by a
  // dedicated helper and returns early before the crop/resize/rotate canvas
  // stage is built.
  if (cfg.kind === "trim") {
    await mountTrimEditor(slot, videoEl, srcW, srcH, cfg);
    return;
  }

  // ---- DOM scaffolding ----
  // IMPORTANT: if we have a <video>, keep it in the DOM while building the
  // stage. Some browsers won't paint a detached <video> onto a canvas, so
  // `replaceChildren()` would blank the preview. The video is parked
  // off-screen via CSS (`.vjs-frame-sink` — see tools.css) until it gets
  // moved into the timeline bar a few lines further down. The
  // `.vjs-frame-sink` class travels with the element, so the
  // off-screen positioning survives the move.
  slot.replaceChildren(...(videoEl ? [videoEl] : []));
  const toolbar = el("div", { class: "vjs-editor-toolbar" });
  const presetSel = el("select", { class: "vjs-preset" });
  for (const p of cfg.presets || []) {
    const opt = el("option", { value: p.value, text: p.text });
    if (p.value === cfg.defaultPreset) opt.selected = true;
    presetSel.appendChild(opt);
  }
  toolbar.appendChild(el("label", { class: "vjs-preset-label", text: "Preset:" }));
  toolbar.appendChild(presetSel);

  const readout = el("span", { class: "vjs-readout" });
  toolbar.appendChild(readout);

  let aspectLock = !!cfg.lockAspect;
  if (cfg.kind !== "rotate") {
    const lockBtn = el("button", {
      type: "button", class: "vjs-lock btn btn-sm", title: "Lock aspect ratio",
      text: aspectLock ? "🔒 Aspect locked" : "🔓 Aspect unlocked",
    });
    lockBtn.addEventListener("click", () => {
      aspectLock = !aspectLock;
      lockBtn.textContent = aspectLock ? "🔒 Aspect locked" : "🔓 Aspect unlocked";
      lockBtn.classList.toggle("is-on", aspectLock);
      applyPreset(presetSel.value);
    });
    if (aspectLock) lockBtn.classList.add("is-on");
    toolbar.appendChild(lockBtn);
  }

  const stage = el("div", { class: "vjs-stage" });
  // The .vjs-frame wraps the canvas + the absolutely-positioned overlay.
  // Sizing the frame to exactly the canvas (not the whole stage) means the
  // overlay's coordinates line up perfectly with the pixels on screen — this
  // is what fixes the "draggable bars don't align with the video" bug, where
  // the overlay used to be anchored at the stage's top-left corner.
  const frame = el("div", { class: "vjs-frame" });
  const canvas = el("canvas", { class: "vjs-canvas" });
  const overlay = el("div", { class: "vjs-overlay" });
  frame.appendChild(canvas);
  frame.appendChild(overlay);
  stage.appendChild(frame);

  const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const body = el("div", { class: "vjs-box" });
  for (const h of handles) body.appendChild(el("div", { class: `vjs-handle vjs-h-${h}`, "data-handle": h }));
  // The orange rotation handle and the connecting stalk are only useful
  // for the Rotate tool. Showing them on Crop/Resize confuses users
  // (they look draggable but do nothing, and they sit in the space above
  // the box where the N handle / top edge would be reached).
  let rotHandle = null;
  if (cfg.kind === "rotate") {
    rotHandle = el("div", { class: "vjs-rot-handle", title: "Drag to rotate" });
    body.appendChild(rotHandle);
  } else {
    body.classList.add("vjs-box-no-rotate");
  }
  overlay.appendChild(body);

  const resetBtn = el("button", { type: "button", class: "btn btn-sm", text: "↺ Reset" });
  toolbar.appendChild(resetBtn);

  slot.appendChild(toolbar);
  slot.appendChild(stage);

  // Short hint under the canvas explaining what this tool actually does.
  // Resize scales the whole image, so the box can't be moved; Crop picks
  // a sub-region, so the box can be moved + resized.
  const hintText = cfg.kind === "resize"
    ? "Resizes the whole image to the chosen dimensions. To pick a sub-region, use Crop."
    : cfg.kind === "crop"
    ? "Selects a rectangular region of the source. Drag handles to resize, drag inside to move."
    : cfg.kind === "rotate"
    ? "Rotates the image. Drag the orange handle above the box, or type an angle."
    : null;
  if (hintText) {
    slot.appendChild(el("p", { class: "vjs-hint small", text: hintText }));
  }

  // ---- video timeline (play / pause / scrub / frame step) ----
  // For video tools we expose a play button + scrubber so the user can edit
  // while the video is playing — the canvas is redrawn from <video> on every
  // playhead update, which keeps the crop box aligned with the current frame.
  if (videoEl) {
    const bar = el("div", { class: "vjs-video-bar" });
    const playBtn = el("button", { type: "button", class: "vjs-play-btn", title: "Play / Pause" }, ["▶"]);
    const scrubber = el("input", {
      type: "range", class: "vjs-scrubber", min: "0", max: "1", step: "0.001", value: "0",
    });
    const time = el("span", { class: "vjs-time", text: "0:00.0 / 0:00.0" });
    const backBtn = el("button", { type: "button", class: "vjs-frame-btn", title: "Previous frame" }, ["⟨ frame"]);
    const fwdBtn = el("button", { type: "button", class: "vjs-frame-btn", title: "Next frame" }, ["frame ⟩"]);
    bar.append(backBtn, playBtn, scrubber, time, fwdBtn);
    // Move the live <video> element from the slot (where the loader placed it)
    // into the timeline bar so playback works alongside the canvas.
    if (videoEl.parentNode) videoEl.parentNode.removeChild(videoEl);
    bar.appendChild(videoEl);
    slot.appendChild(bar);

    const fmtT = (s) => {
      if (!Number.isFinite(s)) return "0:00.0";
      const m = Math.floor(s / 60);
      const sec = s - m * 60;
      return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
    };
    const refreshTime = () => {
      scrubber.value = String(videoEl.currentTime || 0);
      time.textContent = `${fmtT(videoEl.currentTime)} / ${fmtT(videoEl.duration)}`;
      playBtn.textContent = videoEl.paused ? "▶" : "⏸";
    };
    playBtn.addEventListener("click", () => {
      if (videoEl.paused) videoEl.play().catch(() => {});
      else videoEl.pause();
    });
    backBtn.addEventListener("click", () => {
      videoEl.pause();
      videoEl.currentTime = Math.max(0, videoEl.currentTime - 1 / 30);
    });
    fwdBtn.addEventListener("click", () => {
      videoEl.pause();
      videoEl.currentTime = Math.min(videoEl.duration || 0, videoEl.currentTime + 1 / 30);
    });
    scrubber.addEventListener("input", () => {
      videoEl.pause();
      videoEl.currentTime = Number(scrubber.value) || 0;
    });
    videoEl.addEventListener("seeked", () => {
      refreshTime();
      // `seeked` fires before the new frame is actually decoded into the
      // video's frame buffer. Asking for the next decoded frame via
      // requestVideoFrameCallback is the only reliable way to get a real
      // picture on the canvas (drawImage on a not-yet-decoded video
      // returns a transparent/black frame). The fallback inside
      // redrawOnNextFrame handles browsers that don't implement it.
      redrawOnNextFrame(videoEl);
    });
    videoEl.addEventListener("timeupdate", () => { refreshTime(); redraw(); });
    videoEl.addEventListener("play", refreshTime);
    videoEl.addEventListener("pause", refreshTime);
    // Re-paint the canvas once the first decoded frame is available.
    // `loadeddata` fires after `loadedmetadata` once at least one frame
    // is decoded — without this, a freshly dropped video that finishes
    // decoding after the initial `redraw()` call would leave a blank
    // canvas.
    videoEl.addEventListener("loadeddata", () => redrawOnNextFrame(videoEl));
    videoEl.addEventListener("loadedmetadata", () => {
      scrubber.max = String(videoEl.duration || 0);
      refreshTime();
      redrawOnNextFrame(videoEl);
    });
    refreshTime();
  }

  // ---- sizing helpers ----
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  let renderW = 0, renderH = 0;
  function fit() {
    // Cap the editor so the canvas never grows beyond the working area.
    // We read the slot's content width (not the stage's) because the
    // stage is a flex container that shrinks to its child — reading
    // stage.clientWidth here would give the previous frame size, not
    // the available space. The slot is the stable outer container.
    const slotEl = stage.parentElement || slot;
    const maxW = (slotEl.clientWidth || 520) - 4; // small margin
    // Allow the canvas to be reasonably tall so portrait videos still
    // have room to drag handles. The 0.75 factor keeps the page from
    // getting dominated by a single tall canvas.
    const maxH = Math.max(
      320,
      Math.min(720, Math.floor(window.innerHeight * 0.75)),
    );
    const safeSrcW = Math.max(1, srcW || 1);
    const safeSrcH = Math.max(1, srcH || 1);
    const r = Math.min(maxW / safeSrcW, maxH / safeSrcH, 1);
    renderW = Math.max(64, Math.round(safeSrcW * r));
    renderH = Math.max(64, Math.round(safeSrcH * r));
    canvas.width = renderW * dpr; canvas.height = renderH * dpr;
    canvas.style.width = renderW + "px"; canvas.style.height = renderH + "px";
    // Size the frame to the canvas so the overlay (inset:0) lines up
    // pixel-for-pixel with what's painted.
    frame.style.width = renderW + "px";
    frame.style.height = renderH + "px";
    // Give the stage a stable min-height so the bar + toolbar + canvas
    // always have room and the page doesn't jump on every fit() call.
    stage.style.minHeight = renderH + 24 + "px";
    redraw();
    // For video drawables, also schedule a redraw on the next decoded
    // frame. drawImage() during the very first call may run before the
    // first frame has been decoded into the off-screen <video>, leaving
    // the canvas transparent. requestVideoFrameCallback (or the
    // fallback inside redrawOnNextFrame) re-paints as soon as a real
    // frame is available, so the user always sees the picture.
    if (drawable && drawable.tagName === "VIDEO") {
      redrawOnNextFrame(drawable);
    }
    // Re-apply the current crop/rotate box now that the display size
    // changed — the box position is in source pixels, but its on-screen
    // size depends on renderW/renderH, so re-syncBox is required.
    syncBox(read());
  }
  function redraw() {
    // Bail out if the canvas hasn't been sized yet. We intentionally do
    // NOT bail on `readyState < 2` for video drawables: with the new
    // off-screen (but laid-out) `<video>`, the browser will report
    // readyState correctly. The original `readyState < 2` check caused
    // a permanent blank canvas on every freshly-uploaded video because
    // readyState could read 0 if the seek completed before the first
    // frame had been decoded (and there was no fallback to retry).
    if (!canvas.width || !canvas.height || !renderW || !renderH) return;
    if (!drawable) return;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, renderW, renderH);
    try {
      ctx.drawImage(drawable, 0, 0, renderW, renderH);
    } catch (_) {
      // drawImage on a not-yet-decoded video can throw on some
      // browsers; the requestVideoFrameCallback (or the safety timer
      // below) will trigger a redraw once a real frame is available.
    }
  }
  /** Schedule a redraw the next time a fresh decoded frame is available
   *  on the <video>. Uses HTMLVideoElement.requestVideoFrameCallback where
   *  supported (Chrome/Edge/Safari 16+), with a generous timeout fallback
   *  for browsers that lack it (Firefox). The "frame is ready" event is
   *  the only reliable signal that drawImage() will produce a real
   *  picture — `loadeddata` fires before decoding finishes on some
   *  codecs, and `seeked` fires before the new frame is decoded too. */
  function redrawOnNextFrame(video) {
    if (!video || video.tagName !== "VIDEO") return;
    if (typeof video.requestVideoFrameCallback === "function") {
      try {
        video.requestVideoFrameCallback(() => redraw());
        return;
      } catch (_) { /* fall through to timeout */ }
    }
    // Fallback: try again after a short delay. We schedule multiple
    // attempts because frame decoding can take a moment for larger
    // videos, and we don't want to miss the first paint.
    let tries = 0;
    const tick = () => {
      tries++;
      if (video.readyState >= 2) redraw();
      else if (tries < 12) setTimeout(tick, 80);
    };
    setTimeout(tick, 60);
  }
  const toDisp = (sx, sy) => ({ x: (sx / srcW) * renderW, y: (sy / srcH) * renderH });

  const read = () => {
    const o = {};
    for (const k of cfg.emits) o[k] = Number(getFormNumber(k)) || 0;
    if (cfg.kind === "rotate") o.degrees = ((o.degrees % 360) + 360) % 360;
    return o;
  };
  const write = (o) => {
    if (cfg.kind !== "rotate") {
      if ("w" in o) o.w = Math.max(8, Math.min(srcW, Math.round(o.w)));
      if ("h" in o) o.h = Math.max(8, Math.min(srcH, Math.round(o.h)));
      if ("x" in o) o.x = Math.max(0, Math.min(srcW - (o.w || 1), Math.round(o.x)));
      if ("y" in o) o.y = Math.max(0, Math.min(srcH - (o.h || 1), Math.round(o.y)));
      if ("width"  in o) o.width  = Math.max(8, Math.round(o.width));
      if ("height" in o && o.height > 0) o.height = Math.max(8, Math.round(o.height));
    }
    writeEditorOutputs(o);
    syncBox(o);
  };
  function syncBox(o) {
    if (cfg.kind === "rotate") {
      // The rotation box should cover the whole rendered image so the
      // handles (and the rotation drag) sit on the actual picture, not
      // at the top-left corner. Position the box at the canvas center
      // and size it to the full canvas; the transform then rotates it
      // around its own center.
      body.style.left = (renderW / 2) + "px";
      body.style.top = (renderH / 2) + "px";
      body.style.width = renderW + "px";
      body.style.height = renderH + "px";
      body.style.transform = `translate(-50%, -50%) rotate(${o.degrees}deg)`;
    } else {
      const x = "x" in o ? o.x : 0;
      const y = "y" in o ? o.y : 0;
      const w = "w" in o ? o.w : ("width" in o ? o.width : srcW);
      const h = "h" in o ? o.h : ("height" in o && o.height > 0 ? o.height : srcH);
      const tl = toDisp(x, y), br = toDisp(x + w, y + h);
      body.style.left = tl.x + "px"; body.style.top = tl.y + "px";
      body.style.width = (br.x - tl.x) + "px"; body.style.height = (br.y - tl.y) + "px";
      body.style.transform = "none";
    }
    updateReadout();
  }
  function updateReadout() {
    const o = read();
    if (cfg.kind === "rotate") {
      readout.textContent = `Angle: ${Math.round(o.degrees)}°`;
    } else {
      const w = "w" in o ? o.w : o.width;
      let h = "h" in o ? o.h : o.height;
      // For Resize, height=0 means "auto" — show the aspect-locked value
      // so the user knows what the actual output height will be.
      if (cfg.kind === "resize" && (!h || h <= 0) && w > 0) {
        h = Math.max(8, Math.round(w * (srcH / srcW)));
      }
      const x = "x" in o ? o.x : 0;
      const y = "y" in o ? o.y : 0;
      readout.textContent = `${w} × ${h} px  ·  starts at (${x}, ${y})`;
    }
  }
  function aspectRatio(p) {
    const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(p);
    if (!m) return null;
    return Number(m[1]) / Number(m[2]);
  }
  function applyPreset(value) {
    const o = read();
    if (cfg.kind === "resize") {
      if (value === "original") { o.width = srcW; o.height = 0; }
      else if (value === "custom") { /* leave as-is */ }
      else if (value === "1080p") { o.width = 1080; o.height = 1920; }
      else {
        const w = Number(value);
        if (Number.isFinite(w) && w > 0) {
          o.width = w;
          o.height = aspectLock ? Math.max(8, Math.round(w * (srcH / srcW))) : 0;
        }
      }
    } else if (cfg.kind === "crop") {
      if (value !== "free") {
        const ar = aspectRatio(value);
        if (ar) {
          let cw = srcW, ch = srcH;
          if (cw / ch > ar) cw = ch * ar; else ch = cw / ar;
          cw = Math.floor(cw / 2) * 2; ch = Math.floor(ch / 2) * 2;
          o.w = cw; o.h = ch;
          o.x = Math.floor((srcW - cw) / 2);
          o.y = Math.floor((srcH - ch) / 2);
        }
      }
    } else if (cfg.kind === "rotate") {
      const v = Number(value);
      if (Number.isFinite(v)) o.degrees = v;
    }
    write(o);
  }
  presetSel.addEventListener("change", () => applyPreset(presetSel.value));
  resetBtn.addEventListener("click", () => {
    if (cfg.kind === "rotate") { write({ degrees: 0 }); presetSel.value = "0"; }
    else if (cfg.kind === "resize") { write({ width: srcW, height: 0 }); presetSel.value = "original"; }
    else { write({ x: 0, y: 0, w: srcW, h: srcH }); presetSel.value = "free"; }
  });
  applyPreset(presetSel.value || cfg.defaultPreset);

  // ---- drag ----
  // Build a complete state object for the current tool, filling in any
  // implicit fields with sensible defaults. For Resize the form only
  // stores width/height, but the crop "region" is implicitly the whole
  // image (x=0, y=0). For Crop the form has all four, and for Rotate
  // only degrees. This helper makes moveDrag + syncBox work uniformly.
  function fullState() {
    const o = read();
    if (cfg.kind === "resize") {
      if (!("x" in o)) o.x = 0;
      if (!("y" in o)) o.y = 0;
      if (!(o.width  > 0)) o.width  = srcW;
      if (!(o.height > 0)) o.height = srcH; // 0 means "auto" -> use srcH for display
    } else if (cfg.kind === "crop") {
      if (!("x" in o)) o.x = 0;
      if (!("y" in o)) o.y = 0;
      if (!(o.w > 0)) o.w = srcW;
      if (!(o.h > 0)) o.h = srcH;
    }
    return o;
  }
  let drag = null;
  function pointerXY(e) {
    const t = e.touches ? e.touches[0] : e;
    const rect = overlay.getBoundingClientRect();
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }
  function startDrag(mode, e) {
    e.preventDefault(); e.stopPropagation();
    drag = { mode, start: fullState(), startPt: pointerXY(e) };
  }
  function moveDrag(e) {
    if (!drag) return;
    e.preventDefault();
    const pt = pointerXY(e);
    const dx = pt.x - drag.startPt.x;
    const dy = pt.y - drag.startPt.y;
    const o = { ...drag.start };
    if (cfg.kind === "rotate") {
      const cx = renderW / 2, cy = renderH / 2;
      const a0 = Math.atan2(drag.startPt.y - cy, drag.startPt.x - cx);
      const a1 = Math.atan2(pt.y - cy, pt.x - cx);
      let deg = drag.start.degrees + ((a1 - a0) * 180) / Math.PI;
      const norm = ((deg % 360) + 360) % 360;
      const snap = [0, 90, 180, 270].find((s) => Math.abs(norm - s) < 4);
      if (snap != null) deg = snap;
      o.degrees = ((deg % 360) + 360) % 360;
    } else if (drag.mode === "move") {
      o.x = drag.start.x + (dx / renderW) * srcW;
      o.y = drag.start.y + (dy / renderH) * srcH;
    } else {
      const h = drag.mode;
      const startW = "w" in drag.start ? drag.start.w : drag.start.width;
      const startH = "h" in drag.start ? drag.start.h : drag.start.height;
      const startX = drag.start.x, startY = drag.start.y;
      const sdx = (dx / renderW) * srcW;
      const sdy = (dy / renderH) * srcH;
      let nx = startX, ny = startY, nw = startW, nh = startH;
      if (h.includes("w")) { nx = startX + sdx; nw = startW - sdx; }
      if (h.includes("e")) { nw = startW + sdx; }
      if (h.includes("n")) { ny = startY + sdy; nh = startH - sdy; }
      if (h.includes("s")) { nh = startH + sdy; }
      if (aspectLock) {
        const ar = startW / startH;
        if (Math.abs(sdx) > Math.abs(sdy)) nh = nw / ar;
        else nw = nh * ar;
        if (h.includes("w")) nx = startX + (startW - nw);
        if (h.includes("n")) ny = startY + (startH - nh);
      }
      if (nw < 16) { nw = 16; if (aspectLock) nh = nw / ar; }
      if (nh < 16) { nh = 16; if (aspectLock) nw = nh * ar; }
      if ("w" in o) { o.w = nw; o.h = nh; o.x = nx; o.y = ny; }
      else {
        // Resize: the output is always the full source image (no crop),
        // so the box is anchored at (0, 0). Only width/height change.
        o.width = nw;
        // Always write the computed height so the visual box reflects
        // the new dimensions. The server treats height>0 the same as
        // height=0 (auto) — ffmpeg's "-1" is equivalent to the explicit
        // value. This makes the N/S handles visibly change the box
        // height in the editor, not just the width.
        o.height = nh;
        o.x = 0; o.y = 0;
      }
    }
    write(o);
  }
  body.addEventListener("pointerdown", (e) => {
    if (rotHandle && e.target === rotHandle) startDrag("rot", e);
    else if (e.target.classList.contains("vjs-handle")) startDrag(e.target.dataset.handle, e);
    // For Resize, clicking inside the box (not on a handle) does nothing:
    // the box represents the *output viewport* over the source, which is
    // always anchored at (0, 0) in source coordinates. Only the handles
    // change the output size.
    else if (cfg.kind !== "resize") startDrag("move", e);
    try { body.setPointerCapture(e.pointerId); } catch (_) {}
  });
  body.addEventListener("pointermove", moveDrag);
  body.addEventListener("pointerup", () => { drag = null; });
  body.addEventListener("pointercancel", () => { drag = null; });
  body.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  fit();
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(fit);
    ro.observe(frame);
  }
  window.addEventListener("resize", fit);
}

/* ------------------------------------------------------------------ */
/* Visual editor — "trim" kind: a playable <video> with a draggable   */
/* in/out timeline (slide / touch / type) for trimming a clip.       */
/* ------------------------------------------------------------------ */
function vjsFmtTime(s) {
  if (!Number.isFinite(s)) return "0:00.0";
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
}
function mountTrimEditor(slot, videoEl, srcW, srcH, cfg) {
  // Trim is video-only: a playable <video> + a draggable in/out timeline.
  if (!videoEl) {
    slot.replaceChildren(
      el("p", { class: "small", text: "⚠ Trim plays a video file — add one above to set in/out points." }),
    );
    return;
  }
  // Let audio through while trimming (playback always starts on a click).
  videoEl.muted = false;
  videoEl.pause();

  const form = $("#toolForm");
  const startInput = form && form.querySelector("[name=start]");
  const endInput = form && form.querySelector("[name=end]");

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // Wait until a real duration is known before laying the timeline out.
  const ready =
    videoEl.duration && isFinite(videoEl.duration) && videoEl.duration > 0
      ? Promise.resolve()
      : new Promise((res) => videoEl.addEventListener("loadedmetadata", res, { once: true }));

  return ready.then(() => {
    const raw = videoEl.duration;
    const dur = (isFinite(raw) && raw > 0) ? raw : 0;
    if (!dur) {
      slot.replaceChildren(
        el("p", { class: "small", text: "⚠ Could not read the video duration." }),
      );
      return;
    }

    // --- read the initial in/out from the form (or sensible defaults) ---
    let start = clamp(Number(startInput && startInput.value) || 0, 0, dur);
    let end = clamp(Number(endInput && endInput.value) || dur, 0, dur);
    if (end <= start) end = dur; // degenerate guard

    // --- build the player ---
    slot.replaceChildren();

    const player = el("div", { class: "vjs-trim-player" });
    const vidWrap = el("div", { class: "vjs-trim-video" });
    vidWrap.appendChild(videoEl); // move the loaded <video> into the player
    player.appendChild(vidWrap);

    const controls = el("div", { class: "vjs-trim-controls" });
    const playBtn = el("button", { type: "button", class: "vjs-play-btn", title: "Play / Pause", text: "▶" });
    const loopBtn = el("button", { type: "button", class: "vjs-loop-btn", title: "Loop the trimming region", text: "⏏" });
    const timeEl = el("span", { class: "vjs-time", text: vjsFmtTime(0) + " / " + vjsFmtTime(dur) });
    controls.append(playBtn, loopBtn, timeEl);
    player.appendChild(controls);

    const timeline = el("div", { class: "vjs-trim-timeline" });
    const track = el("div", { class: "vjs-trim-track", "aria-label": "Drag the in/out handles to trim" });
    const fill = el("div", { class: "vjs-trim-fill" });
    const playhead = el("div", { class: "vjs-trim-playhead" });
    const inHandle = el("div", { class: "vjs-trim-handle vjs-trim-in", "data-handle": "start", title: "Start — drag to move" });
    const outHandle = el("div", { class: "vjs-trim-handle vjs-trim-out", "data-handle": "end", title: "End — drag to move" });
    track.append(fill, playhead, inHandle, outHandle);
    timeline.appendChild(track);
    player.appendChild(timeline);

    // In / Out / Length readouts (kept in sync live as you drag).
    const inVal = el("span", { class: "vjs-trim-val", text: vjsFmtTime(start) });
    const outVal = el("span", { class: "vjs-trim-val", text: vjsFmtTime(end) });
    const lenVal = el("span", { class: "vjs-trim-val", text: vjsFmtTime(end - start) });
    const summary = el("div", { class: "vjs-trim-summary" }, [
      el("span", { class: "vjs-trim-label", text: "In" }), inVal,
      el("span", { class: "vjs-trim-sep" }),
      el("span", { class: "vjs-trim-label", text: "Out" }), outVal,
      el("span", { class: "vjs-trim-sep" }),
      el("span", { class: "vjs-trim-label", text: "Len" }), lenVal,
    ]);
    player.appendChild(summary);
    slot.appendChild(player);

    // --- state + helpers ---
    let playing = false;
    let loop = false;
    let drag = null;
    const pct = (t) => (dur ? (t / dur) * 100 : 0);

    function syncVisual() {
      const ps = pct(start) || 0;
      const pe = pct(end) || 0;
      inHandle.style.left = ps + "%";
      outHandle.style.left = pe + "%";
      fill.style.left = ps + "%";
      fill.style.width = Math.max(0, pe - ps) + "%";
      inVal.textContent = vjsFmtTime(start);
      outVal.textContent = vjsFmtTime(end);
      lenVal.textContent = vjsFmtTime(end - start);
    }
    function writeForm() {
      writeEditorOutputs({ start: +start.toFixed(3), end: +end.toFixed(3) });
    }
    function setTimes(ns, ne) {
      start = clamp(ns, 0, dur);
      end = clamp(ne, 0, dur);
      if (start > end) start = end; // keep the in-point before the out-point
      syncVisual();
      writeForm();
    }
    syncVisual();
    writeForm();

    // --- playback ---
    playBtn.addEventListener("click", () => {
      if (videoEl.paused) videoEl.play().catch(() => {});
      else videoEl.pause();
    });
    function onPlay() { playBtn.textContent = "⏸"; playing = true; }
    function onPause() { playBtn.textContent = "▶"; playing = false; }
    videoEl.addEventListener("play", onPlay);
    videoEl.addEventListener("playing", onPlay);
    videoEl.addEventListener("pause", onPause);
    videoEl.addEventListener("ended", onPause);

    loopBtn.addEventListener("click", () => {
      loop = !loop;
      loopBtn.classList.toggle("is-on", loop);
      loopBtn.textContent = loop ? "↻ Loop on" : "⏏";
    });

    videoEl.addEventListener("timeupdate", () => {
      timeEl.textContent = vjsFmtTime(videoEl.currentTime) + " / " + vjsFmtTime(dur);
      playhead.style.left = pct(videoEl.currentTime) + "%";
      // Don't preview past the out-point — that's the boundary the user is trimming to.
      if (playing && end < dur && videoEl.currentTime >= end) {
        if (loop) videoEl.currentTime = start;
        else videoEl.pause();
      }
    });
    videoEl.addEventListener("seeked", () => {
      playhead.style.left = pct(videoEl.currentTime) + "%";
      timeEl.textContent = vjsFmtTime(videoEl.currentTime) + " / " + vjsFmtTime(dur);
    });

    // --- timeline: click to seek, drag handles to set in/out ---
    track.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".vjs-trim-handle")) return; // the handle owns this gesture
      e.preventDefault();
      const rect = track.getBoundingClientRect();
      const t = clamp(((e.clientX - rect.left) / rect.width) * dur, 0, dur);
      videoEl.currentTime = t;
    });

    function handleDown(e) {
      const h = e.target.closest(".vjs-trim-handle");
      if (!h) return;
      e.preventDefault();
      const rect = track.getBoundingClientRect();
      drag = { handle: h.dataset.handle, startRect: rect };
      track.setPointerCapture(e.pointerId);
    }
    function handleMove(e) {
      if (!drag) return;
      e.preventDefault();
      const t = clamp(((e.clientX - drag.startRect.left) / drag.startRect.width) * dur, 0, dur);
      if (drag.handle === "start") start = clamp(t, 0, end);
      else end = clamp(t, start, dur);
      syncVisual();
      // Scrub the preview to the boundary being dragged so the cut frame is visible.
      videoEl.currentTime = drag.handle === "start" ? start : end;
    }
    function handleUp() {
      if (!drag) return;
      drag = null;
      writeForm();
    }
    inHandle.addEventListener("pointerdown", handleDown);
    outHandle.addEventListener("pointerdown", handleDown);
    track.addEventListener("pointermove", handleMove);
    track.addEventListener("pointerup", handleUp);
    track.addEventListener("pointercancel", () => { drag = null; });

    // --- the number inputs below the editor: type exact times ---
    function onInputsChanged() {
      const ns = clamp(Number(startInput && startInput.value) || 0, 0, dur);
      const ne = clamp(Number(endInput && endInput.value) || dur, 0, dur);
      setTimes(ns, ne);
    }
    if (startInput) startInput.addEventListener("change", onInputsChanged);
    if (endInput) endInput.addEventListener("change", onInputsChanged);

    // Preview begins at the in-point.
    try { videoEl.currentTime = start; } catch (_) {}
    playhead.style.left = pct(start) + "%";
  });
}

function wireVisualEditor() {
  const editor = findEditorField();
  if (!editor) return;
  // Mark the page so CSS can switch the layout to a wider, single-column
  // arrangement (form + editor on top, result below).
  const layout = document.querySelector(".tool-layout");
  if (layout) layout.classList.add("editor-mode");
  document.body.classList.add("has-editor");

  const primary =
    (toolMeta.inputs || []).find((i) => !i.multiple) || (toolMeta.inputs || [])[0];
  if (!primary) return;
  const prev = uploadRefreshers[primary.name];
  uploadRefreshers[primary.name] = () => {
    if (prev) prev();
    setTimeout(mountVisualEditor, 0);
  };
  setTimeout(mountVisualEditor, 0);
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
  wireFieldVisibility();
  wireVisualEditor();

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
  const drop = $("#resultDrop");
  if (drop) drop.style.display = "none";
  media.replaceChildren();
  actions.replaceChildren();

  const ext = (filename.split(".").pop() || "").toLowerCase();
  const size = fmtBytes(blob.size);

  // Filename + size header (always shown so the user can confirm what
  // they're about to download — Replace-Audio and Merge tools need this).
  const head = el("div", { class: "results-summary" }, [
    el("span", { text: filename, title: filename }),
    el("span", { class: "muted-dim", text: ` · ${size}` }),
  ]);
  media.appendChild(head);

  // Inline preview — same .r-preview styling as the batch result rows
  // so audio/video/gif outputs scrub right above the download button.
  if (isVideoExt(ext)) {
    media.appendChild(
      el("div", { class: "r-preview-wrap" }, [
        el("video", {
          class: "r-preview",
          controls: "",
          preload: "metadata",
          src: lastBlobUrl,
          playsinline: "",
        }),
        el("button", {
          type: "button",
          class: "r-preview-toggle",
          title: "Hide preview",
          text: "✕",
          onclick: (e) => {
            const wrap = e.currentTarget.parentElement;
            wrap.hidden = true;
            const showBtn = wrap.parentElement.querySelector(".r-preview-show");
            if (showBtn) showBtn.hidden = false;
          },
        }),
      ]),
    );
  } else if (isAudioExt(ext)) {
    media.appendChild(
      el("div", { class: "r-preview-wrap" }, [
        el("audio", {
          class: "r-preview",
          controls: "",
          preload: "metadata",
          src: lastBlobUrl,
        }),
        el("button", {
          type: "button",
          class: "r-preview-toggle",
          title: "Hide preview",
          text: "✕",
          onclick: (e) => {
            const wrap = e.currentTarget.parentElement;
            wrap.hidden = true;
            const showBtn = wrap.parentElement.querySelector(".r-preview-show");
            if (showBtn) showBtn.hidden = false;
          },
        }),
      ]),
    );
  } else if (ext === "gif") {
    media.appendChild(
      el("div", { class: "r-preview-wrap" }, [
        el("img", {
          class: "r-preview",
          src: lastBlobUrl,
          alt: filename,
          loading: "lazy",
        }),
        el("button", {
          type: "button",
          class: "r-preview-toggle",
          title: "Hide preview",
          text: "✕",
          onclick: (e) => {
            const wrap = e.currentTarget.parentElement;
            wrap.hidden = true;
            const showBtn = wrap.parentElement.querySelector(".r-preview-show");
            if (showBtn) showBtn.hidden = false;
          },
        }),
      ]),
    );
  }

  // "Show preview" pill that appears after the user hides the player.
  if (isPlayableExt(ext)) {
    media.appendChild(
      el("button", {
        type: "button",
        class: "r-preview-show btn btn-sm",
        hidden: "",
        text: "▶ Show preview",
        onclick: (e) => {
          const wrap = e.currentTarget.parentElement.querySelector(".r-preview-wrap");
          if (wrap) {
            wrap.hidden = false;
            const m = wrap.querySelector("video, audio");
            if (m) m.load?.();
          }
          e.currentTarget.hidden = true;
        },
      }),
    );
  }

  // Actions: Download + Clear.
  actions.appendChild(
    el("a", {
      class: "btn btn-primary",
      href: lastBlobUrl,
      download: filename,
      text: "⬇️ Download",
    }),
  );
  actions.appendChild(
    el("button", {
      type: "button",
      class: "btn btn-sm",
      onclick: clearSingleResult,
      text: "🧹 Clear result",
    }),
  );

  setProgress(100);
  setStatus("Done ✔ — ready to download.", false);
}

/** Reset the single-output result panel back to its empty state. */
function clearSingleResult() {
  if (lastBlobUrl) {
    URL.revokeObjectURL(lastBlobUrl);
    lastBlobUrl = "";
  }
  const media = $("#resultMedia");
  const actions = $("#resultActions");
  const drop = $("#resultDrop");
  if (media) media.replaceChildren();
  if (actions) actions.replaceChildren();
  if (drop) drop.style.display = "";
  const bar = $("#progressWrap");
  if (bar) bar.hidden = true;
  setStatus("");
  setProgress(0);
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
    ...items.map((r) => {
      const rExt = (r.name.split(".").pop() || "").toLowerCase();
      const canPreview = r.url && isPlayableExt(rExt);
      // Inline media preview (audio / video / gif) — placed *above* the
      // download button so the user can scrub/listen before saving.
      const preview = canPreview
        ? isVideoExt(rExt)
          ? el("video", {
              class: "r-preview",
              controls: "",
              preload: "metadata",
              src: r.url,
              playsinline: "",
            })
          : rExt === "gif"
            ? el("img", {
                class: "r-preview",
                src: r.url,
                alt: r.name,
                loading: "lazy",
              })
            : el("audio", {
                class: "r-preview",
                controls: "",
                preload: "metadata",
                src: r.url,
              })
        : null;
      return el("div", { class: "r-row" }, [
        el("span", { class: "f-icon", text: oIcon }),
        el("div", { class: "f-meta" }, [
          (canPreview
            ? el("a", {
                class: "f-name link-like",
                href: r.url,
                target: "_blank",
                rel: "noopener",
                title: `Open ${r.name} in a new tab`,
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
        // Preview sits below the row's name + download — it expands the
        // row to full width so the player doesn't get squashed.
        ...(preview
          ? [
              el("div", { class: "r-preview-wrap" }, [
                preview,
                el("button", {
                  type: "button",
                  class: "r-preview-toggle",
                  title: "Hide preview",
                  text: "✕",
                  onclick: (e) => {
                    const wrap = e.currentTarget.parentElement;
                    const row = wrap.parentElement;
                    wrap.hidden = true;
                    const btn = row.querySelector(".r-preview-show");
                    if (btn) btn.hidden = false;
                  },
                }),
              ]),
              el("button", {
                type: "button",
                class: "r-preview-show btn btn-sm",
                hidden: "",
                text: "▶ Show preview",
                onclick: (e) => {
                  const row = e.currentTarget.parentElement;
                  const wrap = row.querySelector(".r-preview-wrap");
                  if (wrap) {
                    wrap.hidden = false;
                    const media = wrap.querySelector("video, audio");
                    if (media) media.load?.();
                  }
                  e.currentTarget.hidden = true;
                },
              }),
            ]
          : []),
      ]);
    }),
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