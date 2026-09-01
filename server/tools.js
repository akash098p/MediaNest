"use strict";

const path = require("path");
const fs = require("fs");

/** Return ffmpeg "-i <path>" flags for one or more inputs. */
const I = (p) => ["-i", p];

/** Same extension as the first/selected input file. */
const sameExt = (f, fallback) =>
  (f && path.extname(f).replace(".", "")) || fallback || "mp3";

/** Audio codec lookup for the converter. */
const AUDIO_CODEC = {
  mp3: "libmp3lame",
  wav: "pcm_s16le",
  ogg: "libvorbis",
  flac: "flac",
  m4a: "aac",
  aac: "aac",
  opus: "libopus",
  wma: "wmav2",
};

/** Codecs where a -b:a flag makes sense (lossy). Lossless ignores it. */
const LOSSY_AUDIO = new Set(["mp3", "aac", "m4a", "ogg", "opus", "wma"]);

/**
 * Pick an output audio bitrate (kbps) that MIRRORS the source so converted
 * files stay roughly the same size instead of ballooning (800 KB → 3.5 MB).
 */
function autoAudioBitrate(media, fallbackKbps = 160, capKbps = 320) {
  const bps = (media && (media.audioBitrate || media.totalBitrate)) || 0;
  if (!bps) return fallbackKbps;
  let k = Math.round(bps / 1000);
  if (capKbps) k = Math.min(k, capKbps);
  return Math.max(32, k);
}

/** "-b:a Nk" pair only when the target container/codec is lossy. */
function audioRateArgs(ext, kbps) {
  return LOSSY_AUDIO.has(String(ext || "").toLowerCase())
    ? ["-b:a", `${kbps}k`]
    : [];
}

/** Source video bitrate in kbps (falls back to a sane default). */
function sourceVideoKbps(media, fallbackKbps = 2500) {
  const bps = (media && (media.videoBitrate || media.totalBitrate)) || 0;
  if (!bps) return fallbackKbps;
  return Math.max(100, Math.min(24000, Math.round(bps / 1000)));
}

/**
 * Tool registry.
 * Each entry:
 *   id, name, group, icon, description
 *   inputs: [ { name, label, accept, multiple? } ]
 *   fields: [ { name, label, type, options?, default?, min?, max?, step? } ]
 *   defaultExt, extensions (allowed output extensions, optional)
 *   build(ctx) -> { args, ext }
 *     ctx = { files:[{fieldname,path}], params:{...},
 *             file(name) -> path or first matching upload
 *             files(name) -> array of uploads, param(name) -> value }
 */
const tools = [];

// ============================================================
// AUDIO
// ============================================================

