"use strict";

class PlayerManager {
    constructor() {
        this.videoElement = document.getElementById('videoPreview');
        this.audioElement = document.getElementById('audioPreview');
        this.currentElement = null;
        this.currentClip = null;
        this.isPlaying = false;
        this.playbackRate = 1;
        this.initElements();
    }

    initElements() {
        if (this.videoElement) {
            this.videoElement.controls = true;
            this.videoElement.addEventListener('loadedmetadata', () => this.updateTimeDisplay());
            this.videoElement.addEventListener('timeupdate', () => this.updateTimeDisplay());
            this.videoElement.addEventListener('ended', () => this.onEnded());
            this.videoElement.addEventListener('error', () => this.handleMediaError());
        }
        if (this.audioElement) {
            this.audioElement.controls = true;
            this.audioElement.addEventListener('loadedmetadata', () => this.updateTimeDisplay());
            this.audioElement.addEventListener('timeupdate', () => this.updateTimeDisplay());
            this.audioElement.addEventListener('ended', () => this.onEnded());
            this.audioElement.addEventListener('error', () => this.handleMediaError());
        }
    }

    setElementSource(clip) {
        return this.loadClip(clip);
    }

    loadCurrentElement() {
        const clip = window.TimelineManager?.getNextClip?.() || window.TimelineManager?.getFirstClip?.();
        if (clip) this.loadClip(clip);
    }

    loadClip(clip) {
        if (!clip?.src) return false;
        this.pause();
        this.currentClip = clip;

        if (clip.type === 'video') {
            this.currentElement = this.videoElement;
            if (this.videoElement) {
                this.videoElement.src = clip.src;
                this.videoElement.style.display = 'block';
            }
            if (this.audioElement) this.audioElement.style.display = 'none';
        } else {
            this.currentElement = this.audioElement;
            if (this.audioElement) {
                this.audioElement.src = clip.src;
                this.audioElement.style.display = 'block';
            }
            if (this.videoElement) this.videoElement.style.display = 'none';
        }

        if (this.currentElement) {
            this.currentElement.playbackRate = clip.playbackRate || this.playbackRate;
            this.currentElement.volume = Number.isFinite(clip.volume) ? clip.volume : 1;
            this.currentElement.load();
            window.App?.notify?.(`Loaded ${clip.name}`);
            return true;
        }
        return false;
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

    pause() {
        this.currentElement?.pause();
        this.isPlaying = false;
    }

    stop() {
        if (!this.currentElement) return;
        this.currentElement.pause();
        try { this.currentElement.currentTime = 0; } catch (_) {}
        this.isPlaying = false;
        this.updateTimeDisplay();
    }

    setVolume(volume) {
        const value = Math.max(0, Math.min(100, Number(volume))) / 100;
        if (this.currentElement) this.currentElement.volume = value;
    }

    setPlaybackRate(rate) {
        this.playbackRate = Number(rate) || 1;
        if (this.currentElement) this.currentElement.playbackRate = this.playbackRate;
        if (this.currentClip) this.currentClip.playbackRate = this.playbackRate;
    }

    seek(time) {
        if (!this.currentElement) return;
        const duration = this.getDuration();
        this.currentElement.currentTime = Math.max(0, Math.min(Number(time) || 0, duration || 0));
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
        if (playhead && this.getDuration() > 0) {
            playhead.style.left = `${(this.getCurrentTime() / this.getDuration()) * 100}%`;
        }
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
