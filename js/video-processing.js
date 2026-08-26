"use strict";

/**
 * VideoProcessingManager
 * Real, browser-based video processing built on Canvas + MediaRecorder.
 * Implements: crop, resize, rotate, compress, convert, remove audio,
 * replace audio, and merge (concatenation) of video clips.
 *
 * Note: HTMLMediaElement.captureStream() + MediaRecorder are the only
 * dependency-free way to re-encode video in the browser. The output is
 * constrained to codecs/containers the current browser supports (WebM /
 * OGG / MP4 when H.264 is available).
 */
class VideoProcessingManager {
  constructor() {
    this.processing = false;
    this.cancelled = false;
    this.DEFAULT_BITS = 5_000_000;
    this.DEFAULT_AUDIO_BITS = 128_000;
  }

  notify(message) {
    if (window.NotificationManager && typeof window.NotificationManager.info === "function")
      window.NotificationManager.info(message);
    else if (window.App && typeof window.App.notify === "function")
      window.App.notify(message);
  }

  setProcessing(busy, label) {
    this.processing = busy;
    if (busy) this.cancelled = false;
    const start = document.getElementById("vpStartBtn");
    const cancel = document.getElementById("vpCancelBtn");
    const status = document.getElementById("vpStatus");
    if (start) {
      start.disabled = busy;
      start.textContent = busy ? label || "Processing..." : "Process";
    }
    if (cancel) cancel.disabled = busy;
    if (status && busy) status.textContent = "Preparing...";
    this.setProgress(0);
  }

  setProgress(pct) {
    if (isNaN(pct)) return;
    const bar = document.getElementById("vpProgress");
    if (bar) bar.value = Math.max(0, Math.min(100, pct));
    const status = document.getElementById("vpStatus");
    if (status) status.textContent = `${Math.round(pct)}%`;
  }

  cancel() {
    this.cancelled = true;
    this.notify("Processing cancelled");
  }

  // ------------------------------------------------------------------
  // MediaElement helpers
  // ------------------------------------------------------------------

  makeElement(tag, src, { muted = false, loop = false } = {}) {
    const el = document.createElement(tag);
    el.src = src;
    el.muted = muted;
    el.loop = loop;
    el.playsInline = true;
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    return el;
  }

  waitMetadata(el, label = "media") {
    return new Promise((resolve, reject) => {
      if (el.readyState >= 1) return resolve(el);
      const onMeta = () => {
        cleanup();
        resolve(el);
      };
      const onErr = () => {
        cleanup();
        reject(new Error(`Could not load ${label}`));
      };
      const cleanup = () => {
        el.removeEventListener("loadedmetadata", onMeta);
        el.removeEventListener("error", onErr);
      };
      el.addEventListener("loadedmetadata", onMeta);
      el.addEventListener("error", onErr);
      el.load();
    });
  }

  /** Current editable video source (from the player preview element). */
  getCurrentSource() {
    const el = window.PlayerManager?.currentElement;
    const src = el?.currentSrc || el?.src;
    if (src) return { src, element: el };
    const preview = document.getElementById("videoPreview");
    const psrc = preview?.currentSrc || preview?.src;
    if (psrc) return { src: psrc, element: preview };
    this.notify("Load a video clip before processing.");
    return null;
  }

  probe(src) {
    return new Promise((resolve, reject) => {
      const el = this.makeElement("video", src, { muted: true });
      this.waitMetadata(el)
        .then(() =>
          resolve({
            width: el.videoWidth || 640,
            height: el.videoHeight || 360,
            duration: el.duration || 0,
          }),
        )
        .catch(reject)
        .finally(() => {
          el.src = "";
          el.remove();
        });
    });
  }

  // ------------------------------------------------------------------
  // Encoding / output helpers
  // ------------------------------------------------------------------

  pickMime(format) {
    if (!window.MediaRecorder) return null;
    const candidates = {
      webm: ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"],
      mp4: ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=h264,mp4a.40.2", "video/mp4"],
      ogg: ["video/ogg;codecs=theora,vorbis", "video/ogg"],
      webmAudio: ["audio/webm;codecs=opus", "audio/webm"],
    };
    const list = candidates[format] || candidates.webm;
    for (const m of list) if (window.MediaRecorder.isTypeSupported(m)) return m;
    return null;
  }

  extensionFor(format, mime) {
    if (mime && mime.indexOf("mp4") !== -1) return "mp4";
    if (mime && mime.indexOf("ogg") !== -1) return "ogv";
    if (format === "mp4") return format;
    return "webm";
  }

