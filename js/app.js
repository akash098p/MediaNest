"use strict";

/**
 * MediaNest - Premium Browser-Based Editor
 * Main Application Controller
 */

class App {
  constructor() {
    this.isInitialized = false;
    this.initializedManagers = {};
    this.initialize();
  }

  async initialize() {
    try {
      console.log("🎬 Initializing MediaNest...");
      this.showLoading("Starting up...");
      await this.loadInspectorScript();
      await this.initManagers();
      this.setupDOM();
      this.loadTheme();
      this.initUI();
      // Start with a fresh, empty project (do not auto-restore the last
      // project's clips/media into the library and timeline).
      this.isInitialized = true;
      this.hideLoading();
      this.notify("🎉 Welcome to MediaNest!", "success");
      console.log("✅ MediaNest initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize:", error);
      this.hideLoading();
      this.notify(`Failed to initialize: ${error.message}`, "error");
    }
  }

  loadInspectorScript() {
    if (window.InspectorManager) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-sonic-inspector]");
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "js/inspector.js";
      script.dataset.sonicInspector = "true";
      script.onload = resolve;
      script.onerror = () =>
        reject(new Error("Could not load Inspector module"));
      document.head.appendChild(script);
    });
  }

  async initManagers() {
    this.initializedManagers.notification = new NotificationManager();
    this.initializedManagers.storage = new StorageManager();
    window.NotificationManager = this.initializedManagers.notification;
    window.StorageManager = this.initializedManagers.storage;
    this.initializedManagers.player =
      window.PlayerManager || new PlayerManager();
    this.initializedManagers.timeline =
      window.TimelineManager || new TimelineManager();
    this.initializedManagers.editor =
      window.EditorManager || new EditorManager();
    this.initializedManagers.effects =
      window.EffectsManager || new EffectsManager();
    this.initializedManagers.recorder =
      window.RecorderManager || new RecorderManager();
    this.initializedManagers.export =
      window.ExportManager || new ExportManager();
    window.PlayerManager = this.initializedManagers.player;
    window.TimelineManager = this.initializedManagers.timeline;
    window.EditorManager = this.initializedManagers.editor;
    window.EffectsManager = this.initializedManagers.effects;
    window.RecorderManager = this.initializedManagers.recorder;
    window.ExportManager = this.initializedManagers.export;
  }

  setupDOM() {
    const videoPreview = document.getElementById("videoPreview");
    const audioPreview = document.getElementById("audioPreview");
    if (videoPreview) {
      videoPreview.style.display = "block";
      videoPreview.style.position = "relative";
      videoPreview.style.width = "100%";
      videoPreview.style.height = "100%";
      videoPreview.style.objectFit = "contain";
      videoPreview.controls = true;
      videoPreview.style.zIndex = "10";
      videoPreview.style.backgroundColor = "#000";
    }
    if (audioPreview) {
      audioPreview.style.display = "none";
      audioPreview.style.position = "absolute";
      audioPreview.style.bottom = "20px";
      audioPreview.style.left = "50%";
      audioPreview.style.transform = "translateX(-50%)";
      audioPreview.controls = true;
    }
  }

  loadTheme() {
    const savedTheme = localStorage.getItem("medianest_theme") || "Dark";
    document.body.setAttribute("data-theme", savedTheme.toLowerCase());
    const themeSelector = document.getElementById("themeSelector");
    if (themeSelector) themeSelector.value = savedTheme;
  }

  initUI() {
    this.initializedManagers.ui = new UIManager();
    window.UIManager = this.initializedManagers.ui;
    this.initializedManagers.ui.init();
    this.initializedManagers.inspector = window.InspectorManager || null;
    if (this.initializedManagers.inspector?.render)
      this.initializedManagers.inspector.render();
  }

  loadLastProject() {
    // Fresh-open behavior: deliberately do not restore the previously saved
    // project's clips/media into the timeline or Media Library.
  }

  showLoading(message) {
    const loadingScreen = document.getElementById("loadingScreen");
    if (loadingScreen) {
      loadingScreen.style.display = "flex";
      const p = loadingScreen.querySelector("p");
      if (p) p.textContent = message;
    }
  }

  hideLoading() {
    const loadingScreen = document.getElementById("loadingScreen");
    if (loadingScreen) loadingScreen.style.display = "none";
  }

  notify(message, type = "info") {
    if (this.initializedManagers.notification)
      this.initializedManagers.notification.info(message);
    else console.log(`[${type}] ${message}`);
  }

  exportProject(format = "MP4", quality = "High") {
    if (this.initializedManagers.export) {
      this.initializedManagers.export.setFormat(format);
      this.initializedManagers.export.setQuality(quality);
      this.initializedManagers.export.exportProject();
    }
  }

  startRecording(type = "microphone") {
    if (this.initializedManagers.recorder) {
      if (type === "screen")
        this.initializedManagers.recorder.startScreenRecording();
      else this.initializedManagers.recorder.startRecording();
    }
  }

  stopRecording() {
    if (this.initializedManagers.recorder)
      this.initializedManagers.recorder.stopRecording();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.App = new App();
});
window.notify = (msg) => window.App?.notify?.(msg);
