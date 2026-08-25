"use strict";

class EditorManager {
  constructor() {
    this.history = [];
    this.redoStack = [];
    this.maxHistory = 50;
    this.clipboard = null;
    this.initShortcuts();
  }

  initShortcuts() {
    document.addEventListener("keydown", (e) => {
      const tag = document.activeElement?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        this.undo();
      } else if (
        (e.ctrlKey && e.key.toLowerCase() === "y") ||
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "z")
      ) {
        e.preventDefault();
        this.redo();
      } else if (e.ctrlKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        this.copy();
      } else if (e.ctrlKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        this.paste();
      } else if (e.key === "Delete") {
        e.preventDefault();
        this.delete();
      }
    });
  }

  snapshot() {
    return JSON.parse(JSON.stringify(window.TimelineManager?.tracks || []));
  }

  addToHistory(type, before, after) {
    this.history.push({ type, before, after });
    if (this.history.length > this.maxHistory) this.history.shift();
    this.redoStack = [];
  }

  async restore(snapshot) {
    if (!snapshot || !window.TimelineManager) return;
    const clips = snapshot.flatMap((track, trackIndex) =>
      (track.clips || []).map((clip) => ({ ...clip, trackIndex })),
    );
    if (typeof window.TimelineManager.displayClips === "function")
      await window.TimelineManager.displayClips(clips);
    window.TimelineManager.updateTimelineWidth?.();
  }

  async undo() {
    const action = this.history.pop();
    if (!action) return window.App?.notify?.("Nothing to undo");
    this.redoStack.push(action);
    await this.restore(action.before);
    window.App?.notify?.(`Undo: ${action.type}`);
  }

  async redo() {
    const action = this.redoStack.pop();
    if (!action) return window.App?.notify?.("Nothing to redo");
    this.history.push(action);
    await this.restore(action.after);
    window.App?.notify?.(`Redo: ${action.type}`);
  }

  selectedData() {
    const el = document.querySelector(".timeline-clip.selected");
    if (!el || !window.TimelineManager) return null;
    const trackIndex = Number(el.dataset.trackIndex);
    const clip = window.TimelineManager.getClips(trackIndex)?.find(
      (c) => c.id === el.id,
    );
    return clip ? { el, clip, trackIndex } : null;
  }

  copy() {
    const data = this.selectedData();
    if (!data) return window.App?.notify?.("No clip selected to copy");
    this.clipboard = {
      clip: JSON.parse(JSON.stringify(data.clip)),
      trackIndex: data.trackIndex,
    };
    window.App?.notify?.("Clip copied");
  }

  cut() {
    const data = this.selectedData();
    if (!data) return window.App?.notify?.("No clip selected to cut");
    this.clipboard = {
      clip: JSON.parse(JSON.stringify(data.clip)),
      trackIndex: data.trackIndex,
    };
    const before = this.snapshot();
    window.TimelineManager.removeClip(data.clip.id);
    const after = this.snapshot();
    this.addToHistory("cut", before, after);
    window.App?.notify?.("Clip cut");
  }

  async paste() {
    if (!this.clipboard) return window.App?.notify?.("Nothing in clipboard");
    const clip = JSON.parse(JSON.stringify(this.clipboard.clip));
    clip.id = `clip-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    clip.startTime =
      window.PlayerManager?.getCurrentTime?.() || clip.startTime || 0;
    clip.endTime = clip.startTime + (clip.duration || 0);
    const before = this.snapshot();
    await window.TimelineManager.addClip(clip, this.clipboard.trackIndex);
    const after = this.snapshot();
    this.addToHistory("paste", before, after);
    window.App?.notify?.("Clip pasted");
  }

  delete() {
    const data = this.selectedData();
    if (!data) return window.App?.notify?.("No clip selected");
    const before = this.snapshot();
    window.TimelineManager.removeClip(data.clip.id);
    const after = this.snapshot();
    this.addToHistory("delete", before, after);
    window.App?.notify?.("Clip deleted");
  }

  async duplicate() {
    const data = this.selectedData();
    if (!data) return window.App?.notify?.("No clip selected");
    const clip = JSON.parse(JSON.stringify(data.clip));
    clip.id = `clip-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    clip.startTime = data.clip.endTime;
    clip.endTime = clip.startTime + (clip.duration || 0);
    const before = this.snapshot();
    await window.TimelineManager.addClip(clip, data.trackIndex);
    const after = this.snapshot();
    this.addToHistory("duplicate", before, after);
    window.App?.notify?.("Clip duplicated");
  }

  join() {
    const data = this.selectedData();
    if (!data) return window.App?.notify?.("No clip selected to join");
    const clips = window.TimelineManager.getClips(data.trackIndex).sort(
      (a, b) => a.startTime - b.startTime,
    );
    const index = clips.findIndex((clip) => clip.id === data.clip.id);
    const next = clips[index + 1];
    if (!next || next.startTime > data.clip.endTime + 0.05)
      return window.App?.notify?.("Select adjacent clips to join");
    const before = this.snapshot();
    data.clip.duration =
      Math.max(data.clip.endTime, next.endTime) - data.clip.startTime;
    data.clip.endTime = data.clip.startTime + data.clip.duration;
    window.TimelineManager.removeClip(next.id);
    window.TimelineManager.updateClipElement(data.el, data.clip);
    window.TimelineManager.updateTimelineWidth();
    this.addToHistory("join", before, this.snapshot());
    window.App?.notify?.("Clips joined");
  }

  split() {
    const data = this.selectedData();
    if (!data) return window.App?.notify?.("No clip selected to split");
    const before = this.snapshot();
    window.TimelineManager.splitSelected();
    const after = this.snapshot();
    if (JSON.stringify(before) !== JSON.stringify(after))
      this.addToHistory("split", before, after);
  }

  trim() {
    const data = this.selectedData();
    if (!data) return window.App?.notify?.("No clip selected");
    const playhead = window.PlayerManager?.getCurrentTime?.() || 0;
    if (playhead <= data.clip.startTime || playhead >= data.clip.endTime)
      return window.App?.notify?.(
        "Place the playhead inside the selected clip",
      );
    const before = this.snapshot();
    data.clip.duration = playhead - data.clip.startTime;
    data.clip.endTime = playhead;
    window.TimelineManager.updateClipElement?.(data.el, data.clip);
    window.TimelineManager.updateTimelineWidth?.();
    const after = this.snapshot();
    this.addToHistory("trim", before, after);
    window.App?.notify?.("Clip trimmed at playhead");
  }

  getCurrentClip() {
    return document.querySelector(".timeline-clip.selected");
  }
}

window.EditorManager = new EditorManager();
window.undo = () => window.EditorManager.undo();
window.redo = () => window.EditorManager.redo();
window.cut = () => window.EditorManager.cut();
window.copy = () => window.EditorManager.copy();
window.paste = () => window.EditorManager.paste();
window.del = () => window.EditorManager.delete();
window.duplicate = () => window.EditorManager.duplicate();
window.joinClips = () => window.EditorManager.join();
window.splitClip = () => window.EditorManager.split();
window.trimClip = () => window.EditorManager.trim();