  downloadBlob(blob, filename) {
    if (window.ExportManager && typeof window.ExportManager.downloadBlob === "function")
      return window.ExportManager.downloadBlob(blob, filename);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ------------------------------------------------------------------
  // Core engine — re-render a single clip to a canvas + MediaRecorder
  // ------------------------------------------------------------------

  runSingleClip({
    src,
    draw, // (ctx, video, outW, outH) => void
    outW,
    outH,
    format = "webm",
    videoBits = this.DEFAULT_BITS,
    audioBits = this.DEFAULT_AUDIO_BITS,
    keepAudio = true,
    replacementAudio = null,
  }) {
    const mime = this.pickMime(format);
    if (!mime) {
      this.notify("This browser cannot encode the requested format.");
      return Promise.resolve(null);
    }

    return new Promise(async (resolve) => {
      const video = this.makeElement("video", src, {
        muted: !keepAudio || replacementAudio,
      });
      const audioEl = replacementAudio
        ? this.makeElement("audio", replacementAudio, { loop: true })
        : null;

      try {
        await this.waitMetadata(video, "video");
        if (audioEl) await this.waitMetadata(audioEl, "audio");
      } catch (err) {
        this.notify(err.message);
        cleanupAll();
        return resolve(null);
      }

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(2, Math.round(outW));
      canvas.height = Math.max(2, Math.round(outH));
      const ctx = canvas.getContext("2d");

      const canvasStream = canvas.captureStream(30);
      const videoTrack = canvasStream.getVideoTracks()[0];
      const combined = new MediaStream(videoTrack ? [videoTrack] : []);

      let audioStream = null;
      if (audioEl) {
        audioStream = audioEl.captureStream();
        const at = audioStream.getAudioTracks()[0];
        if (at) combined.addTrack(at);
      } else if (keepAudio) {
        const vStream = video.captureStream();
        const at = vStream.getAudioTracks()[0];
        if (at) combined.addTrack(at);
      }

      const recorder = new MediaRecorder(combined, {
        mimeType: mime,
        videoBitsPerSecond: videoBits,
        audioBitsPerSecond: audioBits,
      });
      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };

      const duration = video.duration && isFinite(video.duration) ? video.duration : 0;
      video.addEventListener("timeupdate", () => {
        if (duration > 0) this.setProgress((video.currentTime / duration) * 100);
      });

      const cleanupAll = () => {
        try {
          video.pause();
          video.src = "";
          video.removeAttribute("src");
          video.load();
        } catch (e) {}
        if (audioEl) {
          try {
            audioEl.pause();
            audioEl.src = "";
          } catch (e) {}
        }
        combined.getTracks().forEach((t) => t.stop());
        if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
      };

      let finished = false;
      const markDone = () => {
        if (finished) return;
        finished = true;
        if (recorder.state !== "inactive") setTimeout(() => recorder.stop(), 120);
      };

      const loop = () => {
        if (finished || this.cancelled) {
          markDone();
          return;
        }
        if (!video.paused && !video.ended) {
          ctx.clearRect(0, 0, outW, outH);
          try {
            draw(ctx, video, outW, outH);
          } catch (e) {
            console.error(e);
          }
        }
        requestAnimationFrame(loop);
      };

      video.addEventListener("ended", markDone, { once: true });

      const blobPromise = new Promise((bResolve) => {
        recorder.onstop = () => {
          cleanupAll();
          try {
            bResolve(new Blob(chunks, { type: recorder.mimeType || mime }));
          } catch (err) {
            console.error(err);
            bResolve(null);
          }
        };
        recorder.onerror = (ev) => {
          console.error("Recorder error", ev.error);
          this.notify("Recording failed");
          try {
            recorder.stop();
          } catch (e) {}
          bResolve(null);
        };

        recorder.start(200);
        loop();

        const start = async () => {
          if (audioEl) {
            try {
              await audioEl.play();
            } catch (e) {
              audioEl.muted = true;
              audioEl.play().catch(() => {});
            }
          }
          try {
            await video.play();
          } catch (e) {
            video.muted = true;
            video.play().catch((e2) => {
              console.error("Could not play back", e2);
              markDone();
            });
          }
        };
        start();
      });

      const blob = await blobPromise;
      if (!blob) {
        resolve(null);
        return;
      }
      const ext = this.extensionFor(format, mime);
      resolve({ blob, ext });
    });
  }

  // ------------------------------------------------------------------
  // Public operations
  // ------------------------------------------------------------------

