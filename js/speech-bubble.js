"use strict";

/**
 * SpeechBubbleManager
 * Speech balloon pinned directly beneath the "Open MediaNest Editor" button on
 * the Tools home page (top-right corner). It types a short pitch of the main
 * editor, holds it, erases it and cycles to the next line — a continuous
 * typewriter effect that runs forever. The ✕ button dismisses it permanently.
 *
 * Timings/messages can be overridden before load for tests via
 * window.__SPEECH_CONFIG__ = { typeMs, eraseMs, holdMs, gapMs, bootMs, messages }.
 */
class SpeechBubbleManager {
  constructor() {
    this.bubble = document.getElementById("editorSpeechBubble");
    this.textEl = document.getElementById("editorSpeechText");
    this.closeBtn = document.getElementById("speechClose");

    const cfg = window.__SPEECH_CONFIG__ || {};
    this.messages = cfg.messages || [
      "Meet the MediaNest Editor — cut, trim and arrange audio & video on one timeline.",
      "Live waveform, spectrum and oscilloscope views update while your project plays.",
      "Record voiceovers, apply effects and export straight to MP4, MP3, WAV and more.",
    ];
    this.typeMs = cfg.typeMs ?? 34; // per character while typing
    this.eraseMs = cfg.eraseMs ?? 14; // per step while erasing (erases 2 chars)
    this.holdMs = cfg.holdMs ?? 2400; // pause with a fully typed line
    this.gapMs = cfg.gapMs ?? 350; // breather between erase and next line
    this.bootMs = cfg.bootMs ?? 500; // delay before the first keystroke

    this.lineIndex = 0;
    this.charIndex = 0;
    this.phase = "typing"; // typing -> holding -> erasing -> typing …
    this.dismissed = false;
    this.timer = null;
  }

  init() {
    if (!this.bubble || !this.textEl) return;
    if (this.closeBtn) {
      this.closeBtn.addEventListener("click", () => this.dismiss());
    }
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (reducedMotion) {
      // Static first line — no motion, no loop.
      this.textEl.textContent = this.messages[0];
      return;
    }
    console.log("Speech Bubble Ready - editor intro");
    this.timer = setTimeout(() => this.step(), this.bootMs);
  }

  /** One state-machine tick of the continuous typewriter loop. */
  step() {
    if (this.dismissed) return;
    const line = this.messages[this.lineIndex];

    switch (this.phase) {
      case "typing": {
        this.charIndex += 1;
        this.textEl.textContent = line.slice(0, this.charIndex);
        if (this.charIndex >= line.length) {
          this.phase = "holding";
          return this.later(this.holdMs);
        }
        // Slight jitter so the cadence feels hand-typed.
        return this.later(this.typeMs + Math.random() * this.typeMs * 0.6);
      }
      case "holding":
        this.phase = "erasing";
        return this.later(this.gapMs);

      case "erasing": {
        this.charIndex -= 2; // backspace removes characters faster than typing
        if (this.charIndex <= 0) {
          this.charIndex = 0;
          this.textEl.textContent = "";
          this.lineIndex = (this.lineIndex + 1) % this.messages.length;
          this.phase = "typing";
          return this.later(this.gapMs);
        }
        this.textEl.textContent = line.slice(0, this.charIndex);
        return this.later(this.eraseMs);
      }
    }
  }

  later(ms) {
    this.timer = setTimeout(() => this.step(), ms);
  }

  dismiss() {
    this.dismissed = true;
    clearTimeout(this.timer);
    this.bubble.classList.add("hidden");
  }
}

window.SpeechBubbleManager = new SpeechBubbleManager();

document.addEventListener("DOMContentLoaded", () => {
  window.SpeechBubbleManager.init();
});
