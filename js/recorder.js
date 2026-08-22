"use strict";

class RecorderManager {
    constructor() {
        this.mediaRecorder = null;
        this.recording = false;
        this.stream = null;
        this.chunks = [];
        this.recordedBlob = null;
        this.recordingKind = null;
    }

    getSupportedMimeType(preferVideo = false) {
        const candidates = preferVideo
            ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
            : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
        return candidates.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
    }

    async startRecording() {
        return this.startMediaRecording(await navigator.mediaDevices.getUserMedia({ audio: true }), 'audio');
    }

    async startSystemAudioRecording() {
        try {
            const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            const audioTracks = display.getAudioTracks();
            if (!audioTracks.length) {
                display.getTracks().forEach(t => t.stop());
                throw new Error('No system audio track was shared. Enable audio when selecting the screen/window.');
            }
            display.getVideoTracks().forEach(t => t.stop());
            const audioStream = new MediaStream(audioTracks);
            return this.startMediaRecording(audioStream, 'audio');
        } catch (error) {
            window.App?.notify?.(`System audio recording failed: ${error.message}`);
        }
    }

    async startScreenRecording() {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            return this.startMediaRecording(stream, 'video');
        } catch (error) {
            window.App?.notify?.(`Screen recording failed: ${error.message}`);
        }
    }

    startMediaRecording(stream, kind) {
        if (!window.MediaRecorder) throw new Error('MediaRecorder is not supported by this browser.');
        if (this.recording) this.stopRecording();

        const mimeType = this.getSupportedMimeType(kind === 'video');
        this.stream = stream;
        this.chunks = [];
        this.recordingKind = kind;
        this.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

        this.mediaRecorder.ondataavailable = event => {
            if (event.data?.size) this.chunks.push(event.data);
        };
        this.mediaRecorder.onstop = () => this.finishRecording();
        this.mediaRecorder.onerror = event => window.App?.notify?.(`Recording error: ${event.error?.message || 'unknown error'}`);

        this.mediaRecorder.start(250);
        this.recording = true;
        window.App?.notify?.(kind === 'video' ? 'Screen recording started' : 'Audio recording started');

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) videoTrack.addEventListener('ended', () => this.stopRecording(), { once: true });
    }

    stopRecording() {
        if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return;
        this.mediaRecorder.stop();
        this.recording = false;
        this.stream?.getTracks().forEach(track => track.stop());
    }

    finishRecording() {
        const mime = this.mediaRecorder?.mimeType || (this.recordingKind === 'video' ? 'video/webm' : 'audio/webm');
        this.recordedBlob = new Blob(this.chunks, { type: mime });
        const clip = {
            id: `recording-${Date.now()}`,
            name: `${this.recordingKind === 'video' ? 'Screen' : 'Audio'} Recording ${new Date().toLocaleTimeString()}`,
            type: this.recordingKind,
            src: URL.createObjectURL(this.recordedBlob),
            duration: 0,
            blob: this.recordedBlob
        };
        window.UIManager?.addClipToLibrary?.(clip);
        window.UIManager?.addClipToTimeline?.(clip);
        window.App?.notify?.('Recording saved to media library');
        this.mediaRecorder = null;
        this.stream = null;
        this.chunks = [];
    }
}

window.RecorderManager = new RecorderManager();