  async cropClip({ left = 0, top = 0, width, height }) {
    const src = this.getCurrentSource();
    if (!src) return;
    const probe = await this.probe(src.src);
    const w = Number(width) || probe.width - Number(left || 0);
    const h = height ? Number(height) : probe.height - Number(top || 0);
    if (w <= 0 || h <= 0) return this.notify("Invalid crop dimensions.");
    this.setProcessing(true, `Cropping → ${Math.round(w)}x${Math.round(h)}`);
    const draw = (ctx, video, ow, oh) =>
      ctx.drawImage(video, Number(left) || 0, Number(top) || 0, w, h, 0, 0, ow, oh);
    const out = await this.runSingleClip({
      src: src.src,
      draw,
      outW: w,
      outH: h,
      format: "webm",
    });
    this.finish(out, "cropped");
    return out;
  }

  async resizeClip({ width, height }) {
    const src = this.getCurrentSource();
    if (!src) return;
    const probe = await this.probe(src.src);
    let w = Number(width) || probe.width;
    let h = Number(height) || probe.height;
    if (w <= 0 || h <= 0) return this.notify("Invalid dimensions.");
    this.setProcessing(true, `Resizing to ${Math.round(w)}x${Math.round(h)}`);
    const draw = (ctx, video, ow, oh) =>
      ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, ow, oh);
    const out = await this.runSingleClip({
      src: src.src,
      draw,
      outW: w,
      outH: h,
      format: "webm",
    });
    this.finish(out, "resized");
    return out;
  }

  async rotateClip(degrees = 90) {
    const src = this.getCurrentSource();
    if (!src) return;
    const probe = await this.probe(src.src);
    const deg = ((Number(degrees) || 0) % 360 + 360) % 360;
    if (deg === 0) return this.notify("Nothing to rotate.");
    this.setProcessing(true, `Rotating ${deg}°`);
    const swap = deg === 90 || deg === 270;
    const outW = swap ? probe.height : probe.width;
    const outH = swap ? probe.width : probe.height;
    const rad = (deg * Math.PI) / 180;
    const draw = (ctx, video, ow, oh) => {
      ctx.save();
      ctx.translate(ow / 2, oh / 2);
      ctx.rotate(rad);
      ctx.drawImage(
        video,
        -video.videoWidth / 2,
        -video.videoHeight / 2,
        video.videoWidth,
        video.videoHeight,
      );
      ctx.restore();
    };
    const out = await this.runSingleClip({
      src: src.src,
      draw,
      outW,
      outH,
      format: "webm",
    });
    this.finish(out, "rotated");
    return out;
  }

  async compressClip(level = "medium") {
    const src = this.getCurrentSource();
    if (!src) return;
    const probe = await this.probe(src.src);
    const map = {
      low: { scale: 1, bits: 6_000_000 },
      medium: { scale: 0.75, bits: 2_500_000 },
      high: { scale: 0.6, bits: 1_200_000 },
    };
    const cfg = map[level] || map.medium;
    const outW = Math.max(2, Math.round(probe.width * cfg.scale));
    const outH = Math.max(2, Math.round(probe.height * cfg.scale));
    this.setProcessing(true, `Compressing (${level})`);
    const draw = (ctx, video, ow, oh) =>
      ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, ow, oh);
    const out = await this.runSingleClip({
      src: src.src,
      draw,
      outW,
      outH,
      format: "webm",
      videoBits: cfg.bits,
    });
    this.finish(out, "compressed");
    return out;
  }

  async convertClip(format = "webm") {
    const src = this.getCurrentSource();
    if (!src) return;
    const probe = await this.probe(src.src);
    const fmt = (format || "webm").toLowerCase();
    this.setProcessing(true, `Converting to ${fmt.toUpperCase()}`);
    const draw = (ctx, video, ow, oh) =>
      ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, ow, oh);
    const out = await this.runSingleClip({
      src: src.src,
      draw,
      outW: probe.width,
      outH: probe.height,
      format: fmt,
    });
    this.finish(out, `converted_${fmt}`);
    return out;
  }

  async removeAudioClip() {
    const src = this.getCurrentSource();
    if (!src) return;
    const probe = await this.probe(src.src);
    this.setProcessing(true, "Removing audio");
    const draw = (ctx, video, ow, oh) =>
      ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, ow, oh);
    const out = await this.runSingleClip({
      src: src.src,
      draw,
      outW: probe.width,
      outH: probe.height,
      format: "webm",
      keepAudio: false,
    });
    this.finish(out, "no_audio");
    return out;
  }

  async replaceAudioClip(audioFile) {
    const src = this.getCurrentSource();
    if (!src) return;
    if (!audioFile) return this.notify("Select an audio file to use as a replacement.");
    if (!audioFile.type || !audioFile.type.startsWith("audio/"))
      return this.notify("Please choose a valid audio file.");
    const probe = await this.probe(src.src);
    const audioUrl = URL.createObjectURL(audioFile);
    this.setProcessing(true, "Replacing audio");
    const draw = (ctx, video, ow, oh) =>
      ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, ow, oh);
    const out = await this.runSingleClip({
      src: src.src,
      draw,
      outW: probe.width,
      outH: probe.height,
      format: "webm",
      keepAudio: false,
      replacementAudio: audioUrl,
    });
    URL.revokeObjectURL(audioUrl);
    this.finish(out, "audio_replaced");
    return out;
  }

  async mergeClips(files) {
    if (!files || files.length < 2) {
      this.notify("Select at least two video files to merge.");
      return;
    }
    if (!window.MediaRecorder) return this.notify("MediaRecorder is not supported here.");
    const mime = this.pickMime("webm");
    if (!mime) return this.notify("Cannot encode output video.");

    this.setProcessing(true, "Merging videos");
    const urls = files.map((f) => URL.createObjectURL(f));

    // Gather segment durations for a coarse progress display.
    const durations = [];
    let totalDuration = 0;
    for (const u of urls) {
      try {
        const p = await this.probe(u);
        durations.push(p.duration || 0);
        totalDuration += p.duration || 0;
      } catch (e) {
        durations.push(0);
      }
    }

    const video = this.makeElement("video", urls[0]);
    try {
      await this.waitMetadata(video, "first video");
    } catch (e) {
      this.notify(e.message);
      urls.forEach((u) => URL.revokeObjectURL(u));
      this.finish(null);
      return;
    }

    const stream = video.captureStream();
    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: this.DEFAULT_BITS,
      audioBitsPerSecond: this.DEFAULT_AUDIO_BITS,
    });
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };

    const blob = await new Promise((resolve) => {
      let segIndex = 0;
      let elapsed = 0;

      const cleanup = () => {
        try {
          video.pause();
          video.src = "";
          video.remove();
        } catch (e) {}
        stream.getTracks().forEach((t) => t.stop());
      };

      const playNext = () => {
        if (this.cancelled || segIndex >= urls.length) {
          if (recorder.state !== "inactive") setTimeout(() => recorder.stop(), 150);
          return;
        }
        if (segIndex > 0) {
          video.src = urls[segIndex];
          video.load();
        }
        video.onended = () => {
          elapsed += durations[segIndex] || 0;
          const pct = totalDuration
            ? (elapsed / totalDuration) * 100
            : (segIndex / urls.length) * 100;
          this.setProgress(pct);
          segIndex += 1;
          playNext();
        };
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => {
            elapsed += durations[segIndex] || 0;
            segIndex += 1;
            playNext();
          });
        });
      };

      recorder.onstop = () => {
        cleanup();
        try {
          resolve(new Blob(chunks, { type: recorder.mimeType || mime }));
        } catch (e) {
          console.error(e);
          resolve(null);
        }
      };
      recorder.onerror = (ev) => {
        console.error("Merge recorder error", ev.error);
        cleanup();
        resolve(null);
      };

      recorder.start(200);
      playNext();
    });

    urls.forEach((u) => URL.revokeObjectURL(u));
    if (!blob) {
      this.finish(null);
      return;
    }
    this.finish({ blob, ext: this.extensionFor("webm", mime) }, "merged");
  }

  // ------------------------------------------------------------------
  // Post-processing: download + hand the result to the editor
  // ------------------------------------------------------------------

  async finish(out, label) {
    this.setProcessing(false);
    this.setProgress(0);
    if (!out) {
      this.notify("Processing cancelled or failed.");
      return;
    }
    const status = document.getElementById("vpStatus");
    if (status) status.textContent = "Done ✔";
    const file = `MediaNest-${label || "video"}-${Date.now()}.${out.ext}`;
    this.downloadBlob(out.blob, file);

    // Close the processing dialog now that we have a result.
    if (window.UIManager && typeof window.UIManager.hideModal === "function")
      window.UIManager.hideModal("videoProcessDialog");

    // Inject a new clip into the editor so the result can be previewed.
    const url = URL.createObjectURL(out.blob);
    const clip = {
      id: `clip-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      name: label || "processed",
      type: "video",
      src: url,
      duration: 0,
      thumbnail: null,
    };
    try {
      if (
        window.TimelineManager &&
        typeof window.TimelineManager.addClip === "function"
      ) {
        await window.TimelineManager.addClip(clip);
      }
    } catch (e) {
      console.error("Could not add processed clip", e);
    }
    try {
      if (
        window.PlayerManager &&
        typeof window.PlayerManager.setElementSource === "function"
      ) {
        window.PlayerManager.setElementSource(clip);
      }
    } catch (e) {
      console.error("Could not preview processed clip", e);
    }
    this.notify(`Saved & loaded: ${file}`);
  }
}

window.VideoProcessingManager = new VideoProcessingManager();