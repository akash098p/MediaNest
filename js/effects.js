"use strict";

class EffectsManager {
    constructor() {
        this.bassBoost = 0;
        this.trebleBoost = 0;
        this.echo = 0;
        this.reverb = 0;
        this.noiseReduction = 0;
        this.fadeInSeconds = 0;
        this.fadeOutSeconds = 0;
        this.pitchShift = 0;
        this.compressorThreshold = -24;
        this.compressorRatio = 4;
        this.equalizerBands = new Array(10).fill(0);
        this.initEqualizerUI();
        this.bindControls();
    }

    bindControls() {
        const bindings = [['bassBoost', 'setBassBoost'], ['trebleBoost', 'setTrebleBoost'], ['echoAmount', 'setEcho'], ['reverbAmount', 'setReverb'], ['noiseReduction', 'setNoiseReduction'], ['pitchShift', 'setPitchShift']];
        bindings.forEach(([id, method]) => document.getElementById(id)?.addEventListener('input', event => this[method](Number(event.target.value))));
        document.querySelectorAll('[id^="eqBand"]').forEach(input => input.addEventListener('input', event => this.setEqualizerBand(Number(input.id.replace('eqBand', '')), Number(event.target.value))));
        document.getElementById('normalizeBtn')?.addEventListener('click', () => this.normalizeVolume());
        document.getElementById('fadeInSeconds')?.addEventListener('input', event => this.setFadeIn(Number(event.target.value)));
        document.getElementById('fadeOutSeconds')?.addEventListener('input', event => this.setFadeOut(Number(event.target.value)));
        document.getElementById('speedControl')?.addEventListener('input', event => this.setSpeed(Number(event.target.value)));
    }

    selectedClip() {
        const element = document.querySelector('.timeline-clip.selected');
        return element ? window.TimelineManager?.getClips?.().find(clip => clip.id === element.id) : null;
    }

    initEqualizerUI() {
        const container = document.getElementById("equalizerBands");
        if (!container) return;
        
        const frequencies = ['32Hz', '64Hz', '125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz', '8kHz', '16kHz'];
        container.innerHTML = '';
        
        frequencies.forEach((freq, i) => {
            const band = document.createElement('div');
            band.className = 'eq-band';
            band.innerHTML = `
                <label>${freq}</label>
                <input type="range" id="eqBand${i}" min="-12" max="12" value="0">
            `;
            container.appendChild(band);
        });
    }

    setBassBoost(value) {
        this.bassBoost = value;
        window.PlayerManager?.applyEffects?.();
        this.notify(`Bass Boost: ${value}dB`);
    }

    setTrebleBoost(value) {
        this.trebleBoost = value;
        window.PlayerManager?.applyEffects?.();
        this.notify(`Treble: ${value}dB`);
    }

    setEcho(amount) {
        this.echo = amount;
        const clip = this.selectedClip(); if (clip) clip.echo = amount;
        window.PlayerManager?.applyEffects?.();
        this.notify(`Echo: ${amount}%`);
    }

    setReverb(amount) {
        this.reverb = amount;
        const clip = this.selectedClip(); if (clip) clip.reverb = amount;
        window.PlayerManager?.applyEffects?.();
        this.notify(`Reverb: ${amount}%`);
    }

    setNoiseReduction(amount) {
        this.noiseReduction = amount;
        const clip = this.selectedClip(); if (clip) clip.noiseReduction = amount;
        this.notify(`Noise Reduction: ${amount}%`);
    }

    setFadeIn(seconds) {
        this.fadeInSeconds = seconds;
        const clip = this.selectedClip(); if (clip) window.PlayerManager?.setFadeIn?.(seconds, clip);
        this.notify(`Fade In: ${seconds}s`);
    }

    setFadeOut(seconds) {
        this.fadeOutSeconds = seconds;
        const clip = this.selectedClip(); if (clip) window.PlayerManager?.setFadeOut?.(seconds, clip);
        this.notify(`Fade Out: ${seconds}s`);
    }

    setPitchShift(semitones) {
        this.pitchShift = semitones;
        const clip = this.selectedClip(); if (clip) clip.pitchShift = semitones;
        this.notify(`Pitch Shift: ${semitones} semitones`);
    }

    setEqualizerBand(index, value) {
        if (index >= 0 && index < this.equalizerBands.length) {
            this.equalizerBands[index] = value;
            const clip = this.selectedClip(); if (clip) clip.equalizerBands = [...this.equalizerBands];
            window.PlayerManager?.applyEffects?.();
            this.notify(`EQ Band ${index + 1}: ${value}dB`);
        }
    }

    normalizeVolume() {
        const clip = this.selectedClip();
        if (!clip) return this.notify('Select an audio or video clip first');
        clip.volume = 1;
        window.PlayerManager?.setVolume?.(100, clip);
        this.notify('Volume normalized');
    }

    setSpeed(value) {
        const clip = this.selectedClip();
        if (clip) { clip.playbackRate = value; window.PlayerManager?.setPlaybackRate?.(value); }
        this.notify(`Playback speed: ${value}x`);
    }

    // Apply effects to an audio context (placeholder for real audio processing)
    applyToContext(audioContext, sourceNode) {
        // This would set up Web Audio API nodes for real-time effects
        console.log("Applying effects to audio context:", {
            bassBoost: this.bassBoost,
            trebleBoost: this.trebleBoost,
            echo: this.echo,
            reverb: this.reverb,
            noiseReduction: this.noiseReduction,
            pitchShift: this.pitchShift
        });
    }

    notify(message) {
        if (window.NotificationManager) {
            window.NotificationManager.info(message);
        }
    }

    getEffectSettings() {
        return {
            bassBoost: this.bassBoost,
            trebleBoost: this.trebleBoost,
            echo: this.echo,
            reverb: this.reverb,
            noiseReduction: this.noiseReduction,
            fadeInSeconds: this.fadeInSeconds,
            fadeOutSeconds: this.fadeOutSeconds,
            pitchShift: this.pitchShift,
            compressorThreshold: this.compressorThreshold,
            compressorRatio: this.compressorRatio,
            equalizerBands: [...this.equalizerBands]
        };
    }
}

window.EffectsManager = new EffectsManager();