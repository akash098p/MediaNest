"use strict";

class UIManager {
  constructor() {
    this.sidebar = document.getElementById("leftSidebar");
    this.workspace = document.getElementById("workspace");
    this.timelineWorkspace = document.getElementById("timelineWorkspace");
    this.effectsWorkspace = document.getElementById("effectsWorkspace");
    this.recordingWorkspace = document.getElementById("recordingWorkspace");
    this.projectWorkspace = document.getElementById("projectWorkspace");
    this.appearanceWorkspace = document.getElementById("appearanceWorkspace");
    this.clipInspector = document.getElementById("clipInspector");
    this.fileProcessing = false;
    this.initEventListeners();
  }

  init() {
    console.log("UI Manager Ready - Premium Version");
    if (
      !this.workspace ||
      !this.timelineWorkspace ||
      !this.effectsWorkspace ||
      !this.recordingWorkspace ||
      !this.projectWorkspace ||
      !this.clipInspector ||
      !this.appearanceWorkspace
    ) {
      throw new Error(
        "UIManager failed to initialize: missing workspace sections",
      );
    }
    this.showWorkspace("workspace");
    this.setupPremiumFeatures();
  }

  setupPremiumFeatures() {
    // Premium features initialization
    this.setupPremiumTooltips();
    this.initPremiumScrollbars();
    this.setupSmartAnimation();
    this.initPremiumKeyboardShortcuts();
  }

  setupPremiumTooltips() {
    // Custom tooltips with premium styling
    document.querySelectorAll("[title]").forEach((element) => {
      element.addEventListener("mouseenter", (e) => {
        this.showPremiumTooltip(e.target, e.target.title);
      });
    });
  }

  showPremiumTooltip(target, text) {
    const tooltip = document.createElement("div");
    tooltip.className = "premium-tooltip";
    tooltip.textContent = text;
    document.body.appendChild(tooltip);

    const rect = target.getBoundingClientRect();
    tooltip.style.left = rect.left + rect.width / 2 + "px";
    tooltip.style.top = rect.top - 40 + "px";

    setTimeout(() => tooltip.remove(), 2000);
  }

  initPremiumScrollbars() {
    // Premium scrollbar styling
    const style = document.createElement("style");
    style.textContent = `
            ::-webkit-scrollbar {
                width: 8px;
                height: 8px;
            }
            ::-webkit-scrollbar-track {
                background: var(--darker);
                border-radius: 4px;
            }
            ::-webkit-scrollbar-thumb {
                background: var(--primary);
                border-radius: 4px;
                transition: var(--transition);
            }
            ::-webkit-scrollbar-thumb:hover {
                background: var(--accent);
                box-shadow: 0 0 10px rgba(0,120,212,0.5);
            }
        `;
    document.head.appendChild(style);
  }

