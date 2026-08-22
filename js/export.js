"use strict";

class ExportManager {
    constructor() {
        this.exportFormat = 'WEBM';
        this.exportQuality = 'High';
        this.isExporting = false;
        this.currentFormat = 'WEBM';
    }

    setFormat(format) { this.exportFormat = String(format || 'WEBM').toUpperCase(); this.currentFormat = this.exportFormat; }
    setQuality(quality) { this.exportQuality = quality || 'High'; }

    getMimeType() {
        const formats = {
            WEBM: 'video/webm;codecs=vp9,opus',
            WEBM_AUDIO: 'audio/webm;codecs=opus',
            MP4: 'video/mp4'
        };
        const preferred = formats[this.exportFormat] || 'video/webm;codecs=vp8,opus';
        if (window.MediaRecorder?.isTypeSupported?.(preferred)) return preferred;
        if (window.MediaRecorder?.isTypeSupported?.('video/webm;codecs=vp8,opus')) return 'video/webm;codecs=vp8,opus';
        return 'video/webm';
    }

    async exportProject() {
        if (this.isExporting) return;
        const player = window.PlayerManager;
        const media = player?.currentElement;
        if (!media?.src) {
            this.notify('Load a media clip before exporting.');
            return;
        }

        // Browser-native export is intentionally limited to formats supported by MediaRecorder.
        // MP4/FLAC/etc. require a real FFmpeg/WebCodecs pipeline and are not faked anymore.
        const mime = this.getMimeType();
        if (this.exportFormat === 'MP4' && mime !== 'video/mp4') {
            this.notify('MP4 export is not supported by this browser. Exporting WebM instead.');
        }

        if (!window.MediaRecorder) {
            this.notify('This browser does not support MediaRecorder export.');
            return;
        }

        this.isExporting = true;
        try {
            const stream = media.captureStream?.();
            if (!stream) throw new Error('Media capture is not supported by this browser.');

            const chunks = [];
            const recorder = new MediaRecorder(stream, { mimeType: mime });
            recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };

            const start = media.currentTime || 0;
            const wasPlaying = !media.paused;
            media.currentTime = 0;

            await new Promise((resolve, reject) => {
                recorder.onstop = resolve;
                recorder.onerror = () => reject(recorder.error || new Error('Export failed'));
                recorder.start(250);
                media.play().catch(reject);
                const finish = () => {
                    media.removeEventListener('ended', finish);
                    if (recorder.state !== 'inactive') recorder.stop();
                    media.currentTime = start;
                    if (wasPlaying) media.play().catch(() => {});
                };
                media.addEventListener('ended', finish, { once: true });
            });

            const blob = new Blob(chunks, { type: recorder.mimeType || mime });
            const ext = (recorder.mimeType || mime).includes('audio') ? 'webm' : 'webm';
            this.downloadBlob(blob, `SonicStudio-export-${Date.now()}.${ext}`);
            this.saveExportHistory(this.exportFormat, this.exportQuality);
            this.notify('Export completed successfully.');
        } catch (error) {
            console.error(error);
            this.notify(`Export failed: ${error.message}`);
        } finally {
            this.isExporting = false;
        }
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    saveExportHistory(format, quality) {
        const history = JSON.parse(localStorage.getItem('sonicstudio-export-history') || '[]');
        history.push({ format, quality, timestamp: new Date().toISOString() });
        localStorage.setItem('sonicstudio-export-history', JSON.stringify(history.slice(-50)));
    }

    notify(message) { window.NotificationManager?.info?.(message); }
}

window.ExportManager = new ExportManager();
