"use strict";

class TimelineManager {
    constructor() {
        this.tracks = [];
        this.currentTrackIndex = 0;
        this.clipCounter = 0;
        this.pixelsPerSecond = 50;
        this.initTracks();
    }

    initTracks() {
        this.tracks = [
            { id: 'track-video', name: 'Video Track 1', type: 'video', clips: [], element: document.getElementById('videoTrack1') },
            { id: 'track-audio-1', name: 'Audio Track 1', type: 'audio', clips: [], element: document.getElementById('audioTrack1') },
            { id: 'track-audio-2', name: 'Audio Track 2', type: 'audio', clips: [], element: document.getElementById('audioTrack2') }
        ];
    }

    async addClip(clip, trackIndex = this.currentTrackIndex, preservePosition = false) {
        const track = this.tracks[trackIndex];
        if (!track || !clip) return null;
        if (clip.type === 'video' && track.type !== 'video') trackIndex = 0;
        if (clip.type === 'audio' && track.type === 'video') trackIndex = 1;
        const target = this.tracks[trackIndex];

        if (!clip.duration || !Number.isFinite(clip.duration) || clip.duration <= 0) {
            clip.duration = await this.getClipDuration(clip);
        }
        clip.id = String(clip.id || `clip-${Date.now()}-${this.clipCounter++}`);
        clip.trackIndex = trackIndex;
        if (!preservePosition) {
            const last = target.clips[target.clips.length - 1];
            clip.startTime = last ? last.endTime : 0;
        } else {
            clip.startTime = Number(clip.startTime) || 0;
        }
        clip.endTime = clip.startTime + clip.duration;
        target.clips.push(clip);
        this.renderClip(clip, target, trackIndex);
        this.updateTimelineWidth();
        return clip;
    }

    getClipDuration(clip) {
        return new Promise(resolve => {
            if (!clip?.src) return resolve(5);
            const media = document.createElement(clip.type === 'video' ? 'video' : 'audio');
            let done = false;
            const finish = value => { if (!done) { done = true; resolve(Number.isFinite(value) && value > 0 ? value : 5); } };
            media.preload = 'metadata';
            media.onloadedmetadata = () => finish(media.duration);
            media.onerror = () => finish(5);
            setTimeout(() => finish(media.duration), 5000);
            media.src = clip.src;
        });
    }

    renderClip(clip, track, trackIndex) {
        if (!track.element) return;
        const clipEl = document.createElement('div');
        clipEl.className = `timeline-clip ${clip.type}`;
        clipEl.id = clip.id;
        clipEl.dataset.clipId = clip.id;
        clipEl.dataset.trackIndex = trackIndex;
        clipEl.title = `${clip.name} — ${this.formatTime(clip.duration)}`;
        this.updateClipElement(clipEl, clip);
        clipEl.innerHTML = `<span class="clip-name"></span><span class="clip-duration"></span>`;
        clipEl.querySelector('.clip-name').textContent = clip.name;
        clipEl.querySelector('.clip-duration').textContent = this.formatTime(clip.duration);

        clipEl.addEventListener('click', e => {
            if (e.button !== 2) this.selectClip(clip.id);
        });
        clipEl.addEventListener('dblclick', () => window.PlayerManager?.setElementSource?.(clip));
        clipEl.addEventListener('mousedown', e => this.onClipMouseDown(e, clip, trackIndex));
        track.element.appendChild(clipEl);
    }

    updateClipElement(el, clip) {
        el.style.left = `${Math.max(0, clip.startTime) * this.pixelsPerSecond}px`;
        el.style.width = `${Math.max(40, clip.duration * this.pixelsPerSecond)}px`;
    }

    selectClip(clipId) {
        document.querySelectorAll('.timeline-clip').forEach(el => el.classList.toggle('selected', el.id === clipId));
        const clip = this.getClips().find(c => c.id === clipId);
        if (clip) {
            this.currentTrackIndex = clip.trackIndex;
            window.PlayerManager?.setElementSource?.(clip);
            window.App?.notify?.(`Selected ${clip.name}`);
        }
    }