  setupSmartAnimation() {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("animate-in");
          }
        });
      },
      { threshold: 0.1 },
    );

    document
      .querySelectorAll(".track-row, .timeline-clip, .recent-item")
      .forEach((element) => {
        element.classList.add("animate-on-scroll");
        observer.observe(element);
      });
  }

  initPremiumKeyboardShortcuts() {
    // Enhanced keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      // Ctrl+B for new project
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        this.showWorkspace("workspace");
        window.App?.notify?.("New Project Created");
      }
      // Ctrl+S for save
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        this.saveProject();
        window.App?.notify?.("Project saved");
      }
      // Escape to close modals
      if (e.key === "Escape") {
        this.hideAllModals();
      }
    });
  }

  hideAllModals() {
    document.querySelectorAll(".modal.active").forEach((modal) => {
      modal.classList.remove("active");
    });
    document.querySelectorAll(".dropdown-menu.active").forEach((menu) => {
      menu.classList.remove("active");
    });
  }

  initEventListeners() {
    document
      .querySelectorAll(".workspaceTools [data-workspace]")
      .forEach((button) => {
        button.addEventListener("click", () =>
          button.dataset.workspace === "effectsWorkspace"
            ? this.toggleEffectsDrawer()
            : this.showWorkspace(button.dataset.workspace),
        );
      });
    document
      .getElementById("closeEffectsBtn")
      ?.addEventListener("click", () => this.closeEffectsDrawer());

    // Workspace navigation
    document
      .getElementById("newProject")
      ?.addEventListener("click", () => this.startNewProject());
    document
      .getElementById("openProject")
      ?.addEventListener("click", () => this.showWorkspace("projectWorkspace"));
    document
      .getElementById("saveProject")
      ?.addEventListener("click", () => this.saveProject());
    document
      .getElementById("saveAs")
      ?.addEventListener("click", () => this.saveProject());
    document
      .getElementById("exportProject")
      ?.addEventListener("click", () => this.showModal("exportDialog"));
    document
      .getElementById("settings")
      ?.addEventListener("click", () =>
        this.showWorkspace("appearanceWorkspace"),
      );

    // Recording - match HTML IDs
    document
      .getElementById("recordMicrophone")
      ?.addEventListener("click", () => this.handleRecording("microphone"));
    document
      .getElementById("recordSystem")
      ?.addEventListener("click", () => this.handleRecording("system"));
    document
      .getElementById("recordScreen")
      ?.addEventListener("click", () => this.handleRecording("screen"));

    // Media Import
    document
      .getElementById("mediaInput")
      ?.addEventListener("change", (e) => this.handleFileSelect(e));
    const dropZone = document.getElementById("mediaDropZone");
    if (dropZone) {
      dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.style.backgroundColor = "rgba(0, 120, 212, 0.1)";
      });
      dropZone.addEventListener("dragleave", () => {
        dropZone.style.backgroundColor = "";
      });
      dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.style.backgroundColor = "";
        this.handleFiles(e.dataTransfer.files);
      });
    }

    // Modals
    document
      .getElementById("showShortcuts")
      ?.addEventListener("click", () => this.showModal("shortcutDialog"));
    document
      .querySelectorAll(".closeModal, .closeShortcutDialog, .dropdown-close")
      ?.forEach((btn) => {
        btn?.addEventListener("click", (e) =>
          this.hideModal(e.target.closest(".modal, .dropdown-menu")?.id),
        );
      });
    document
      .getElementById("cancelExportBtn")
      ?.addEventListener("click", () => this.hideModal("exportDialog"));
    document
      .getElementById("startExportBtn")
      ?.addEventListener("click", () => this.exportProject());

    // Playback Controls
    document
      .getElementById("playBtn")
      ?.addEventListener("click", () => window.PlayerManager?.play());
    document
      .getElementById("pauseBtn")
      ?.addEventListener("click", () => window.PlayerManager?.pause());
    document
      .getElementById("stopBtn")
      ?.addEventListener("click", () => window.PlayerManager?.stop());
    document
      .getElementById("skipStartBtn")
      ?.addEventListener("click", () => window.PlayerManager?.seek(0));
    document
      .getElementById("skipEndBtn")
      ?.addEventListener("click", () =>
        window.PlayerManager?.seek(window.PlayerManager?.getDuration() || 0),
      );

    // Volume
    document
      .getElementById("masterVolume")
      ?.addEventListener("input", (e) =>
        window.PlayerManager?.setVolume(e.target.value),
      );

    // Project Management
    document
      .getElementById("saveProjectFile")
      ?.addEventListener("click", () => this.saveProject());
    document
      .getElementById("loadProjectFile")
      ?.addEventListener("click", () => this.loadProject());
    document
      .getElementById("autosaveToggle")
      ?.addEventListener("click", () => this.toggleAutosave());

    // Theme
    document
      .getElementById("themeSelector")
      ?.addEventListener("change", (e) => this.applyTheme(e.target.value));

    // Timeline controls
    document
      .getElementById("splitBtn")
      ?.addEventListener("click", () => window.EditorManager?.split());
    document
      .getElementById("cutBtn")
      ?.addEventListener("click", () => window.EditorManager?.cut());
    document
      .getElementById("copyBtn")
      ?.addEventListener("click", () => window.EditorManager?.copy());
    document
      .getElementById("pasteBtn")
      ?.addEventListener("click", () => window.EditorManager?.paste());
    document
      .getElementById("duplicateBtn")
      ?.addEventListener("click", () => window.EditorManager?.duplicate());
    document
      .getElementById("joinBtn")
      ?.addEventListener("click", () => window.EditorManager?.join());
    document
      .getElementById("deleteBtn")
      ?.addEventListener("click", () => window.EditorManager?.delete());
    document
      .getElementById("undoBtn")
      ?.addEventListener("click", () => window.EditorManager?.undo());
    document
      .getElementById("redoBtn")
      ?.addEventListener("click", () => window.EditorManager?.redo());

    // Recording workspace buttons
    document
      .getElementById("recordBtn")
      ?.addEventListener("click", () => this.startRecording());
    document
      .getElementById("stopRecordBtn")
      ?.addEventListener("click", () => this.stopRecording());

    // Inspector controls
    document
      .getElementById("clipName")
      ?.addEventListener("input", (e) =>
        this.updateCurrentClipProperty("name", e.target.value),
      );
    document
      .getElementById("clipStart")
      ?.addEventListener("change", (e) =>
        this.updateCurrentClipProperty("startTime", parseFloat(e.target.value)),
      );
    document
      .getElementById("clipEnd")
      ?.addEventListener("change", (e) =>
        this.updateCurrentClipProperty("endTime", parseFloat(e.target.value)),
      );
    document
      .getElementById("clipOpacity")
      ?.addEventListener("input", (e) =>
        this.updateCurrentClipProperty(
          "opacity",
          parseFloat(e.target.value) / 100,
        ),
      );
    document
      .getElementById("clipRotation")
      ?.addEventListener("input", (e) =>
        this.updateCurrentClipProperty("rotation", parseFloat(e.target.value)),
      );
    document
      .getElementById("clipScale")
      ?.addEventListener("input", (e) =>
        this.updateCurrentClipProperty(
          "scale",
          parseFloat(e.target.value) / 100,
        ),
      );
    document
      .getElementById("clipSpeed")
      ?.addEventListener("input", (e) =>
        this.updateCurrentClipProperty(
          "playbackRate",
          parseFloat(e.target.value),
        ),
      );
    document
      .getElementById("trackVolume")
      ?.addEventListener("input", (e) =>
        this.updateCurrentClipProperty(
          "volume",
          parseFloat(e.target.value) / 100,
        ),
      );
    document
      .getElementById("trackPan")
      ?.addEventListener("input", (e) =>
        this.updateCurrentClipProperty("pan", parseFloat(e.target.value) / 100),
      );

    document
      .getElementById("trimVideoBtn")
      ?.addEventListener("click", () => window.EditorManager?.trim?.());
    document
      .getElementById("rotateVideoBtn")
      ?.addEventListener("click", () => this.openVideoProcess("rotate"));
    document
      .getElementById("resizeVideoBtn")
      ?.addEventListener("click", () => this.openVideoProcess("resize"));
    document
      .getElementById("removeAudioBtn")
      ?.addEventListener("click", () => this.openVideoProcess("remove"));
    document
      .getElementById("cropVideoBtn")
      ?.addEventListener("click", () => this.openVideoProcess("crop"));
    document
      .getElementById("mergeVideoBtn")
      ?.addEventListener("click", () => this.openVideoProcess("merge"));
    document
      .getElementById("compressVideoBtn")
      ?.addEventListener("click", () => this.openVideoProcess("compress"));
    document
      .getElementById("convertVideoBtn")
      ?.addEventListener("click", () => this.openVideoProcess("convert"));
    document
      .getElementById("replaceAudioBtn")
      ?.addEventListener("click", () => this.openVideoProcess("replace"));

    // Video processing dialog buttons
    document
      .getElementById("vpStartBtn")
      ?.addEventListener("click", () => this.startVideoProcess());
    document
      .getElementById("vpCancelBtn")
      ?.addEventListener("click", () => this.cancelVideoProcess());

    // Project workspace buttons
    document
      .getElementById("exportProjectBtn")
      ?.addEventListener("click", () => this.showModal("exportDialog"));
    document
      .getElementById("importProjectBtn")
      ?.addEventListener("click", () => this.loadProjectFromFile());

    // Handle video/audio selection changes
    document
      .getElementById("videoPreview")
      ?.addEventListener("loadedmetadata", () => this.onMediaLoaded());
    document
      .getElementById("audioPreview")
      ?.addEventListener("loadedmetadata", () => this.onMediaLoaded());
  }

  loadProjectFromFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mnst"; // MediaNest project format
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        this.importProject(file);
      }
    };
    input.click();
  }

  importProject(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const projectData = JSON.parse(e.target.result);
        this.loadProjectData(projectData);
        this.notify("Project imported successfully");
      } catch (error) {
        this.notify("Failed to import project: Invalid format");
      }
    };
    reader.readAsText(file);
  }

  loadProjectData(data) {
    if (data && data.clips) {
      window.TimelineManager?.displayClips?.(data.clips);
      this.notify(`Loaded project with ${data.clips.length} clips`);
    }
  }

  showWorkspace(workspaceName) {
    document
      .querySelectorAll(".workspaceTools [data-workspace]")
      .forEach((button) => {
        button.classList.toggle(
          "active",
          button.dataset.workspace === workspaceName,
        );
      });
    // Hide all workspaces
    [
      this.workspace,
      this.timelineWorkspace,
      this.effectsWorkspace,
      this.recordingWorkspace,
      this.projectWorkspace,
      this.appearanceWorkspace,
      this.clipInspector,
    ].forEach((section) => {
      section?.classList.add("workspace-view-hidden");
      section?.classList.remove("workspace-view-active");
    });

    // Show selected workspace
    switch (workspaceName) {
      case "workspace":
        this.workspace.classList.remove("workspace-view-hidden");
        this.workspace.classList.add("workspace-view-active");
        this.timelineWorkspace.classList.remove("workspace-view-hidden");
        this.timelineWorkspace.classList.add("workspace-view-active");
        window.EditorManager?.updateTimeline?.();
        break;
      case "projectWorkspace":
        this.projectWorkspace.classList.remove("workspace-view-hidden");
        this.projectWorkspace.classList.add("workspace-view-active");
        break;
      case "appearanceWorkspace":
        this.appearanceWorkspace.classList.remove("workspace-view-hidden");
        this.appearanceWorkspace.classList.add("workspace-view-active");
        break;
      case "effectsWorkspace":
        this.effectsWorkspace.classList.remove("workspace-view-hidden");
        this.effectsWorkspace.classList.add("workspace-view-active");
        window.EffectsManager?.updateUI?.();
        break;
      case "recordingWorkspace":
        this.recordingWorkspace.classList.remove("workspace-view-hidden");
        this.recordingWorkspace.classList.add("workspace-view-active");
        break;
    }
  }

  startNewProject() {
    window.PlayerManager?.stop?.();
    window.TimelineManager?.clearClips?.();
    const recentFiles = document.getElementById("recentFiles");
    if (recentFiles) recentFiles.innerHTML = "";
    const video = document.getElementById("videoPreview");
    const audio = document.getElementById("audioPreview");
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    window.StorageManager?.deleteProject?.("lastProject");
    this.showWorkspace("workspace");
    window.App?.notify?.("New project created");
  }

  toggleEffectsDrawer() {
    const drawer = this.effectsWorkspace;
    if (drawer?.classList.contains("workspace-view-active"))
      this.closeEffectsDrawer();
    else {
      drawer?.classList.remove("workspace-view-hidden");
      drawer?.classList.add("workspace-view-active", "effects-drawer-open");
      document
        .querySelector('.workspaceTools [data-workspace="effectsWorkspace"]')
        ?.classList.add("active");
    }
  }

  closeEffectsDrawer() {
    this.effectsWorkspace?.classList.remove(
      "workspace-view-active",
      "effects-drawer-open",
    );
    this.effectsWorkspace?.classList.add("workspace-view-hidden");
    document
      .querySelector('.workspaceTools [data-workspace="effectsWorkspace"]')
      ?.classList.remove("active");
  }

  showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add("active");
    }
  }

  hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove("active");
    }
  }

  openVideoProcess(mode) {
    const manager = window.VideoProcessingManager;
    const titles = {
      crop: "Crop Video",
      resize: "Resize Video",
      rotate: "Rotate Video",
      merge: "Merge Videos",
      compress: "Compress Video",
      convert: "Convert Format",
      remove: "Remove Audio",
      replace: "Replace Audio",
    };
    const title = document.getElementById("vpTitle");
    if (title) title.textContent = titles[mode] || "Process Video";

    // Show only the group relevant to the chosen mode.
    const groups = document.querySelectorAll(".vp-group");
    groups.forEach((g) =>
      g.classList.toggle("active", g.dataset.vp === mode),
    );

    // Reset status/progress and re-enable the Process button.
    const status = document.getElementById("vpStatus");
    if (status) status.textContent = "";
    const bar = document.getElementById("vpProgress");
    if (bar) bar.value = 0;
    const start = document.getElementById("vpStartBtn");
    if (start) {
      start.disabled = false;
      start.textContent = "Process";
    }

    this.vpMode = mode;

    // Prefill the source dimensions for crop/resize if a clip is loaded.
    if (mode === "crop" || mode === "resize") {
      const src = manager?.getCurrentSource?.();
      if (src) {
        manager
          .probe(src.src)
          .then((p) => {
            const w = document.getElementById("vpCropW");
            const h = document.getElementById("vpCropH");
            const rw = document.getElementById("vpWidth");
            const rh = document.getElementById("vpHeight");
            if (w) w.placeholder = String(Math.round(p.width));
            if (h) h.placeholder = String(Math.round(p.height));
            if (rw) rw.placeholder = String(Math.round(p.width));
            if (rh) rh.placeholder = String(Math.round(p.height));
          })
          .catch(() => {});
      }
    }

    this.showModal("videoProcessDialog");
  }

  startVideoProcess() {
    const manager = window.VideoProcessingManager;
    if (!manager) return this.notify("Video processing is unavailable.");

    switch (this.vpMode) {
      case "crop": {
        const left = document.getElementById("vpCropX")?.value || 0;
        const top = document.getElementById("vpCropY")?.value || 0;
        const width = document.getElementById("vpCropW")?.value || "";
        const height = document.getElementById("vpCropH")?.value || "";
        manager.cropClip({
          left,
          top,
          width: width === "" ? 0 : width,
          height: height === "" ? 0 : height,
        });
        break;
      }
      case "resize": {
        const width = document.getElementById("vpWidth")?.value || "";
        const height = document.getElementById("vpHeight")?.value || "";
        manager.resizeClip({
          width: width === "" ? 0 : width,
          height: height === "" ? 0 : height,
        });
        break;
      }
      case "rotate":
        manager.rotateClip(90);
        break;
      case "compress": {
        const level =
          document.getElementById("vpCompressLevel")?.value || "medium";
        manager.compressClip(level);
        break;
      }
      case "convert": {
        const format = document.getElementById("vpFormat")?.value || "webm";
        manager.convertClip(format);
        break;
      }
      case "remove":
        manager.removeAudioClip();
        break;
      case "merge": {
        const files = document.getElementById("vpMergeFiles")?.files;
        manager.mergeClips(files);
        break;
      }
      case "replace": {
        const file = document.getElementById("vpReplaceAudio")?.files?.[0];
        manager.replaceAudioClip(file);
        break;
      }
      default:
        this.notify("No operation selected.");
    }
  }

  cancelVideoProcess() {
    window.VideoProcessingManager?.cancel?.();
    const status = document.getElementById("vpStatus");
    if (status) status.textContent = "";
    this.hideModal("videoProcessDialog");
  }

  handleFileSelect(event) {
    const files = event.target.files;
    if (!files || files.length === 0) {
      this.notify("No files selected");
      return;
    }

    this.fileProcessing = true;
    this.showProcessingIndicator("Loading media files...");

    Array.from(files).forEach((file, index) => {
      setTimeout(() => {
        this.processFile(file);
      }, index * 200); // Process files sequentially with delay
    });

    event.target.value = "";
  }

  showProcessingIndicator(message) {
    let indicator = document.getElementById("processingIndicator");
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.id = "processingIndicator";
      indicator.style.cssText =
        "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.9);color:white;padding:30px;border-radius:12px;z-index:10000;font-size:16px;display:flex;flex-direction:column;align-items:center;gap:15px;";
      document.body.appendChild(indicator);
    }
    indicator.innerHTML = `<div style="width:40px;height:40px;border:4px solid #333;border-top:4px solid #0078d4;border-radius:50%;animation:spin 1s linear infinite;"></div><p>${message}</p>`;

    // Add spin animation
    const style = document.createElement("style");
    style.textContent =
      "@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }";
    document.head.appendChild(style);
  }

  hideProcessingIndicator() {
    const indicator = document.getElementById("processingIndicator");
    if (indicator) {
      indicator.remove();
    }
  }

  isValidMediaFile(file) {
    return file.type.startsWith("video/") || file.type.startsWith("audio/");
  }

  processFile(file) {
    if (!this.isValidMediaFile(file)) {
      this.hideProcessingIndicator();
      this.fileProcessing = false;
      this.notify(`Unsupported file type: ${file.name}`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const clip = {
          id: Date.now() + Math.random(),
          name: file.name,
          type: file.type.startsWith("video/") ? "video" : "audio",
          src: e.target.result,
          duration: 0,
          thumbnail: null,
        };

        this.addClipToLibrary(clip);
        this.addClipToTimeline(clip);

        // Auto-load media into preview
        setTimeout(() => {
          window.PlayerManager?.setElementSource?.(clip);
        }, 500);

        this.fileProcessing = false;
        this.hideProcessingIndicator();
        this.notify(`Loaded: ${file.name}`);
      } catch (error) {
        console.error("File processing error:", error);
        this.fileProcessing = false;
        this.hideProcessingIndicator();
        this.notify(`Error processing ${file.name}: ${error.message}`);
      }
    };
    reader.onerror = (error) => {
      console.error("FileReader error:", error);
      this.fileProcessing = false;
      this.hideProcessingIndicator();
      this.notify(`Error reading ${file.name}: ${error.message}`);
    };
    reader.readAsDataURL(file);
  }

  handleFiles(files) {
    Array.from(files).forEach((file) => {
      if (this.isValidMediaFile(file)) {
        this.processFile(file);
      } else {
        this.notify(`Skipped unsupported file: ${file.name}`);
      }
    });
    this.hideProcessingIndicator();
  }

  addClipToLibrary(clip) {
    const lib = document.getElementById("recentFiles");
    if (!lib) return;

    const el = document.createElement("div");
    el.className = "recent-item";
    const icon = clip.type === "video" ? "📹" : "🎵";
    el.innerHTML = `
            <div class="clip-thumbnail" style="font-size: 24px;">${icon}</div>
            <div class="clip-info">
                <span class="clip-name">${clip.name}</span>
                <small>${clip.type.toUpperCase()}</small>
            </div>
            <button class="btn-add">Add</button>
        `;

    el.querySelector(".btn-add").addEventListener("click", () => {
      window.PlayerManager?.setElementSource?.(clip);
      this.notify(`Added ${clip.name} to timeline`);
    });

    el.addEventListener("click", (e) => {
      if (!e.target.classList.contains("btn-add")) {
        window.PlayerManager?.setElementSource?.(clip);
      }
    });

    lib.appendChild(el);
  }

  addClipToTimeline(clip) {
    if (window.TimelineManager?.addClip) {
      window.TimelineManager.addClip(clip);
    }
  }

  handleRecording(type) {
    console.log(`Starting ${type} recording mode`);
    this.showWorkspace("recordingWorkspace");
    this.notify(`${type} recording mode activated`);

    if (window.RecorderManager) {
      switch (type) {
        case "microphone":
          // Show mic recording controls
          this.updateRecordingStatus("Microphone ready...");
          break;
        case "system":
          this.updateRecordingStatus("System audio ready...");
          break;
        case "screen":
          this.updateRecordingStatus("Screen recording ready...");
          break;
      }
    }
  }

  updateRecordingStatus(message) {
    const status = document.getElementById("recordingStatus");
    if (status) {
      status.textContent = message;
      status.style.display = "block";
    }
  }

  saveProject() {
    const project = {
      name: `Project ${Date.now()}`,
      clips: window.TimelineManager?.getClips?.() || [],
      timestamp: Date.now(),
    };

    if (window.StorageManager?.save) {
      window.StorageManager.save("currentProject", project);
      window.StorageManager.save("lastProject", project);
    }

    // Download project file
    const dataStr = JSON.stringify(project, null, 2);
    const dataUri =
      "data:application/json;charset=utf-8," + encodeURIComponent(dataStr);
    const exportName = `${project.name}.sonc`;

    const linkElement = document.createElement("a");
    linkElement.setAttribute("href", dataUri);
    linkElement.setAttribute("download", exportName);
    linkElement.click();

    this.notify("Project saved and downloaded");
  }

  loadProject() {
    const project =
      window.StorageManager?.load?.("currentProject") ||
      window.StorageManager?.load?.("lastProject");
    if (project && project.clips) {
      window.TimelineManager?.displayClips?.(project.clips);
      this.notify("Project loaded");
    } else {
      this.notify("No saved project found");
    }
  }

  toggleAutosave() {
    this.autosaveEnabled = !this.autosaveEnabled;
    this.notify(`Autosave ${this.autosaveEnabled ? "enabled" : "disabled"}`);

    if (this.autosaveEnabled) {
      // Setup autosave interval
      if (!this.autosaveInterval) {
        this.autosaveInterval = setInterval(() => {
          this.autoSaveProject();
        }, 5000); // Save every 5 seconds
      }
    } else {
      if (this.autosaveInterval) {
        clearInterval(this.autosaveInterval);
        this.autosaveInterval = null;
      }
    }
  }

  async autoSaveProject() {
    const project = {
      clips: window.TimelineManager?.getClips?.() || [],
      timestamp: Date.now(),
    };

    // Auto-save to browser storage
    if (window.StorageManager?.save) {
      window.StorageManager.save("autoSaveProject", project);
    }

    this.notify("Auto-saved", "info", 1000);
  }

  applyTheme(theme) {
    document.body.setAttribute("data-theme", theme.toLowerCase());
    this.notify(`Theme changed to ${theme}`);

    // Save theme preference
    localStorage.setItem("medianest_theme", theme);

    // Update timeline colors
    if (window.EffectsManager?.updateTheme) {
      window.EffectsManager.updateTheme(theme);
    }
  }

  startRecording() {
    if (window.RecorderManager) {
      window.RecorderManager.startRecording();
    }
  }

  stopRecording() {
    if (window.RecorderManager) {
      window.RecorderManager.stopRecording();
    }
  }

  exportProject() {
    const format = document.getElementById("exportFormat")
      ? document.getElementById("exportFormat").value
      : "MP4";
    const quality = document.getElementById("exportQuality")
      ? document.getElementById("exportQuality").value
      : "High";
    this.notify(`Exporting in ${format} format (${quality} quality)`);
    this.hideModal("exportDialog");

    if (window.ExportManager) {
      window.ExportManager.setFormat(format);
      window.ExportManager.setQuality(quality);
      window.ExportManager.exportProject();
    }
  }

  notify(message, type = "info", duration = 3000) {
    if (window.NotificationManager?.info) {
      window.NotificationManager.info(message);
    } else {
      console.log(`${type}: ${message}`);
      // Fallback to status bar
      const status = document.getElementById("projectStatus");
      if (status) {
        status.textContent = `${type.toUpperCase()}: ${message}`;
        setTimeout(() => (status.textContent = "Project Ready"), 5000);
      }
    }
  }

  updateCurrentClipProperty(property, value) {
    const selectedClip = document.querySelector(".timeline-clip.selected");
    if (!selectedClip) return;

    const clip = window.TimelineManager?.getClips().find(
      (c) => c.id === selectedClip.id,
    );
    if (clip) {
      clip[property] = value;
      window.App?.notify?.(`${property} updated to: ${value}`);
    }
  }

  adjustSelectedClip(property, value) {
    const element = document.querySelector(".timeline-clip.selected");
    const clip =
      element &&
      window.TimelineManager?.getClips?.().find(
        (item) => item.id === element.id,
      );
    if (!clip) return this.notify("Select a clip first");
    if (property === "rotation")
      clip.rotation = (Number(clip.rotation) || 0) + value;
    if (property === "removeAudio") clip.removeAudio = value;
    window.InspectorManager?.render?.();
    window.InspectorManager?.applyTransform?.(clip);
    this.notify(
      property === "rotation"
        ? `Rotation: ${clip.rotation} degrees`
        : "Audio removed from selected video",
    );
  }

  onMediaLoaded() {
    this.updateTimelineDuration();
  }

  updateTimelineDuration() {
    const duration = window.PlayerManager?.getDuration?.() || 0;
    const durationEl = document.getElementById("durationDisplay");
    if (durationEl) {
      durationEl.textContent = this.formatTime(duration);
    }
  }

  formatTime(seconds) {
    if (isNaN(seconds)) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  loadLastProject() {
    this.loadProject(); // Simple implementation for now
  }
}

// UIManager is instantiated by App in js/app.js
