"use strict";

class PlayerManager {
  constructor() {
    this.videoElement = document.getElementById("videoPreview");
    this.audioElement = document.getElementById("audioPreview");
    this.currentElement = null;
    this.currentClip = null;
    this.isPlaying = false;
    this.playbackRate = 1;
    this.audioContext = null;
    this.sourceNodes = new WeakMap();
    this.gainNodes = new WeakMap();
    this.panNodes = new WeakMap();
    this.effectNodes = new WeakMap();
    this.fadeFrame = null;
    this.timelinePosition = 0;
    this.timelineTimer = null;
    this.timelinePlaying = false;
    this.timelineAudio = new Map();
    this.initElements();
  }

  initElements() {
    [this.videoElement, this.audioElement].forEach((el) => {
      if (!el) return;
      this.initMediaElement(el);
    });
  }

  initMediaElement(el) {
    el.controls = true;
    el.addEventListener("loadedmetadata", () => this.updateTimeDisplay());
    el.addEventListener("timeupdate", () => {
      this.updateTimeDisplay();
      this.applyClipGain();
    });
    el.addEventListener("play", () => {
      this.isPlaying = true;
      this.enableAudioProcessing();
    });
    el.addEventListener("pause", () => {
      this.isPlaying = false;
    });
    el.addEventListener("ended", () => {
      if (!this.timelinePlaying) this.onEnded();
    });
    el.addEventListener("error", () => this.handleMediaError());
  }

