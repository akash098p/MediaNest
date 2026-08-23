"use strict";

class TimelineManager {
    constructor() {
        this.tracks = [];
        this.currentTrackIndex = 0;
        this.clipCounter = 0;
        this.pixelsPerSecond = 50;
        this.initTracks();
        this.renderRuler();
        this.bindTimelineControls();
    }

    bindTimelineControls() {
        const ruler = document.getElementById('timelineRuler');
        ruler?.addEventListener('click', event => {
            if (event.target.closest('.frame')) {
                const rect = ruler.getBoundingClientRect();
                const time = Math.max(0, (event.clientX - rect.left + ruler.scrollLeft) / this.pixelsPerSecond);
                window.PlayerManager?.seek?.(time);
                this.updatePlayheadFromTime(time);
            }
        });
        document.getElementById('timelineZoom')?.addEventListener('input', event => {
            this.pixelsPerSecond = Math.max(10, Number(event.target.value) / 2);
            this.renderRuler();
            this.getClips().forEach(clip => {
                const element = document.getElementById(clip.id);
                if (element) this.updateClipElement(element, clip);
            });
            this.updateTimelineWidth();
        });
        document.querySelectorAll('#tracksContainer .track-content').forEach(content => {
            content.addEventListener('click', event => {
                if (event.target.closest('.timeline-clip')) return;
                const rect = content.getBoundingClientRect();
                const time = Math.max(0, (event.clientX - rect.left + content.scrollLeft) / this.pixelsPerSecond);
                window.PlayerManager?.seek?.(time);
                this.updatePlayheadFromTime(time);
            });
        });
        document.querySelectorAll('#tracksContainer .track-header button').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const row = button.closest('.track-row');
                const trackIndex = [...document.querySelectorAll('#tracksContainer .track-row')].indexOf(row);
                const track = this.tracks[trackIndex];
                if (!row || !track) return;
                const action = button.className;
                if (action.includes('track-mute')) track.muted = !track.muted;
                if (action.includes('track-lock')) track.locked = !track.locked;
                if (action.includes('track-hide')) track.hidden = !track.hidden;
                if (action.includes('track-solo')) track.solo = !track.solo;
                row.classList.toggle('track-muted', !!track.muted);
                row.classList.toggle('track-locked', !!track.locked);
                row.classList.toggle('track-hidden', !!track.hidden);
                const stateKey = action.includes('track-mute') ? 'muted' : action.includes('track-lock') ? 'locked' : action.includes('track-hide') ? 'hidden' : 'solo';
                button.classList.toggle('active', !!track[stateKey]);
                if (action.includes('track-lock')) {
                    button.textContent = track.locked ? 'Unlock' : 'Lock';
                    button.title = `${track.locked ? 'Unlock' : 'Lock'} ${track.type} track`;
                    button.setAttribute('aria-label', button.title);
                }
                if (action.includes('track-hide')) {
                    button.textContent = track.hidden ? 'Show' : 'Hide';
                    button.title = `${track.hidden ? 'Show' : 'Hide'} ${track.type} track`;
                    button.setAttribute('aria-label', button.title);
                }
                if (action.includes('track-mute')) {
                    button.textContent = track.muted ? 'Unmute' : 'Mute';
                    button.title = `${track.muted ? 'Unmute' : 'Mute'} ${track.type} track`;
                    button.setAttribute('aria-label', button.title);
                }
            });
        });
    }

    renderRuler() {
        const ruler = document.getElementById('frameNumbers');
        if (!ruler) return;
        ruler.innerHTML = Array.from({ length: 31 }, (_, index) => {
            const seconds = index * 5;
            const label = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
            return `<div class="frame"><span>${label}</span></div>`;
        }).join('');
    }

    initTracks() {
        this.tracks = [
            { id: 'track-video', name: 'Video Track 1', type: 'video', clips: [], element: document.getElementById('videoTrack1') },
            { id: 'track-audio-1', name: 'Audio Track 1', type: 'audio', clips: [], element: document.getElementById('audioTrack1') },
            { id: 'track-audio-2', name: 'Audio Track 2', type: 'audio', clips: [], element: document.getElementById('audioTrack2') }
        ];
    }

    async addClip(clip, trackIndex = this.currentTrackIndex, preservePosition = false) {
        if (!clip) return null;
        if (clip.type === 'video') trackIndex = 0;
        if (clip.type === 'audio' && trackIndex === 0) trackIndex = 1;
        const track = this.tracks[trackIndex];
        if (!track) return null;
        if (!clip.duration || !Number.isFinite(clip.duration) || clip.duration <= 0) clip.duration = await this.getClipDuration(clip);
        clip.id = String(clip.id || `clip-${Date.now()}-${this.clipCounter++}`);
        clip.trackIndex = trackIndex;
        clip.duration = Math.max(0.05, Number(clip.duration) || 0.05);
        clip.startTime = preservePosition ? Math.max(0, Number(clip.startTime) || 0) : this.findFreeStart(track, clip.duration);
        clip.endTime = clip.startTime + clip.duration;
        track.clips.push(clip);
        this.renderClip(clip, track, trackIndex);
        this.updateTimelineWidth();
        return clip;
    }

    findFreeStart(track, duration) {
        let start = 0;
        const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
        for (const existing of sorted) {
            if (start + duration <= existing.startTime + 0.001) break;
            start = Math.max(start, existing.endTime);
        }
        return start;
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
        clipEl.innerHTML = `<span class="clip-trim-handle clip-trim-left" aria-label="Trim start"></span><span class="clip-name"></span><span class="clip-duration"></span><span class="clip-trim-handle clip-trim-right" aria-label="Trim end"></span>`;
        clipEl.querySelector('.clip-name').textContent = clip.name || 'Untitled';
        clipEl.querySelector('.clip-duration').textContent = this.formatTime(clip.duration);
        clipEl.addEventListener('click', e => { if (!e.defaultPrevented) this.selectClip(clip.id); });
        clipEl.addEventListener('dblclick', e => { e.stopPropagation(); window.PlayerManager?.setElementSource?.(clip); });
        clipEl.addEventListener('mousedown', e => { if (!e.target.closest('.clip-trim-handle')) this.onClipMouseDown(e, clip, trackIndex); });
        clipEl.querySelector('.clip-trim-left').addEventListener('mousedown', e => this.onTrimMouseDown(e, clip, trackIndex, 'left'));
        clipEl.querySelector('.clip-trim-right').addEventListener('mousedown', e => this.onTrimMouseDown(e, clip, trackIndex, 'right'));
        track.element.appendChild(clipEl);
        this.updateClipElement(clipEl, clip);
    }

    updateClipElement(el, clip) {
        el.style.left = `${Math.max(0, clip.startTime) * this.pixelsPerSecond}px`;
        el.style.width = `${Math.max(40, clip.duration * this.pixelsPerSecond)}px`;
        const duration = el.querySelector('.clip-duration');
        if (duration) duration.textContent = this.formatTime(clip.duration);
    }

    updatePlayheadFromTime(time) {
        const duration = window.PlayerManager?.getDuration?.() || 0;
        if (duration > 0) this.updatePlayhead((time / duration) * 100);
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
        const row = e.currentTarget.closest('.track-row');
        if (row?.classList.contains('track-locked')) {
            window.App?.notify?.('Track is locked');
            return;
        }
        e.preventDefault();
        this.selectClip(clip.id);
        const startX = e.clientX;
        const originalStart = clip.startTime;
        const el = e.currentTarget;
        const before = this.snapshotTracks();
        const onMove = ev => {
            if (row?.classList.contains('track-locked')) return;
            const delta = (ev.clientX - startX) / this.pixelsPerSecond;
            const nextStart = Math.max(0, originalStart + delta);
            const snap = document.getElementById('snapToggle')?.checked;
            clip.startTime = snap ? Math.round(nextStart * 10) / 10 : nextStart;
            clip.endTime = clip.startTime + clip.duration;
            this.updateClipElement(el, clip);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (row?.classList.contains('track-locked')) return;
            this.normalizeTrack(trackIndex);
            this.updateTimelineWidth();
            const after = this.snapshotTracks();
            if (Math.abs(before[trackIndex].clips.find(c => c.id === clip.id)?.startTime - clip.startTime) > 0.001) window.EditorManager?.addToHistory?.('move', before, after);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    onTrimMouseDown(e, clip, trackIndex, side) {
        if (this.tracks[trackIndex]?.locked || e.currentTarget.closest('.track-row')?.classList.contains('track-locked')) {
            window.App?.notify?.('Track is locked');
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        this.selectClip(clip.id);
        const startX = e.clientX;
        const originalStart = clip.startTime;
        const originalEnd = clip.endTime;
        const before = this.snapshotTracks();
        const minDuration = 0.05;
        const el = e.currentTarget.closest('.timeline-clip');
        const onMove = ev => {
            const delta = (ev.clientX - startX) / this.pixelsPerSecond;
            if (side === 'left') {
                const newStart = Math.max(0, Math.min(originalEnd - minDuration, originalStart + delta));
                clip.startTime = newStart;
                clip.duration = originalEnd - newStart;
                clip.endTime = originalEnd;
            } else {
                const newEnd = Math.max(originalStart + minDuration, originalEnd + delta);
                clip.endTime = newEnd;
                clip.duration = newEnd - originalStart;
            }
            this.updateClipElement(el, clip);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            const after = this.snapshotTracks();
            window.EditorManager?.addToHistory?.(`${side}_trim`, before, after);
            this.updateTimelineWidth();
            window.App?.notify?.(`${side === 'left' ? 'Start' : 'End'} trimmed`);
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
    getNextClip() { const selected = document.querySelector('.timeline-clip.selected'); return selected ? this.getClips().find(c => c.id === selected.id) || this.getFirstClip() : this.getFirstClip(); }
    displayClips(clips) { this.clearClips(); return Promise.all(clips.map(clip => this.addClip({ ...clip }, Number.isInteger(clip.trackIndex) ? clip.trackIndex : 0, true))); }
    clearClips() { this.tracks.forEach(t => { t.clips = []; if (t.element) t.element.innerHTML = ''; }); }
    snapshotTracks() { return JSON.parse(JSON.stringify(this.tracks.map(t => ({ id: t.id, name: t.name, type: t.type, clips: t.clips })))); }
    removeClip(id) { for (const track of this.tracks) { const i = track.clips.findIndex(c => c.id === id); if (i >= 0) { track.clips.splice(i, 1); document.getElementById(id)?.remove(); this.updateTimelineWidth(); return true; } } return false; }
    selectTrack(index) { if (this.tracks[index]) this.currentTrackIndex = index; }

    splitSelected() {
        const el = document.querySelector('.timeline-clip.selected');
        if (!el) return window.App?.notify?.('No clip selected to split');
        const clip = this.getClips().find(c => c.id === el.id);
        if (!clip || clip.duration < 0.1) return;
        const currentTime = window.PlayerManager?.getCurrentTime?.() || 0;
        const at = currentTime > clip.startTime && currentTime < clip.endTime
            ? currentTime
            : clip.startTime + clip.duration / 2;
        const splitAt = Math.max(clip.startTime + 0.05, Math.min(at, clip.endTime - 0.05));
        const firstDuration = splitAt - clip.startTime;
        const second = { ...clip, id: `clip-${Date.now()}-${this.clipCounter++}`, startTime: splitAt, duration: clip.duration - firstDuration, endTime: clip.endTime };
        clip.duration = firstDuration;
        clip.endTime = splitAt;
        const track = this.tracks[clip.trackIndex];
        const index = track.clips.findIndex(c => c.id === clip.id);
        track.clips.splice(index + 1, 0, second);
        el.remove();
        this.renderClip(clip, track, clip.trackIndex);
        this.renderClip(second, track, clip.trackIndex);
        this.updateTimelineWidth();
        window.App?.notify?.('Clip split at playhead');
    }

    onPlaybackEnded() { window.PlayerManager?.stop?.(); }
    updatePlayhead(position) { const p = document.getElementById('playhead'); if (p) p.style.left = `${position}%`; }
    formatTime(seconds) { if (!Number.isFinite(seconds)) return '0:00'; return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
}

window.TimelineManager = new TimelineManager();