    onClipMouseDown(e, clip, trackIndex) {
        if (e.button !== 0) return;
        e.preventDefault();
        this.selectClip(clip.id);
        const startX = e.clientX;
        const originalStart = clip.startTime;
        const el = e.currentTarget;
        const onMove = ev => {
            const delta = (ev.clientX - startX) / this.pixelsPerSecond;
            clip.startTime = Math.max(0, originalStart + delta);
            clip.endTime = clip.startTime + clip.duration;
            this.updateClipElement(el, clip);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            this.normalizeTrack(trackIndex);
            this.updateTimelineWidth();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    normalizeTrack(trackIndex) {
        const track = this.tracks[trackIndex];
        if (!track) return;
        track.clips.sort((a, b) => a.startTime - b.startTime);
        track.clips.forEach(clip => { clip.endTime = clip.startTime + clip.duration; const el = document.getElementById(clip.id); if (el) this.updateClipElement(el, clip); });
    }

    updateTimelineWidth() {
        const container = document.getElementById('tracksContainer');
        if (!container) return;
        const maxEnd = Math.max(10, ...this.getClips().map(c => c.endTime || c.startTime + c.duration || 0));
        container.style.minWidth = `${Math.max(600, maxEnd * this.pixelsPerSecond + 100)}px`;
    }

    getClips(trackIndex = null) { return trackIndex === null ? this.tracks.flatMap(t => t.clips) : (this.tracks[trackIndex]?.clips || []); }
    getFirstClip() { return this.getClips().sort((a, b) => a.startTime - b.startTime)[0] || null; }
    getNextClip() { return document.querySelector('.timeline-clip.selected') ? this.getClips().find(c => c.id === document.querySelector('.timeline-clip.selected').id) || this.getFirstClip() : this.getFirstClip(); }

    displayClips(clips) {
        this.clearClips();
        const tasks = clips.map(clip => this.addClip({ ...clip }, Number.isInteger(clip.trackIndex) ? clip.trackIndex : 0, true));
        return Promise.all(tasks);
    }

    clearClips() { this.tracks.forEach(t => { t.clips = []; if (t.element) t.element.innerHTML = ''; }); }
    removeClip(id) { for (const track of this.tracks) { const i = track.clips.findIndex(c => c.id === id); if (i >= 0) { track.clips.splice(i, 1); document.getElementById(id)?.remove(); this.updateTimelineWidth(); return true; } } return false; }
    selectTrack(index) { if (this.tracks[index]) this.currentTrackIndex = index; }

    splitSelected() {
        const el = document.querySelector('.timeline-clip.selected');
        if (!el) return window.App?.notify?.('No clip selected to split');
        const clip = this.getClips().find(c => c.id === el.id);
        if (!clip || clip.duration < 0.1) return;
        const at = window.PlayerManager?.getCurrentTime?.() || (clip.startTime + clip.duration / 2);
        const splitAt = Math.max(clip.startTime + 0.05, Math.min(at, clip.endTime - 0.05));
        const firstDuration = splitAt - clip.startTime;
        const second = { ...clip, id: `clip-${Date.now()}-${this.clipCounter++}`, startTime: splitAt, duration: clip.duration - firstDuration, endTime: clip.endTime };
        clip.duration = firstDuration;
        clip.endTime = splitAt;
        const track = this.tracks[clip.trackIndex];
        const index = track.clips.findIndex(c => c.id === clip.id);
        track.clips.splice(index + 1, 0, second);
        el.classList.remove('selected');
        this.renderClip(clip, track, clip.trackIndex);
        this.renderClip(second, track, clip.trackIndex);
        el.remove();
        this.updateTimelineWidth();
        window.App?.notify?.('Clip split at playhead');
    }

    onPlaybackEnded() { window.PlayerManager?.stop?.(); }
    updatePlayhead(position) { const p = document.getElementById('playhead'); if (p) p.style.left = `${position}%`; }
    formatTime(seconds) { if (!Number.isFinite(seconds)) return '0:00'; return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
}

window.TimelineManager = new TimelineManager();