tools.push({
  id: "convert-audio",
  name: "Audio Converter",
  group: "Audio",
  icon: "icons/audio converter.png",
  description: "Convert audio between MP3, WAV, OGG, FLAC, M4A, AAC, OPUS and more.",
  inputs: [{ name: "audio", label: "Audio file", accept: "audio/*" }],
  fields: [
    { name: "format", label: "Output format", type: "select", options: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"] },
    { name: "bitrate", label: "Bitrate (Auto = match source)", type: "select", options: ["auto", "96", "128", "160", "192", "256", "320"] },
  ],
  defaultExt: "mp3",
  build(ctx) {
    const audio = ctx.file("audio");
    const format = ctx.param("format") || "mp3";
    const sel = ctx.param("bitrate") || "auto";
    const codec = AUDIO_CODEC[format] || "libmp3lame";
    const cap =
      format === "opus" ? 160 : format === "ogg" ? 256 : 320;
    const kbps =
      sel === "auto"
        ? autoAudioBitrate(ctx.media, 192, cap)
        : Math.min(cap, Number(sel) || 192);
    const args = [...I(audio), "-c:a", codec, ...audioRateArgs(format, kbps)];
    return { args, ext: format };
  },
});

tools.push({
  id: "add-image-to-audio",
  name: "Add Cover Art / MP4",
  group: "Audio",
  icon: "icons/add cover to audio.png",
  description: "Attach album art to MP3, or turn audio + image into an MP4 music video. Up to 5 audio + image pairs in one go.",
  // Up to 5 audio + image pairs. The form lets the user pick 1, 2, 3, 4, or 5
  // pairs and submit them all in one request. The server loops over each
  // populated pair and returns a list of outputs (the client bundles them
  // into one ZIP). Empty slots are silently skipped.
  inputs: [
    { name: "audio1", label: "Audio 1", accept: "audio/*" },
    { name: "image1", label: "Image 1 (cover / visual)", accept: "image/*" },
    { name: "audio2", label: "Audio 2 (optional)", accept: "audio/*" },
    { name: "image2", label: "Image 2 (optional)", accept: "image/*" },
    { name: "audio3", label: "Audio 3 (optional)", accept: "audio/*" },
    { name: "image3", label: "Image 3 (optional)", accept: "image/*" },
    { name: "audio4", label: "Audio 4 (optional)", accept: "audio/*" },
    { name: "image4", label: "Image 4 (optional)", accept: "image/*" },
    { name: "audio5", label: "Audio 5 (optional)", accept: "audio/*" },
    { name: "image5", label: "Image 5 (optional)", accept: "image/*" },
  ],
  fields: [
    // Custom 5-row editor — audio + image in each row, paired visually.
    // Mounted by mountCoverPairsEditor() in tools/tools.js when the form
    // is rendered for this tool. See server/tools.js:cover-pairs for the
    // emit / behaviour contract.
    { name: "_editor", label: "Pairs editor", type: "editor",
      editor: { kind: "cover-pairs", pairs: 5 } },
    { name: "mode", label: "Output type", type: "select", options: ["mp3", "mp4"] },
    { name: "w", label: "Video width (px)", type: "number", default: 1280, min: 16 },
    { name: "h", label: "Video height (px)", type: "number", default: 720, min: 16 },
  ],
  defaultExt: "mp4",
  build(ctx) {
    const mode = ctx.param("mode") || "mp4";
    const w = Number(ctx.param("w") || 1280);
    const h = Number(ctx.param("h") || 720);

    // Walk the 5 pairs, skip any with no audio (image without audio would
    // be invalid). One missing pair is fine; just stop at the first gap.
    const pairs = [];
    for (let i = 1; i <= 5; i++) {
      const audio = (ctx.files(`audio${i}`) || [])[0];
      const image = (ctx.files(`image${i}`) || [])[0];
      if (!audio && !image) continue;            // empty slot → skip
      if (!audio || !image) {
        throw new Error(
          `Pair ${i} is incomplete — it has ${audio ? "an audio" : "an image"} but no ` +
          `${audio ? "image" : "audio"} file.`,
        );
      }
      pairs.push({ audio, image, n: i });
    }
    if (!pairs.length) {
      throw new Error('Missing required file field: "audio1" / "image1".');
    }

    const scale =
      `scale=${w}:${h}:force_original_aspect_ratio=increase,` +
      `crop=${w}:${h},format=yuv420p`;
    const ak = Math.min(192, Math.max(64, autoAudioBitrate(ctx.media)));

    const outputs = pairs.map(({ audio, image, n }) => {
      const base = (audio.name || `pair${n}`).replace(/\.[^.]+$/, "");
      if (mode === "mp3") {
        // Pre-normalise the cover to a format the MP3 muxer + mjpeg
        // encoder can both accept.  Without this, ffmpeg can fail with
        // "Could not write header" / "vf#0:1 Error sending frames" when
        // the input image decodes to a pixel format mjpeg doesn't take
        // directly (RGBA, 16-bit, oddly-subsampled PNG / WebP / HEIC…).
        //
        //   * `format=yuvj420p`  → force the canonical embedded-art pix_fmt
        //   * `scale=...`        → only shrink (never enlarge) and clamp the
        //                          long edge to 1500px so the cover isn't
        //                          absurdly large in the ID3 tag.
        //   * `pad=...`          → round dimensions up to even numbers,
        //                          which some mjpeg builds require.
        //
        // Note: ffmpeg's filter-graph parser splits the chain on commas
        // and treats a `name=value` as terminated by the first comma.
        // To put a comma inside an expression value (e.g. `gt(iw,1500)`)
        // we have to escape it as `\,` so the chain-splitter ignores it.
        // The `if(gt(...))` form picks the smaller of (max, current) on
        // each axis independently, which is the correct "cap without
        // upscale" semantics; the `force_original_aspect_ratio=decrease`
        // then keeps the image's aspect ratio intact.
        const vf =
          "scale=w=if(gt(iw\\,1500)\\,1500\\,iw):h=if(gt(ih\\,1500)\\,1500\\,ih):" +
          "force_original_aspect_ratio=decrease:flags=lanczos," +
          "pad=ceil(iw/2)*2:ceil(ih/2)*2," +
          "format=yuvj420p";
        return {
          name: `${base}-cover.mp3`,
          args: [
            I(audio.path),
            I(image.path),
            "-map", "0:a:0",
            "-map", "1:v:0",
            "-vf", vf,
            "-c:a", "copy",
            "-c:v", "mjpeg",
            "-q:v", "3",
            "-disposition:v", "attached_pic",
            "-id3v2_version", "3",
          ],
          ext: "mp3",
        };
      }
      return {
        name: `${base}-video.mp4`,
        args: [
          I(image.path),
          I(audio.path),
          "-map", "0:v", "-map", "1:a",
          "-vf", scale,
          "-c:v", "libx264",
          "-preset", "medium",
          "-c:a", "aac",
          "-b:a", `${ak}k`,
          "-shortest",
          "-r", "30",
        ],
        ext: "mp4",
      };
    });

    // `outputs` (plural) tells server.js to produce a ZIP of all entries.
    // The first entry's ext drives the bundle name (handled server-side).
    return { outputs, ext: outputs[0].ext };
  },
});

tools.push({
  id: "change-speed",
  name: "Change Audio Speed",
  group: "Audio",
  icon: "icons/change audio speed.png",
  description: "Speed up or slow down audio without changing pitch.",
  inputs: [{ name: "audio", label: "Audio file", accept: "audio/*" }],
  fields: [
    // Frontend mounts a live Web-Audio preview and writes back to this field.
    { name: "_editor", label: "Editor", type: "editor",
      editor: { kind: "speed", emits: ["speed"] } },
    { name: "speed", label: "Speed (0.5x - 4.0x)", type: "number", default: 1.25, min: 0.25, max: 4, step: 0.05 },
  ],
  defaultExt: "mp3",
  build(ctx) {
    const audio = ctx.file("audio");
    let rate = Number(ctx.param("speed") || 1);
    rate = Math.max(0.25, Math.min(4, rate));
    const factors = [];
    let r = rate;
    while (r > 2) { factors.push(2); r /= 2; }
    while (r < 0.5) { factors.push(0.5); r /= 0.5; }
    factors.push(Number(r.toFixed(4)));
    const ff = factors.map((f) => `atempo=${f}`).join(",");
    const ext = sameExt(audio);
    return {
      args: [
        I(audio),
        "-filter:a", ff,
        ...audioRateArgs(ext, autoAudioBitrate(ctx.media)),
      ],
      ext,
    };
  },
});

tools.push({
  id: "change-pitch",
  name: "Change Pitch",
  group: "Audio",
  // TODO: swap in a dedicated icon (e.g. "icons/change pitch.png") once added.
  icon: "icons/audio compressor.png",
  description: "Shift the pitch up or down in semitones while keeping the original tempo — high quality.",
  inputs: [{ name: "audio", label: "Audio file", accept: "audio/*" }],
  fields: [
    // Frontend mounts a live Web-Audio preview (granular pitch worklet,
    // tempo-preserving) and writes the chosen semitones back into the
    // field below. The server only ever sees the plain number — the same
    // shape as the change-speed tool.
    { name: "_editor", label: "Editor", type: "editor",
      editor: { kind: "pitch", emits: ["semitones"] } },
    { name: "semitones", label: "Pitch shift (semitones)", type: "number", default: 2, min: -12, max: 12, step: 0.5,
      note: "+12 = one octave up, −12 = one octave down. 0 leaves the pitch untouched." },
    { name: "method", label: "Method", type: "select", default: "rubberband", options: [
        { value: "rubberband", text: "High quality (rubberband)" },
        { value: "rubberband-voice", text: "High quality — voice (preserves formants)" },
        { value: "standard", text: "Standard (faster, works on any FFmpeg)" },
      ] },
  ],
  defaultExt: "mp3",
  build(ctx) {
    const audio = ctx.file("audio");
    let st = Number(ctx.param("semitones"));
    if (!Number.isFinite(st)) st = 0;
    st = Math.max(-12, Math.min(12, st));
    const ext = sameExt(audio);

    // Nothing to shift — remux instead of re-encoding.
    if (Math.abs(st) < 0.005) {
      return { args: [I(audio), "-c", "copy"], ext };
    }

    // 1 semitone = 2^(1/12) (equal temperament).
    const ratio = Math.pow(2, st / 12);
    const method = ctx.param("method") || "rubberband";

    let filter;
    if (method === "standard") {
      // Classic resample trick: replaying the samples at a new rate changes
      // pitch AND speed (asetrate), so resample back to the original rate and
      // undo the tempo change with atempo — leaving only the pitch shifted.
      const sr = Math.max(8000, Math.round(ctx.media?.sampleRate || 44100));
      const factors = [];
      let r = 1 / ratio;
      while (r > 2) { factors.push(2); r /= 2; }
      while (r < 0.5) { factors.push(0.5); r *= 2; }
      factors.push(Number(r.toFixed(4)));
      filter =
        `asetrate=${Math.round(sr * ratio)},aresample=${sr},` +
        factors.map((f) => `atempo=${f}`).join(",");
    } else {
      // rubberband shifts pitch while leaving tempo untouched — the highest
      // quality option (pitchq=quality). Voice mode additionally preserves
      // the formants so a shifted voice still sounds like the same person.
      const formant = method === "rubberband-voice" ? ":formant=preserved" : "";
      filter = `rubberband=pitch=${ratio.toFixed(8)}:pitchq=quality${formant}`;
    }

    return {
      args: [
        I(audio),
        "-af", filter,
        ...audioRateArgs(ext, autoAudioBitrate(ctx.media)),
      ],
      ext,
    };
  },
});

tools.push({
  id: "reverse-audio",
  name: "Reverse Audio",
  group: "Audio",
  icon: "icons/reverse audio.png",
  description: "Play an audio file backwards — every sample is mirrored end-to-end.",
  inputs: [{ name: "audio", label: "Audio file", accept: "audio/*" }],
  // `areverse` is an in-memory filter (the whole track must be read first
  // to be re-emitted), so the output is re-encoded. We keep the source
  // container/codec to stay format-neutral (mirrors the change-speed tool).
  defaultExt: "mp3",
  build(ctx) {
    const audio = ctx.file("audio");
    const ext = sameExt(audio);
    return {
      args: [
        I(audio),
        "-af", "areverse",
        ...audioRateArgs(ext, autoAudioBitrate(ctx.media)),
      ],
      ext,
    };
  },
});

tools.push({
  id: "cut-audio",
  name: "Trim Audio",
  group: "Audio",
  icon: "icons/cut audio.png",
  description: "Extract a segment (start to end) from an audio file.",
  inputs: [{ name: "audio", label: "Audio file", accept: "audio/*" }],
  fields: [
    // 'editor' is a client-side hint: the frontend mounts a playable
    // <audio> with a draggable in/out timeline (the "trim" editor) and
    // writes the chosen numbers back into the 'start' / 'end' inputs
    // below. The server only ever sees the plain numbers — the same
    // shape as the video-trim tool, but the input is audio-only.
    { name: "_editor", label: "Trim editor", type: "editor",
      editor: { kind: "trim", emits: ["start", "end"], durationInput: "audio" } },
    { name: "start", label: "Start (seconds)", type: "number", default: 0, min: 0, step: 0.01 },
    { name: "end", label: "End (seconds, 0 = until the end)", type: "number", default: 0, min: 0, step: 0.01 },
  ],
  defaultExt: "mp3",
  build(ctx) {
    const audio = ctx.file("audio");
    let start = Number(ctx.param("start")) || 0;
    let end = Number(ctx.param("end")) || 0;
    // Guard against an inverted pair (start past end) if the user ever
    // submits the fields directly — ffmpeg -ss/-to with -c copy would
    // otherwise emit an empty/odd segment. A blank/zero end means
    // "until the end of the file", exactly like the old text-field
    // behaviour.
    if (end <= 0) end = (ctx.media && ctx.media.duration) || 0;
    if (end < start) [start, end] = [end, start];
    const args = ["-ss", String(start)];
    if (end > 0) args.push("-to", String(end));
    args.push(...I(audio));
    args.push("-c", "copy");
    return { args, ext: sameExt(audio) };
  },
});

tools.push({
  id: "increase-volume",
  name: "Increase / Decrease Volume",
  group: "Audio",
  icon: "icons/volumn control.png",
  description: "Raise or lower the loudness of an audio file.",
  inputs: [{ name: "audio", label: "Audio file", accept: "audio/*" }],
  fields: [
    // Frontend mounts a live Web-Audio preview and writes back to this field.
    { name: "_editor", label: "Editor", type: "editor",
      editor: { kind: "volume", emits: ["volume"] } },
    { name: "volume", label: "Gain (dB)", type: "number", default: 6, min: -30, max: 30, step: 1 },
  ],
  defaultExt: "mp3",
  build(ctx) {
    const audio = ctx.file("audio");
    const gain = Number(ctx.param("volume") || 6);
    const ext = sameExt(audio);
    return {
      args: [
        I(audio),
        "-filter:a", `volume=${gain}dB`,
        ...audioRateArgs(ext, autoAudioBitrate(ctx.media)),
      ],
      ext,
    };
  },
});

tools.push({
  id: "merge-audio",
  name: "Merge Audio (Concatenate)",
  group: "Audio",
  icon: "icons/merge audio.png",
  description: "Join multiple audio files end-to-end into a single track.",
  inputs: [{ name: "audio", label: "Audio files (in order)", accept: "audio/*", multiple: true }],
  defaultExt: "mp3",
  build(ctx) {
    const files = ctx.files("audio");
    const n = files.length;
    const flags = files.map((f) => I(f.path)).flat();
    const ins = files.map((_, i) => `[${i}:a]`).join("");
    return {
      args: [
        ...flags,
        "-filter_complex", `${ins}concat=n=${n}:v=0:a=1[aout]`,
        "-map", "[aout]",
        ...audioRateArgs("mp3", autoAudioBitrate(ctx.media)),
      ],
      ext: "mp3",
    };
  },
});

tools.push({
  id: "mix-audio",
  name: "Mix Audio",
  group: "Audio",
  icon: "icons/mix audio .png",
  description: "Mix multiple audio files together at the same time.",
  inputs: [{ name: "audio", label: "Audio files to mix", accept: "audio/*", multiple: true }],
  defaultExt: "mp3",
  build(ctx) {
    const files = ctx.files("audio");
    const n = Math.max(1, files.length);
    const flags = files.map((f) => I(f.path));
    const ins = files.map((_, i) => `[${i}:a]`).join("");
    return {
      args: [
        ...flags.flat(),
        "-filter_complex", `${ins}amix=inputs=${n}:duration=longest:normalize=0[aout]`,
        "-map", "[aout]",
        ...audioRateArgs("mp3", autoAudioBitrate(ctx.media)),
      ],
      ext: "mp3",
    };
  },
});

tools.push({
  id: "remove-noise",
  name: "Remove Noise",
  group: "Audio",
  icon: "icons/remove noises .png",
  description: "Reduce background hiss / static with FFmpeg's afftdn filter.",
  inputs: [{ name: "audio", label: "Audio file", accept: "audio/*" }],
  fields: [{ name: "noise", label: "Noise reduction (dB)", type: "number", default: -25, min: -40, max: -5, step: 1 }],
  defaultExt: "mp3",
  build(ctx) {
    const audio = ctx.file("audio");
    const nf = Number(ctx.param("noise") || -25);
    const ext = sameExt(audio);
    return {
      args: [
        I(audio),
        "-af", `afftdn=nf=${nf}`,
        ...audioRateArgs(ext, autoAudioBitrate(ctx.media)),
      ],
      ext,
    };
  },
});

tools.push({
  id: "remove-silence",
  name: "Remove Silence",
  group: "Audio",
  icon: "icons/remove silence.png",
  description: "Trim leading/trailing and long silent gaps from audio.",
  inputs: [{ name: "audio", label: "Audio file", accept: "audio/*" }],
  fields: [
    { name: "threshold", label: "Threshold (dB)", type: "number", default: -50, min: -80, max: -20, step: 1 },
    { name: "min", label: "Min silent gap (s)", type: "number", default: 0.5, min: 0, max: 5, step: 0.1 },
  ],
  defaultExt: "mp3",
  build(ctx) {
    const audio = ctx.file("audio");
    const th = Number(ctx.param("threshold") || -50);
    const min = Number(ctx.param("min") || 0.5);
    const ext = sameExt(audio);
    return {
      args: [
        I(audio),
        "-af",
        `silenceremove=start_periods=1:start_threshold=${th}dB:stop_periods=-1:stop_threshold=${th}dB:start_silence=${min}:stop_silence=${min}`,
        ...audioRateArgs(ext, autoAudioBitrate(ctx.media)),
      ],
      ext,
    };
  },
});

tools.push({
  id: "compress-audio",
  name: "Audio Compressor",
  group: "Audio",
  icon: "icons/audio compressor.png",
  description: "Shrink any audio file — targets a fraction of the source bitrate so output is always smaller.",
  inputs: [{ name: "audio", label: "Audio file (any format)", accept: "audio/*,video/*" }],
  needDuration: true,
  fields: [
    {
      name: "mode",
      label: "Compression mode",
      type: "select",
      options: [
        { value: "preset", text: "Preset level" },
        { value: "percent", text: "Percentage of original" },
        { value: "size", text: "Target size (KB / MB)" },
      ],
      default: "preset",
    },
    {
      name: "level",
      label: "Compression level",
      type: "select",
      options: ["light", "balanced", "strong", "extreme"],
      dependsOn: { field: "mode", value: "preset" },
    },
    {
      name: "percent",
      label: "Compress to (% of original size)",
      type: "number",
      default: 50,
      min: 5,
      max: 95,
      step: 5,
      dependsOn: { field: "mode", value: "percent" },
      note: "Output is kept at roughly this percentage of the original file size.",
    },
    {
      name: "sizeValue",
      label: "Target file size",
      type: "number",
      default: 2,
      min: 1,
      max: 512,
      step: 1,
      dependsOn: { field: "mode", value: "size" },
      note: "The output is sized toward this target; it never grows larger than the original.",
    },
    {
      name: "sizeUnit",
      label: "Size unit",
      type: "select",
      options: ["KB", "MB"],
      default: "MB",
      dependsOn: { field: "mode", value: "size" },
    },
    {
      name: "format",
      label: "Output format",
      type: "select",
      options: ["auto", "mp3", "m4a", "ogg", "opus"],
    },
    {
      name: "channels",
      label: "Channels",
      type: "select",
      options: ["keep", "mono"],
    },
  ],
  defaultExt: "mp3",
  build(ctx) {
    const audio = ctx.file("audio");
    const mode = ctx.param("mode") || "preset";
    const fmtSel = ctx.param("format") || "auto";
    const mono = (ctx.param("channels") || "keep") === "mono";

    // "Auto" keeps the source container if it is already compressed,
    // otherwise falls back to MP3.
    const srcExt = sameExt(audio, "").toLowerCase();
    const ext =
      fmtSel === "auto"
        ? LOSSY_AUDIO.has(srcExt)
          ? srcExt
          : "mp3"
        : fmtSel;
    const codec = AUDIO_CODEC[ext] || "libmp3lame";

    const srcKbps = Math.round(
      ((ctx.media?.audioBitrate || ctx.media?.totalBitrate || 0) / 1000),
    );
    const duration = ctx.duration || ctx.media?.duration || 0;

    const caps = {
      mp3: [32, 320],
      m4a: [24, 320],
      aac: [24, 320],
      ogg: [32, 256],
      opus: [16, 160],
      wma: [32, 192],
    };
    const [minK, maxK] = caps[ext] || [32, 320];
    const factors = { light: 0.8, balanced: 0.55, strong: 0.35, extreme: 0.22 };
    const fallbacks = { light: 160, balanced: 128, strong: 96, extreme: 64 };
    const level = ctx.param("level") || "balanced";

    // ----- Pick a target bitrate according to the chosen mode -----
    let kbps;
    if (mode === "size") {
      // Convert the requested KB/MB target into a matching audio bitrate
      // from the file's duration:  size = bitrate * seconds / 8
      const unit = String(ctx.param("sizeUnit") || "MB").toUpperCase();
      const val = Math.max(0, Number(ctx.param("sizeValue")) || 0);
      const bytes = unit === "KB" ? val * 1024 : val * 1024 * 1024;
      if (bytes > 0 && duration > 0) {
        kbps = (bytes * 8) / (duration * 1000);
      } else {
        kbps = srcKbps > 0 ? srcKbps * factors[level] : fallbacks[level];
      }
    } else if (mode === "percent") {
      // Output stays ~X% of the source size: bitrate scales with the %.
      const pct = Math.max(2, Math.min(100, Number(ctx.param("percent")) || 50));
      kbps = srcKbps > 0 ? (srcKbps * pct) / 100 : fallbacks[level];
    } else {
      // Preset level — bitrate = fraction of the SOURCE bitrate, so the
      // output is always smaller than the original.
      kbps = srcKbps > 0 ? Math.round(srcKbps * factors[level]) : fallbacks[level];
    }

    kbps = Math.round(kbps);
    if (srcKbps > 0) kbps = Math.min(kbps, srcKbps); // never bigger than source
    kbps = Math.max(minK, Math.min(maxK, kbps));

    const args = [
      I(audio),
      "-vn",
      "-c:a", codec,
      ...audioRateArgs(ext, kbps),
      ...(mono ? ["-ac", "1"] : []),
    ];
    return { args, ext };
  },
});

tools.push({
  id: "repair-m4a",
  name: "Repair M4A",
  group: "Audio",
  icon: "icons/repair m4a.png",
  description: "Rebuild a truncated or damaged M4A file by remuxing.",
  inputs: [{ name: "audio", label: "Damaged M4A file", accept: ".m4a,.mp4,audio/mp4" }],
  defaultExt: "m4a",
  build(ctx) {
    const audio = ctx.file("audio");
    const base = path.extname(audio).replace(".", "");
    return { args: [I(audio), "-c", "copy"], ext: (base || "m4a").toLowerCase() };
  },
});

tools.push({
  id: "audio-transition",
  name: "Audio Transition (Fade)",
  group: "Audio",
  icon: "icons/audio transition.png",
  description: "Apply smooth fade-in / fade-out transitions to a track.",
  needDuration: true,
  inputs: [{ name: "audio", label: "Audio file", accept: "audio/*" }],
  fields: [
    // Frontend mounts a live Web-Audio preview and writes back to these fields.
    { name: "_editor", label: "Editor", type: "editor",
      editor: { kind: "audio-transition", emits: ["fadeIn", "fadeOut"] } },
    { name: "fadeIn", label: "Fade-in (seconds)", type: "number", default: 2, min: 0 },
    { name: "fadeOut", label: "Fade-out (seconds)", type: "number", default: 2, min: 0 },
  ],
  defaultExt: "mp3",
  build(ctx) {
    const audio = ctx.file("audio");
    const fi = Number(ctx.param("fadeIn") || 0);
    const fo = Number(ctx.param("fadeOut") || 0);
    const dur = ctx.duration || 0;
    const filters = [];
    if (fi > 0) filters.push(`afade=t=in:st=0:d=${fi}`);
    if (fo > 0) {
      const start = Math.max(0, dur - fo);
      filters.push(`afade=t=out:st=${start.toFixed(3)}:d=${fo}`);
    }
    return {
      args: [
        I(audio),
        "-af", filters.length ? filters.join(",") : "anull",
        ...audioRateArgs(sameExt(audio), autoAudioBitrate(ctx.media)),
      ],
      ext: sameExt(audio),
    };
  },
});

// ============================================================
// VIDEO
// ============================================================

tools.push({
  id: "extract-audio",
  name: "Extract Audio from Video",
  group: "Video",
  icon: "icons/extract audio from video.png",
  description: "Pull out the audio track of a video and save it as an audio file.",
  inputs: [{ name: "video", label: "Video file", accept: "video/*" }],
  fields: [{ name: "format", label: "Audio format", type: "select", options: ["mp3", "wav", "aac", "m4a", "ogg", "flac"] }],
  defaultExt: "mp3",
  build(ctx) {
    const video = ctx.file("video");
    const fmt = ctx.param("format") || "mp3";
    const kbps = Math.min(256, Math.max(48, autoAudioBitrate(ctx.media, 192)));
    const args = [I(video), "-vn"];
    if (fmt === "wav") {
      args.push("-c:a", "pcm_s16le");
    } else {
      args.push("-c:a", AUDIO_CODEC[fmt] || "libmp3lame");
      args.push(...audioRateArgs(fmt, fmt === "opus" ? Math.min(kbps, 160) : kbps));
    }
    return { args, ext: fmt };
  },
});

tools.push({
  id: "remove-audio-from-video",
  name: "Remove Sound from Video",
  group: "Video",
  icon: "icons/remove sound from video.png",
  description: "Delete the audio track and create a silent video.",
  inputs: [{ name: "video", label: "Video file", accept: "video/*" }],
  defaultExt: "mp4",
  build(ctx) {
    const video = ctx.file("video");
    return { args: [I(video), "-an", "-c:v", "copy"], ext: sameExt(video, "mp4") };
  },
});

tools.push({
  id: "video-compress",
  name: "Video Compressor",
  group: "Video",
  icon: "icons/video compressor.png",
  description: "Reduce video file size — targets a fraction of the source bitrate so output is always smaller.",
  inputs: [{ name: "video", label: "Video file", accept: "video/*" }],
  needDuration: true,
  fields: [
    {
      name: "mode",
      label: "Compression mode",
      type: "select",
      options: [
        { value: "preset", text: "Preset level" },
        { value: "percent", text: "Percentage of original" },
        { value: "size", text: "Target size (KB / MB)" },
      ],
      default: "preset",
    },
    {
      name: "level",
      label: "Compression level",
      type: "select",
      options: ["light", "balanced", "strong", "extreme"],
      dependsOn: { field: "mode", value: "preset" },
    },
    {
      name: "percent",
      label: "Compress to (% of original size)",
      type: "number",
      default: 50,
      min: 10,
      max: 95,
      step: 5,
      dependsOn: { field: "mode", value: "percent" },
      note: "Output video bitrate is kept at roughly this percentage of the original.",
    },
    {
      name: "sizeValue",
      label: "Target file size",
      type: "number",
      default: 20,
      min: 1,
      max: 512,
      step: 1,
      dependsOn: { field: "mode", value: "size" },
      note: "Video bitrate is computed from the clip's duration to land near this target.",
    },
    {
      name: "sizeUnit",
      label: "Size unit",
      type: "select",
      options: ["KB", "MB"],
      default: "MB",
      dependsOn: { field: "mode", value: "size" },
    },
    { name: "scale", label: "Scale width (0 = keep original)", type: "number", default: 0, min: 0, step: 2 },
    { name: "format", label: "Container", type: "select", options: ["mp4", "webm"] },
  ],
  defaultExt: "mp4",
  build(ctx) {
    const video = ctx.file("video");
    const mode = ctx.param("mode") || "preset";
    const scale = Number(ctx.param("scale") || 0);
    const fmt = ctx.param("format") || "mp4";
    const duration = ctx.duration || ctx.media?.duration || 0;

    const srcVk = sourceVideoKbps(ctx.media);
    const srcAk = Math.min(160, Math.max(32, autoAudioBitrate(ctx.media, 128)));
    const level = ctx.param("level") || "balanced";
    const factor =
      level === "light" ? 0.8 : level === "extreme" ? 0.22 : level === "strong" ? 0.35 : 0.55;

    // ----- Pick video+audio bitrates according to the chosen mode -----
    let vk;
    let ak = srcAk;
    if (mode === "size") {
      // Budget = target bytes over the clip's duration; audio takes a share,
      // the rest goes to video. Never larger than the source.
      const unit = String(ctx.param("sizeUnit") || "MB").toUpperCase();
      const val = Math.max(0, Number(ctx.param("sizeValue")) || 0);
      const bytes = unit === "KB" ? val * 1024 : val * 1024 * 1024;
      if (bytes > 0 && duration > 0) {
        const totalK = Math.round((bytes * 8) / (duration * 1000));
        ak = Math.min(srcAk, Math.round(totalK * 0.15), 128);
        vk = Math.max(80, Math.round(totalK - ak));
      } else {
        vk = Math.round(srcVk * factor);
      }
    } else if (mode === "percent") {
      // Output ~X% of the source size: both streams scale with the %.
      const pct = Math.max(10, Math.min(100, Number(ctx.param("percent")) || 50));
      vk = Math.round(srcVk * (pct / 100));
      ak = Math.round(srcAk * (pct / 100));
    } else {
      // Preset level — fraction of the SOURCE bitrate, always smaller.
      vk = Math.round(srcVk * factor);
    }
    vk = Math.max(80, Math.min(Math.round(vk), srcVk));
    ak = Math.max(32, Math.min(Math.round(ak), srcAk));

    const args = [I(video)];
    if (scale > 0) args.push("-vf", `scale=${scale}:-2`);
    if (fmt === "webm") {
      args.push(
        "-c:v", "libvpx-vp9",
        "-b:v", `${vk}k`,
        "-row-mt", "1",
        "-c:a", "libopus",
        "-b:a", `${Math.min(ak, 128)}k`,
      );
    } else {
      if (scale > 0) args.push("-pix_fmt", "yuv420p");
      args.push(
        "-c:v", "libx264",
        "-preset", "medium",
        "-b:v", `${vk}k`,
        "-c:a", "aac",
        ...audioRateArgs("aac", ak),
      );
    }
    return { args, ext: fmt };
  },
});

// ============================================================
// GIF
// ============================================================

tools.push({
  id: "gif-compress",
  name: "GIF Compressor",
  group: "GIF",
  icon: "icons/gif compressor.png",
  description: "Reduce GIF size by scaling it down and lowering the frame rate.",
  inputs: [{ name: "gif", label: "GIF image", accept: ".gif,image/gif" }],
  fields: [
    {
      name: "mode",
      label: "Compression mode",
      type: "select",
      options: [
        { value: "preset", text: "Preset level" },
        { value: "percent", text: "Percentage of original" },
        { value: "size", text: "Target size (KB / MB)" },
      ],
      default: "preset",
    },
    {
      name: "level",
      label: "Compression level",
      type: "select",
      options: ["light", "balanced", "strong", "extreme"],
      dependsOn: { field: "mode", value: "preset" },
    },
    {
      name: "percent",
      label: "Compress to (% of original size)",
      type: "number",
      default: 50,
      min: 10,
      max: 95,
      step: 5,
      dependsOn: { field: "mode", value: "percent" },
      note: "Approximate — GIF size tracks pixel area, so dimensions are scaled down.",
    },
    {
      name: "sizeValue",
      label: "Target file size",
      type: "number",
      default: 1,
      min: 1,
      max: 512,
      step: 1,
      dependsOn: { field: "mode", value: "size" },
      note: "Approximate — dimensions are scaled to land near this size.",
    },
    {
      name: "sizeUnit",
      label: "Size unit",
      type: "select",
      options: ["KB", "MB"],
      default: "MB",
      dependsOn: { field: "mode", value: "size" },
    },
    { name: "scale", label: "Scale width (0 = keep)", type: "number", default: 480, min: 0, step: 1 },
    { name: "fps", label: "Frame rate", type: "number", default: 10, min: 1, max: 30, step: 1 },
  ],
  defaultExt: "gif",
  build(ctx) {
    const gif = ctx.file("gif");
    const mode = ctx.param("mode") || "preset";
    const media = ctx.media || {};
    const srcW = media.width || 0;

    let scale = Number(ctx.param("scale") || 480);
    let fps = Number(ctx.param("fps") || 10);

    if (mode === "preset") {
      // Levels combine a dimension + framerate cut for a simpler file.
      const l = {
        light: { s: 0.82, f: 0.72 },
        balanced: { s: 0.62, f: 0.5 },
        strong: { s: 0.45, f: 0.33 },
        extreme: { s: 0.28, f: 0.22 },
      }[ctx.param("level") || "balanced"] || { s: 0.62, f: 0.5 };
      scale = Math.max(8, Math.round(scale * l.s));
      fps = Math.max(1, Math.round(fps * l.f));
    } else {
      // target fraction of the original file to keep
      let factor; // 0 < factor <= 1
      if (mode === "percent") {
        factor = Math.max(0.05, Math.min(1, (Number(ctx.param("percent")) || 50) / 100));
      } else {
        const unit = String(ctx.param("sizeUnit") || "MB").toUpperCase();
        const val = Math.max(0, Number(ctx.param("sizeValue")) || 0);
        const target = unit === "KB" ? val * 1024 : val * 1024 * 1024;
        let srcBytes = 0;
        try { srcBytes = fs.statSync(gif).size || 0; } catch (e) {}
        factor = srcBytes > 0 ? Math.max(0.05, Math.min(1, target / srcBytes)) : 0.5;
      }
      // GIF size tracks pixel area; shrink dimensions by sqrt(factor).
      const s = Math.sqrt(factor);
      scale = srcW > 0
        ? Math.max(8, Math.round(srcW * s))
        : Math.max(8, Math.round(scale * s));
    }

    const vf = [];
    if (fps > 0) vf.push(`fps=${fps}`);
    if (scale > 0) vf.push(`scale=${scale}:-1:flags=lanczos`);
    return { args: [I(gif), "-vf", vf.length ? vf.join(",") : "null"], ext: "gif" };
  },
});

tools.push({
  id: "video-to-gif",
  name: "Video to GIF",
  group: "GIF",
  icon: "icons/video to gif.png",
  description: "Convert a video clip into an optimized animated GIF.",
  inputs: [{ name: "video", label: "Video file", accept: "video/*" }],
  fields: [
    { name: "fps", label: "Frame rate", type: "number", default: 12, min: 1, max: 30, step: 1 },
    { name: "scale", label: "Scale width (0 = keep)", type: "number", default: 480, min: 0, step: 1 },
  ],
  defaultExt: "gif",
  build(ctx) {
    const video = ctx.file("video");
    const fps = Number(ctx.param("fps") || 12);
    const scale = Number(ctx.param("scale") || 480);
    const vf = [
      `fps=${fps}`,
      `scale=${scale > 0 ? scale : -1}:-1:flags=lanczos`,
      "split[a][b]",
      "[a]palettegen[p]",
      "[b][p]paletteuse",
    ];
    return { args: [I(video), "-vf", vf.join(","), "-loop", "0"], ext: "gif" };
  },
});

tools.push({
  id: "gif-resize",
  name: "Resize GIF",
  group: "GIF",
  icon: "icons/gif resize and crop.png",
  description: "Resize an animated GIF to a new width and height (keeps aspect ratio unless you lock it).",
  inputs: [{ name: "gif", label: "GIF image", accept: ".gif,image/gif" }],
  fields: [
    // 'editor' is a client-side hint: the frontend mounts a visual
    // crop/resize/rotate canvas and writes back into the form fields
    // named in 'emits'. The server only ever sees the plain numbers.
    { name: "_editor", label: "Visual editor", type: "editor",
      editor: { kind: "resize", emits: ["width", "height"], lockAspect: true,
        presets: [
          { value: "original", text: "Original (no resize)" },
          { value: "320",      text: "Small · 320 px wide" },
          { value: "480",      text: "Medium · 480 px wide" },
          { value: "640",      text: "Large · 640 px wide" },
          { value: "854",      text: "HD-ready · 854 px wide" },
          { value: "custom",   text: "Custom…" },
        ],
        defaultPreset: "480" } },
    { name: "width",  label: "Width (px)",  type: "number", default: 480, min: 8, step: 2 },
    { name: "height", label: "Height (px, 0 = auto)", type: "number", default: 0, min: 0, step: 2 },
  ],
  defaultExt: "gif",
  build(ctx) {
    const gif = ctx.file("gif");
    const w = Math.max(8, Number(ctx.param("width")) || 480);
    const h = Number(ctx.param("height")) || 0;
    return { args: [I(gif), "-vf", `scale=${w}:${h > 0 ? h : -1}:flags=lanczos`], ext: "gif" };
  },
});

tools.push({
  id: "gif-crop",
  name: "Crop GIF",
  group: "GIF",
  icon: "icons/gif resize and crop.png",
  description: "Crop a region out of an animated GIF — pick standard aspect ratios or draw a free box.",
  inputs: [{ name: "gif", label: "GIF image", accept: ".gif,image/gif" }],
  fields: [
    { name: "_editor", label: "Visual editor", type: "editor",
      editor: { kind: "crop", emits: ["x", "y", "w", "h"],
        presets: [
          { value: "free",     text: "Free crop (drag the box)" },
          { value: "1:1",      text: "Square 1:1" },
          { value: "4:3",      text: "Standard 4:3" },
          { value: "16:9",     text: "Widescreen 16:9" },
          { value: "9:16",     text: "Vertical 9:16 (story / reel)" },
          { value: "3:2",      text: "Photo 3:2" },
          { value: "21:9",     text: "Cinematic 21:9" },
        ],
        defaultPreset: "free" } },
    { name: "w", label: "Crop width (px)",  type: "number", default: 320, min: 8 },
    { name: "h", label: "Crop height (px)", type: "number", default: 320, min: 8 },
    { name: "x", label: "Crop X (px)",      type: "number", default: 0,   min: 0 },
    { name: "y", label: "Crop Y (px)",      type: "number", default: 0,   min: 0 },
  ],
  defaultExt: "gif",
  build(ctx) {
    const gif = ctx.file("gif");
    const w = Math.max(8, Number(ctx.param("w")) || 320);
    const h = Math.max(8, Number(ctx.param("h")) || 320);
    const x = Math.max(0, Number(ctx.param("x")) || 0);
    const y = Math.max(0, Number(ctx.param("y")) || 0);
    return { args: [I(gif), "-vf", `crop=${w}:${h}:${x}:${y}`], ext: "gif" };
  },
});

tools.push({
  id: "gif-to-video",
  name: "GIF to Video",
  group: "GIF",
  icon: "icons/gif to video.png",
  description: "Convert an animated GIF into a shareable MP4, WebM or MOV video file.",
  inputs: [{ name: "gif", label: "GIF image", accept: ".gif,image/gif" }],
  fields: [
    { name: "format", label: "Output format", type: "select", options: ["mp4", "webm", "mov"] },
  ],
  defaultExt: "mp4",
  build(ctx) {
    const gif = ctx.file("gif");
    const fmt = ctx.param("format") || "mp4";
    // GIF dimensions are often odd — align to even pixels so yuv420p/VP9 never choke.
    const even = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
    if (fmt === "webm") {
      return {
        args: [I(gif), "-vf", even, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-row-mt", "1", "-an"],
        ext: "webm",
      };
    }
    const args = [
      I(gif),
      "-vf", even,
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-an",
    ];
    if (fmt === "mp4") args.push("-movflags", "+faststart");
    return { args, ext: fmt };
  },
});

tools.push({
  id: "images-to-gif",
  name: "Create GIF from Images",
  group: "GIF",
  icon: "icons/images to gif.png",
  description: "Build an animated GIF from a set of images, shown one after another in order.",
  inputs: [
    { name: "image", label: "Image files (in order)", accept: "image/*", multiple: true },
  ],
  fields: [
    { name: "delay", label: "Seconds per image", type: "number", default: 0.5, min: 0.05, step: 0.05 },
    { name: "fps", label: "Frame rate", type: "number", default: 15, min: 5, max: 30, step: 1 },
    { name: "width", label: "Canvas width (px)", type: "number", default: 480, min: 16, step: 2 },
    { name: "height", label: "Canvas height (px)", type: "number", default: 480, min: 16, step: 2 },
  ],
  defaultExt: "gif",
  build(ctx) {
    const imgs = ctx.files("image").map((f) => f.path);
    if (!imgs.length) throw new Error('Missing required file field: "image"');
    const delay = Math.max(0.05, Number(ctx.param("delay")) || 0.5);
    const fps = Math.min(30, Math.max(5, Number(ctx.param("fps")) || 15));
    const w = Math.max(16, Number(ctx.param("width")) || 480);
    const h = Math.max(16, Number(ctx.param("height")) || 480);

    // Every still becomes its own looping segment; all are fitted onto one
    // shared canvas (concat requires identical frame sizes everywhere).
    const chains = [];
    const labels = [];
    const preInput = [];
    for (let i = 0; i < imgs.length; i++) {
      // "-loop 1 -t <delay>" must sit right before its own input.
      preInput.push("-loop", "1", "-t", String(delay), ...I(imgs[i]));
      chains.push(
        `[${i}:v]fps=${fps},scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,` +
          `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[s${i}]`,
      );
      labels.push(`[s${i}]`);
    }

    const graph =
      chains.join(";") +
      ";" +
      `${labels.join("")}concat=n=${imgs.length}:v=1:a=0[c]` +
      ";[c]split[a][b]" +
      ";[a]palettegen[p]" +
      ";[b][p]paletteuse[out]";

    return {
      args: [...preInput, "-filter_complex", graph, "-map", "[out]", "-loop", "0"],
      ext: "gif",
    };
  },
});

// ============================================================
// EDITING TOOLS (grouped under VIDEO — same media type)
// ============================================================

tools.push({
  id: "video-convert",
  name: "Convert Video Format",
  group: "Video",
  icon: "icons/convert video format.png",
  description: "Transcode a video to MP4, WebM or MOV without bloating the file.",
  inputs: [{ name: "video", label: "Video file", accept: "video/*" }],
  fields: [
    { name: "format", label: "Format", type: "select", options: ["mp4", "webm", "mov"] },
    {
      name: "quality",
      label: "Quality (Auto = match source size)",
      type: "select",
      options: ["auto", "high", "balanced", "small"],
    },
  ],
  defaultExt: "mp4",
  build(ctx) {
    const video = ctx.file("video");
    const fmt = ctx.param("format") || "mp4";
    const quality = ctx.param("quality") || "auto";
    const srcVk = sourceVideoKbps(ctx.media);

    // Auto mirrors the source bitrate (small overhead) so converting
    // doesn't multiply the file size; named levels use CRF.
    const useAuto = quality === "auto" && ctx.media?.videoBitrate;
    const vk = Math.max(120, Math.round(srcVk * 1.05));
    const crf =
      quality === "high" ? 18 : quality === "small" ? 28 : 23;

    if (fmt === "webm") {
      const args = [I(video)];
      if (useAuto) {
        args.push("-c:v", "libvpx-vp9", "-b:v", `${vk}k`, "-row-mt", "1");
      } else {
        args.push("-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(crf), "-row-mt", "1");
      }
      args.push("-c:a", "libopus");
      return { args, ext: "webm" };
    }

    const args = [I(video)];
    if (!useAuto) args.push("-crf", String(crf));
    args.push(
      "-c:v", "libx264",
      "-preset", "medium",
      ...(useAuto ? ["-b:v", `${vk}k`] : []),
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      ...audioRateArgs("aac", Math.min(192, Math.max(64, autoAudioBitrate(ctx.media)))),
    );
    return { args, ext: fmt === "mov" ? "mov" : "mp4" };
  },
});

tools.push({
  id: "video-crop",
  name: "Crop Video",
  group: "Video",
  icon: "icons/crop video.png",
  description: "Crop a region out of a video — drag the box, or pick a standard aspect ratio.",
  inputs: [{ name: "video", label: "Video file", accept: "video/*" }],
  fields: [
    { name: "_editor", label: "Visual editor", type: "editor",
      editor: { kind: "crop", emits: ["x", "y", "w", "h"],
        presets: [
          { value: "free", text: "Free crop (drag the box)" },
          { value: "1:1",  text: "Square 1:1" },
          { value: "4:3",  text: "Standard 4:3" },
          { value: "16:9", text: "Widescreen 16:9" },
          { value: "9:16", text: "Vertical 9:16 (story / reel)" },
          { value: "3:2",  text: "Photo 3:2" },
          { value: "21:9", text: "Cinematic 21:9" },
        ],
        defaultPreset: "free" } },
    { name: "w", label: "Crop width (px)", type: "number", default: 640, min: 16 },
    { name: "h", label: "Crop height (px)", type: "number", default: 360, min: 16 },
    { name: "x", label: "Crop X (px)", type: "number", default: 0, min: 0 },
    { name: "y", label: "Crop Y (px)", type: "number", default: 0, min: 0 },
  ],
  defaultExt: "mp4",
  build(ctx) {
    const video = ctx.file("video");
    const w = ctx.param("w") || 640;
    const h = ctx.param("h") || 360;
    const x = ctx.param("x") || 0;
    const y = ctx.param("y") || 0;
    return { args: [I(video), "-vf", `crop=${w}:${h}:${x}:${y}`, "-c:a", "copy"], ext: "mp4" };
  },
});

tools.push({
  id: "video-resize",
  name: "Resize Video",
  group: "Video",
  icon: "icons/resize video.png",
  description: "Scale a video to new dimensions — pick a preset, keep aspect, or go custom.",
  inputs: [{ name: "video", label: "Video file", accept: "video/*" }],
  fields: [
    { name: "_editor", label: "Visual editor", type: "editor",
      editor: { kind: "resize", emits: ["width", "height"], lockAspect: true,
        presets: [
          { value: "original", text: "Original (no resize)" },
          { value: "320",      text: "Small · 320 px wide" },
          { value: "480",      text: "Medium · 480 px wide" },
          { value: "640",      text: "Standard · 640 px wide" },
          { value: "854",      text: "HD-ready · 854 px wide" },
          { value: "1280",     text: "HD · 1280 × 720" },
          { value: "1920",     text: "Full HD · 1920 × 1080" },
          { value: "1080p",    text: "Portrait 1080 × 1920" },
          { value: "custom",   text: "Custom…" },
        ],
        defaultPreset: "original" } },
    { name: "width",  label: "Width (px)",  type: "number", default: 1280, min: 16 },
    { name: "height", label: "Height (px, 0 = keep ratio)", type: "number", default: 0, min: 0 },
  ],
  defaultExt: "mp4",
  build(ctx) {
    const video = ctx.file("video");
    const w = ctx.param("width") || 1280;
    const h = ctx.param("height") || -1;
    return { args: [I(video), "-vf", `scale=${w}:${h}`, "-c:a", "copy"], ext: "mp4" };
  },
});

tools.push({
  id: "video-rotate",
  name: "Rotate Video",
  group: "Video",
  icon: "icons/rotate video.png",
  description: "Rotate a video to any angle, or pick a quick 90/180/270 preset.",
  inputs: [{ name: "video", label: "Video file", accept: "video/*" }],
  fields: [
    { name: "_editor", label: "Visual editor", type: "editor",
      editor: { kind: "rotate", emits: ["degrees"],
        presets: [
          { value: "0",   text: "0° (no rotation)" },
          { value: "90",  text: "90° clockwise" },
          { value: "180", text: "180°" },
          { value: "270", text: "90° counter-clockwise" },
          { value: "free",text: "Free angle (drag)" },
        ],
        defaultPreset: "free" } },
    { name: "degrees", label: "Degrees (any)", type: "number", default: 0, min: -360, max: 360, step: 1 },
  ],
  defaultExt: "mp4",
  build(ctx) {
    const video = ctx.file("video");
    // Free-angle rotation uses rotate (radians); 90-degree steps use transpose
    // (no quality loss). 0° short-circuits to a stream copy.
    const degRaw = Number(ctx.param("degrees") || 0);
    const deg = ((degRaw % 360) + 360) % 360; // normalize 0..360
    let vf = "copy"; // handled below
    if (deg === 0) {
      return { args: [I(video), "-c", "copy"], ext: "mp4" };
    } else if (Math.abs(deg - 90) < 0.5) {
      vf = "transpose=1";
    } else if (Math.abs(deg - 180) < 0.5) {
      vf = "transpose=1,transpose=1";
    } else if (Math.abs(deg - 270) < 0.5) {
      vf = "transpose=2";
    } else {
      const rad = (deg * Math.PI) / 180;
      vf = `rotate=${rad}:fillcolor=black:bilinear=0`;
    }
    return { args: [I(video), "-vf", vf, "-c:a", "copy"], ext: "mp4" };
  },
});

tools.push({
  id: "video-flip",
  name: "Flip Video",
  group: "Video",
  icon: "icons/flip video.png",
  description: "Mirror a video horizontally, vertically, or both — perfect for selfies and re-orienting footage.",
  inputs: [{ name: "video", label: "Video file", accept: "video/*" }],
  fields: [
    {
      name: "flip",
      label: "Flip direction",
      type: "select",
      options: [
        { value: "horizontal", text: "Horizontal (mirror left ↔ right)" },
        { value: "vertical",   text: "Vertical (mirror top ↔ bottom)" },
        { value: "both",       text: "Both (180° rotation by flipping)" },
      ],
      default: "horizontal",
    },
  ],
  defaultExt: "mp4",
  build(ctx) {
    const video = ctx.file("video");
    const mode = ctx.param("flip") || "horizontal";
    // hflip / vflip are lossless pixel shuffles, so we copy the audio
    // stream straight through. "both" chains them into a 180° mirror.
    let vf;
    if (mode === "vertical") vf = "vflip";
    else if (mode === "both") vf = "hflip,vflip";
    else vf = "hflip"; // default → horizontal
    return { args: [I(video), "-vf", vf, "-c:a", "copy"], ext: "mp4" };
  },
});

tools.push({
  id: "video-reverse",
  name: "Reverse Video",
  group: "Video",
  icon: "icons/reverse video.png",
  description: "Play a video backwards — both the picture and its soundtrack are reversed end-to-end.",
  inputs: [{ name: "video", label: "Video file", accept: "video/*" }],
  defaultExt: "mp4",
  build(ctx) {
    const video = ctx.file("video");
    // The `reverse` filter (video) and `areverse` filter (audio) both need
    // to read the whole stream first, so the video is re-encoded with
    // libx264 / aac. `areverse` only operates on the first audio stream
    // which is fine for the typical single-track case.
    return {
      args: [
        I(video),
        "-vf", "reverse",
        "-af", "areverse",
        "-c:v", "libx264",
        "-preset", "medium",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        ...audioRateArgs("aac", Math.min(192, Math.max(64, autoAudioBitrate(ctx.media)))),
      ],
      ext: "mp4",
    };
  },
});

tools.push({
  id: "speed-video",
  name: "Speed Video",
  group: "Video",
  // TODO: swap in a dedicated icon (e.g. "icons/speed video.png") once added.
  icon: "icons/change audio speed.png",
  description: "Speed a video up or slow it down (0.25× – 4×) — picture and soundtrack stay in sync.",
  inputs: [{ name: "video", label: "Video file", accept: "video/*" }],
  fields: [
    { name: "speed", label: "Speed factor", type: "number", default: 1.5, min: 0.25, max: 4, step: 0.05,
      note: "2 = twice as fast (half the length) · 0.5 = half speed (twice the length)." },
    { name: "audio", label: "Sound", type: "select", options: ["keep (pitch preserved)", "mute"] },
  ],
  defaultExt: "mp4",
  build(ctx) {
    const video = ctx.file("video");
    let rate = Number(ctx.param("speed"));
    if (!Number.isFinite(rate) || rate <= 0) rate = 1;
    rate = Math.round(Math.max(0.25, Math.min(4, rate)) * 100) / 100;
    const mute = String(ctx.param("audio") || "").startsWith("mute");

    // Video timing: dividing PTS by the factor makes the clip play faster.
    // Audio: the same atempo chain as the audio speed tool — it time-stretches
    // (pitch stays natural) so picture and sound remain in sync. ffmpeg
    // safely ignores -af when the source has no audio track.
    const factors = [];
    let r = rate;
    while (r > 2) { factors.push(2); r /= 2; }
    while (r < 0.5) { factors.push(0.5); r /= 0.5; }
    factors.push(Number(r.toFixed(4)));

    const args = [I(video), "-vf", `setpts=PTS/${rate}`];
    if (mute) {
      args.push("-an");
    } else {
      args.push("-af", factors.map((f) => `atempo=${f}`).join(","));
    }
    args.push(
      "-c:v", "libx264",
      "-preset", "medium",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
    );
    if (!mute) {
      args.push(
        "-c:a", "aac",
        ...audioRateArgs("aac", Math.min(192, Math.max(64, autoAudioBitrate(ctx.media)))),
      );
    }
    return { args, ext: "mp4" };
  },
});

tools.push({
  id: "video-trim",
  name: "Trim Video",
  group: "Video",
  icon: "icons/trim video.png",
  description: "Cut a start to end segment from a video.",
  inputs: [{ name: "video", label: "Video file", accept: "video/*" }],
  fields: [
    // 'editor' is a client-side hint: the frontend mounts a playable <video>
    // with a draggable in/out timeline (the "trim" editor) and writes the
    // chosen numbers back into the 'start' / 'end' inputs below. The server
    // only ever sees the plain numbers.
    { name: "_editor", label: "Trim editor", type: "editor",
      editor: { kind: "trim", emits: ["start", "end"], durationInput: "video" } },
    { name: "start", label: "Start (seconds)", type: "number", default: 0, min: 0, step: 0.01 },
    { name: "end", label: "End (seconds)", type: "number", default: 10, min: 0, step: 0.01 },
  ],
  defaultExt: "mp4",
  build(ctx) {
    const video = ctx.file("video");
    let start = Number(ctx.param("start")) || 0;
    let end = Number(ctx.param("end")) || 10;
    // Guard against an inverted pair (start past end) if the user ever submits
    // the fields directly — ffmpeg -ss/-to with -c copy would otherwise emit
    // an empty/odd segment.
    if (end < start) [start, end] = [end, start];
    return {
      args: [
        "-ss", String(start),
        "-to", String(end),
        ...I(video),
        "-c", "copy",
      ],
      ext: "mp4",
    };
  },
});

tools.push({
  id: "video-merge",
  name: "Merge Videos",
  group: "Video",
  icon: "icons/merge video.png",
  description: "Concatenate multiple videos into a single file.",
  inputs: [{ name: "video", label: "Video files (in order)", accept: "video/*", multiple: true }],
  defaultExt: "mp4",
  build(ctx) {
    const files = ctx.files("video");
    const n = files.length;
    const inputs = files.map((f) => I(f.path));
    const ins = files.map((_, i) => `[${i}:v]`).join("");
    return {
      args: [
        ...inputs.flat(),
        "-filter_complex",
        `${ins}concat=n=${n}:v=1:a=0[outv]`,
        "-map", "[outv]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
      ],
      ext: "mp4",
    };
  },
});

tools.push({
  id: "replace-audio",
  name: "Replace Audio in Video",
  group: "Video",
  icon: "icons/replace audio in video.png",
  description: "Swap the audio track of a video with a new audio file.",
  inputs: [
    { name: "video", label: "Video file", accept: "video/*" },
    { name: "audio", label: "Replacement audio", accept: "audio/*" },
  ],
  defaultExt: "mp4",
  build(ctx) {
    const video = ctx.file("video");
    const audio = ctx.file("audio");
    const ak = Math.min(192, Math.max(64, autoAudioBitrate(ctx.media)));
    return {
      args: [
        I(video),
        I(audio),
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", `${ak}k`,
        "-shortest",
      ],
      ext: "mp4",
    };
  },
});

module.exports = { tools, getById, publicList };

function getById(id) {
  return tools.find((t) => t.id === id) || null;
}

function publicList() {
  return tools.map((t) => ({
    id: t.id,
    name: t.name,
    group: t.group,
    icon: t.icon,
    description: t.description,
    inputs: t.inputs || [],
    fields: (t.fields || []).map((f) => ({
      name: f.name,
      label: f.label,
      type: f.type,
      options: f.options,
      default: f.default,
      min: f.min,
      max: f.max,
      step: f.step,
      dependsOn: f.dependsOn,
      note: f.note,
      editor: f.editor,
    })),
    defaultExt: t.defaultExt,
  }));
}