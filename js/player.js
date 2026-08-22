"use strict";

class PlayerManager {
    constructor() {
        this.videoElement = document.getElementById('videoPreview');
        this.audioElement = document.getElementById('audioPreview');
        this.currentElement = null;
        this.currentClip = null;
        this.isPlaying = false;
        this.playbackRate = 1;
        this.audioContext = null;
        this.sourceNodes = new WeakMap();
        this.gainNodes = new WeakMap();
        this.panNodes = new WeakMap();
        this.initElements();
    }

    initElements() {
        [this.videoElement, this.audioElement].forEach(el => {
            if (!el) return;
            el.controls = true;
            el.addEventListener('loadedmetadata', () => this.updateTimeDisplay());
            el.addEventListener('timeupdate', () => this.updateTimeDisplay());
            el.addEventListener('ended', () => this.onEnded());
            el.addEventListener('error', () => this.handleMediaError());
        });
    }

    setElementSource(clip) { return this.loadClip(clip); }

    loadCurrentElement() {
        const clip = window.TimelineManager?.getNextClip?.() || window.TimelineManager?.getFirstClip?.();
        if (clip) this.loadClip(clip);
    }

    loadClip(clip) {
        if (!clip?.src) return false;
        this.pause();
        this.currentClip = clip;
        this.currentElement = clip.type === 'video' ? this.videoElement : this.audioElement;
        if (!this.currentElement) return false;
        if (this.videoElement) this.videoElement.style.display = clip.type === 'video' ? 'block' : 'none';
        if (this.audioElement) this.audioElement.style.display = clip.type === 'audio' ? 'block' : 'none';
        this.currentElement.src = clip.src;
        this.currentElement.playbackRate = Number(clip.playbackRate) || this.playbackRate;
        this.currentElement.volume = clip.muted ? 0 : this.clamp(Number(clip.volume ?? 1), 0, 1);
        this.currentElement.muted = !!clip.muted;
        this.currentElement.load();
        window.App?.notify?.(`Loaded ${clip.name || 'media'}`);
        return true;
    }

    async play() {
        if (!this.currentElement) this.loadCurrentElement();
        if (!this.currentElement) return;
        try {
            await this.currentElement.play();
            this.isPlaying = true;
        } catch (error) {
            window.App?.notify?.(`Play failed: ${error.message}`);
        }
    }

    pause() { this.currentElement?.pause(); this.isPlaying = false; }

    stop() {
        if (!this.currentElement) return;
        this.currentElement.pause();
        try { this.currentElement.currentTime = 0; } catch (_) {}
        this.isPlaying = false;
        this.updateTimeDisplay();
    }

    clamp(value, min, max) { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)); }

    setVolume(volume, clip = this.currentClip) {
        const value = this.clamp(Number(volume), 0, 100) / 100;
        if (clip) clip.volume = value;
        if (this.currentElement) this.currentElement.volume = value;
    }

    setMute(muted = true, clip = this.currentClip) {
        if (clip) clip.muted = !!muted;
        if (this.currentElement) this.currentElement.muted = !!muted;
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
        const node = this.gainNodes.get(this.currentElement);
        if (node) node.gain.value = value;
    }

    async ensureAudioGraph() {
        if (!this.currentElement || this.audioContext) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        try {
            this.audioContext = new Ctx();
            const source = this.audioContext.createMediaElementSource(this.currentElement);
            const gain = this.audioContext.createGain();
            const pan = this.audioContext.createStereoPanner ? this.audioContext.createStereoPanner() : null;
            source.connect(gain);
            if (pan) { gain.connect(pan); pan.connect(this.audioContext.destination); }
            else gain.connect(this.audioContext.destination);
            this.sourceNodes.set(this.currentElement, source);
            this.gainNodes.set(this.currentElement, gain);
            if (pan) this.panNodes.set(this.currentElement, pan);
        } catch (error) {
            console.warn('Web Audio graph unavailable:', error);
        }
    }

    async enableAudioProcessing() {
        await this.ensureAudioGraph();
        if (this.audioContext?.state === 'suspended') await this.audioContext.resume();
        if (this.currentClip) {
            this.setGain(this.currentClip.gain ?? 1);
            this.setPan(this.currentClip.pan ?? 0);
        }
    }

    setPlaybackRate(rate) {
        this.playbackRate = Number(rate) || 1;
        if (this.currentElement) this.currentElement.playbackRate = this.playbackRate;
        if (this.currentClip) this.currentClip.playbackRate = this.playbackRate;
    }

    seek(time) {
        if (!this.currentElement) return;
        this.currentElement.currentTime = Math.max(0, Math.min(Number(time) || 0, this.getDuration() || 0));
        this.updateTimeDisplay();
    }

    getCurrentTime() { return this.currentElement?.currentTime || 0; }
    getDuration() { return Number.isFinite(this.currentElement?.duration) ? this.currentElement.duration : 0; }
    isElementReady() { return !!this.currentElement && this.currentElement.readyState >= 2; }

    onEnded() {
        this.isPlaying = false;
        this.updateTimeDisplay();
        window.TimelineManager?.onPlaybackEnded?.();
    }

    handleMediaError() {
        const error = this.currentElement?.error;
        if (error) window.App?.notify?.(`Media error (${error.code}). The browser may not support this format.`);
    }

    updateTimeDisplay() {
        const current = document.getElementById('currentTime');
        const total = document.getElementById('totalTime');
        if (current) current.textContent = this.formatTime(this.getCurrentTime());
        if (total) total.textContent = this.formatTime(this.getDuration());
        const playhead = document.getElementById('playhead');
        if (playhead && this.getDuration() > 0) playhead.style.left = `${(this.getCurrentTime() / this.getDuration()) * 100}%`;
    }

    formatTime(seconds) {
        if (!Number.isFinite(seconds)) return '00:00:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
}

window.PlayerManager = new PlayerManager();
window.setClipVolume = (v) => window.PlayerManager.setVolume(v);
window.muteClip = () => window.PlayerManager.toggleMute();
window.setClipPan = (v) => window.PlayerManager.setPan(v);
window.setClipGain = (v) => window.PlayerManager.setGain(v);
window.enableAudioProcessing = () => window.PlayerManager.enableAudioProcessing();