  ensurePreviewElement(type) {
    const isVideo = type === "video";
    const existing = isVideo ? this.videoElement : this.audioElement;
    if (existing) return existing;

    const id = isVideo ? "videoPreview" : "audioPreview";
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement(isVideo ? "video" : "audio");
      el.id = id;
      el.controls = true;
      const container =
        document.getElementById("previewContainer") || document.body;
      container.appendChild(el);

      if (isVideo) {
        el.style.display = "block";
        el.style.position = "relative";
        el.style.width = "100%";
        el.style.height = "100%";
        el.style.objectFit = "contain";
        el.style.zIndex = "10";
        el.style.backgroundColor = "#000";
        this.videoElement = el;
      } else {
        el.style.display = "none";
        el.style.position = "absolute";
        el.style.bottom = "20px";
        el.style.left = "50%";
        el.style.transform = "translateX(-50%)";
        this.audioElement = el;
      }
    }
    this.initMediaElement(el);
    return el;
  }

  setElementSource(clip) {
    return this.loadClip(clip);
  }

  loadCurrentElement() {
    const clip =
      window.TimelineManager?.getNextClip?.() ||
      window.TimelineManager?.getFirstClip?.();
    if (clip) this.loadClip(clip);
  }

  loadClip(clip) {
    if (!clip?.src) return false;
    this.pause();
    this.currentClip = clip;
    const isVideo = clip.type === "video";
    const el = this.ensurePreviewElement(isVideo ? "video" : "audio");
    this.currentElement = isVideo ? this.videoElement : this.audioElement;
    if (!el || !this.currentElement) return false;
    if (this.videoElement)
      this.videoElement.style.display = isVideo ? "block" : "none";
    if (this.audioElement)
      this.audioElement.style.display = isVideo ? "none" : "block";
    this.currentElement.src = clip.src;
    this.currentElement.playbackRate =
      Number(clip.playbackRate) || this.playbackRate;
    this.currentElement.muted = !!clip.muted;
    this.currentElement.load();
    this.applyClipGain();
    window.App?.notify?.(`Loaded ${clip.name || "media"}`);
    return true;
  }

  async play() {
    if (this.timelineClips().length > 0) return this.playTimeline();
    if (!this.currentElement) this.loadCurrentElement();
    if (!this.currentElement) return;
    try {
      await this.enableAudioProcessing();
      await this.currentElement.play();
      this.isPlaying = true;
    } catch (error) {
      window.App?.notify?.(`Play failed: ${error.message}`);
    }
  }

  pause() {
    if (this.timelinePlaying || this.timelineTimer) {
      this.timelinePlaying = false;
      this.isPlaying = false;
      if (this.timelineTimer) window.clearInterval(this.timelineTimer);
      this.timelineTimer = null;
      this.pauseTimelineMedia();
      return;
    }
    this.currentElement?.pause();
    this.isPlaying = false;
  }

  stop() {
    if (this.timelineClips().length > 0) {
      this.pause();
      this.timelinePosition = 0;
      this.seekTimelineMedia();
      this.updateTimeDisplay();
      return;
    }
    if (!this.currentElement) return;
    this.currentElement.pause();
    try {
      this.currentElement.currentTime = 0;
    } catch (_) {}
    this.isPlaying = false;
    this.applyClipGain();
    this.updateTimeDisplay();
  }

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
  }

  setVolume(volume, clip = this.currentClip) {
    const value = this.clamp(Number(volume), 0, 100) / 100;
    if (clip) clip.volume = value;
    if (this.currentElement && !this.audioContext)
      this.currentElement.volume = value;
    this.applyClipGain();
  }

  setMute(muted = true, clip = this.currentClip) {
    if (clip) clip.muted = !!muted;
    if (this.currentElement) this.currentElement.muted = !!muted;
    this.applyClipGain();
  }

  toggleMute(clip = this.currentClip) {
    const muted = !(clip?.muted ?? this.currentElement?.muted ?? false);
    this.setMute(muted, clip);
    return muted;
  }

  setPan(pan, clip = this.currentClip) {
    const value = this.clamp(Number(pan), -1, 1);
    if (clip) clip.pan = value;
    const node = this.panNodes.get(this.currentElement);
    if (node) node.pan.value = value;
  }

  setGain(gain, clip = this.currentClip) {
    const value = this.clamp(Number(gain), 0, 2);
    if (clip) clip.gain = value;
    this.applyClipGain();
  }

  setFadeIn(seconds, clip = this.currentClip) {
    if (!clip) return;
    clip.fadeIn = this.clamp(
      Number(seconds),
      0,
      Math.max(0, clip.duration - 0.05),
    );
    this.applyClipGain();
  }

  setFadeOut(seconds, clip = this.currentClip) {
    if (!clip) return;
    clip.fadeOut = this.clamp(
      Number(seconds),
      0,
      Math.max(0, clip.duration - 0.05),
    );
    this.applyClipGain();
  }

  getEffectiveGain() {
    const clip = this.currentClip;
    if (!clip || clip.muted) return 0;
    const base =
      this.clamp(Number(clip.volume ?? 1), 0, 1) *
      this.clamp(Number(clip.gain ?? 1), 0, 2);
    const t = this.getCurrentTime();
    const duration = Number(clip.duration || this.getDuration() || 0);
    let factor = 1;
    const fadeIn = Number(clip.fadeIn || 0);
    const fadeOut = Number(clip.fadeOut || 0);
    if (fadeIn > 0 && t < fadeIn) factor *= t / fadeIn;
    if (fadeOut > 0 && duration > 0 && t > duration - fadeOut)
      factor *= Math.max(0, (duration - t) / fadeOut);
    return this.clamp(base * factor, 0, 2);
  }

  applyClipGain() {
    if (!this.currentElement) return;
    const value = this.getEffectiveGain();
    const node = this.gainNodes.get(this.currentElement);
    if (node) node.gain.value = value;
    else this.currentElement.volume = this.clamp(value, 0, 1);
  }

  async ensureAudioGraph() {
    if (!this.currentElement) return;
    if (this.sourceNodes.has(this.currentElement)) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      if (!this.audioContext) this.audioContext = new Ctx();
      const source = this.audioContext.createMediaElementSource(
        this.currentElement,
      );
      const gain = this.audioContext.createGain();
      const pan = this.audioContext.createStereoPanner
        ? this.audioContext.createStereoPanner()
        : null;
      const bass = this.audioContext.createBiquadFilter();
      const treble = this.audioContext.createBiquadFilter();
      const compressor = this.audioContext.createDynamicsCompressor();
      bass.type = "lowshelf";
      bass.frequency.value = 180;
      treble.type = "highshelf";
      treble.frequency.value = 3500;
      source.connect(bass);
      bass.connect(treble);
      treble.connect(gain);
      gain.connect(compressor);
      if (pan) {
        compressor.connect(pan);
        pan.connect(this.audioContext.destination);
      } else compressor.connect(this.audioContext.destination);
      this.sourceNodes.set(this.currentElement, source);
      this.gainNodes.set(this.currentElement, gain);
      if (pan) this.panNodes.set(this.currentElement, pan);
      this.effectNodes.set(this.currentElement, { bass, treble, compressor });
      this.setPan(this.currentClip?.pan ?? 0);
      this.applyEffects();
      this.applyClipGain();
    } catch (error) {
      console.warn("Web Audio graph unavailable:", error);
    }
  }

  async enableAudioProcessing() {
    await this.ensureAudioGraph();
    if (this.audioContext?.state === "suspended")
      await this.audioContext.resume();
    this.applyClipGain();
  }

  setPlaybackRate(rate) {
    this.playbackRate = Number(rate) || 1;
    if (this.currentElement)
      this.currentElement.playbackRate = this.playbackRate;
    if (this.currentClip) this.currentClip.playbackRate = this.playbackRate;
  }

  applyEffects() {
    const nodes = this.effectNodes.get(this.currentElement);
    const effects = window.EffectsManager;
    if (!nodes || !effects) return;
    nodes.bass.gain.value = Number(effects.bassBoost) || 0;
    nodes.treble.gain.value = Number(effects.trebleBoost) || 0;
    nodes.compressor.threshold.value = Number(
      effects.compressorThreshold ?? -24,
    );
    nodes.compressor.ratio.value = Number(effects.compressorRatio ?? 4);
  }

  seek(time) {
    if (this.timelineClips().length > 0) {
      this.timelinePosition = this.clamp(
        Number(time) || 0,
        0,
        this.getDuration(),
      );
      this.seekTimelineMedia();
      this.updateTimeDisplay();
      return;
    }
    if (!this.currentElement) return;
    this.currentElement.currentTime = Math.max(
      0,
      Math.min(Number(time) || 0, this.getDuration() || 0),
    );
    this.applyClipGain();
    this.updateTimeDisplay();
  }

  timelineClips() {
    return window.TimelineManager?.getClips?.() || [];
  }

  getDuration() {
    if (this.timelineClips().length > 0)
      return Math.max(
        0,
        ...this.timelineClips().map((clip) => Number(clip.endTime) || 0),
      );
    return Number.isFinite(this.currentElement?.duration)
      ? this.currentElement.duration
      : 0;
  }

  getCurrentTime() {
    return this.timelineClips().length > 0
      ? this.timelinePosition
      : this.currentElement?.currentTime || 0;
  }

  async playTimeline() {
    if (this.timelinePlaying) return;
    if (this.timelinePosition >= this.getDuration()) this.timelinePosition = 0;
    this.timelinePlaying = true;
    this.isPlaying = true;
    await this.syncTimelineMedia();
    this.timelineTimer = window.setInterval(() => this.tickTimeline(), 50);
    this.tickTimeline();
  }

  async syncTimelineMedia() {
    const time = this.timelinePosition;
    for (const clip of this.timelineClips()) {
      const active = time >= clip.startTime && time < clip.endTime;
      if (clip.type === "video") {
        const v = this.ensurePreviewElement("video");
        if (!active) continue;
        if (this.currentElement !== v || v.src !== clip.src) {
          v.src = clip.src;
          v.load();
          this.currentElement = v;
        }
        if (Math.abs(v.currentTime - (time - clip.startTime)) > 0.25)
          v.currentTime = time - clip.startTime;
        v.style.display = "block";
        v.volume = this.clamp(Number(clip.volume ?? 1), 0, 1);
        v.muted = !!clip.muted;
        v.play().catch(() => {});
      } else {
        const media = this.getTimelineAudio(clip);
        if (active) {
          if (
            media.paused ||
            Math.abs(media.currentTime - (time - clip.startTime)) > 0.25
          )
            media.currentTime = Math.max(0, time - clip.startTime);
          media.volume = this.clamp(Number(clip.volume ?? 1), 0, 1);
          media.muted = !!clip.muted;
          media.play().catch(() => {});
        } else {
          media.pause();
        }
      }
    }
  }

  getTimelineAudio(clip) {
    let media = this.timelineAudio.get(clip.id);
    if (media) return media;
    media = document.createElement("audio");
    media.preload = "auto";
    media.src = clip.src;
    media.dataset.timelineClip = clip.id;
    media.style.display = "none";
    document.body.appendChild(media);
    this.timelineAudio.set(clip.id, media);
    return media;
  }

  pauseTimelineMedia() {
    this.videoElement?.pause();
    this.timelineAudio.forEach((media) => media.pause());
  }

  seekTimelineMedia() {
    this.timelineClips().forEach((clip) => {
      const offset = Math.max(0, this.timelinePosition - clip.startTime);
      if (clip.type === "video" && this.videoElement && this.videoElement.src === clip.src)
        this.videoElement.currentTime = offset;
      if (clip.type === "audio") {
        const media = this.getTimelineAudio(clip);
        media.currentTime = Math.min(offset, Number(clip.duration) || offset);
      }
    });
    if (this.timelinePlaying) this.syncTimelineMedia();
  }

  tickTimeline() {
    if (!this.timelinePlaying) return;
    this.timelinePosition = Math.min(
      this.getDuration(),
      this.timelinePosition + 0.05,
    );
    this.syncTimelineMedia();
    this.updateTimeDisplay();
    if (this.timelinePosition >= this.getDuration()) this.stop();
  }
  isElementReady() {
    return !!this.currentElement && this.currentElement.readyState >= 2;
  }
  onEnded() {
    this.isPlaying = false;
    this.updateTimeDisplay();
    window.TimelineManager?.onPlaybackEnded?.();
  }
  handleMediaError() {
    const error = this.currentElement?.error;
    if (error)
      window.App?.notify?.(
        `Media error (${error.code}). The browser may not support this format.`,
      );
  }

  updateTimeDisplay() {
    const current = document.getElementById("currentTime");
    const total = document.getElementById("totalTime");
    if (current) current.textContent = this.formatTime(this.getCurrentTime());
    if (total) total.textContent = this.formatTime(this.getDuration());
    const playhead = document.getElementById("playhead");
    if (playhead && this.getDuration() > 0)
      playhead.style.left = `${(this.getCurrentTime() / this.getDuration()) * 100}%`;
  }

  formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "00:00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
}

window.PlayerManager = new PlayerManager();
window.setClipVolume = (v) => window.PlayerManager.setVolume(v);
window.muteClip = () => window.PlayerManager.toggleMute();
window.setClipPan = (v) => window.PlayerManager.setPan(v);
window.setClipGain = (v) => window.PlayerManager.setGain(v);
window.setClipFadeIn = (v) => window.PlayerManager.setFadeIn(v);
window.setClipFadeOut = (v) => window.PlayerManager.setFadeOut(v);
window.enableAudioProcessing = () =>
  window.PlayerManager.enableAudioProcessing();
