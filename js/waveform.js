"use strict";

class WaveformManager {
  constructor() {
    this.canvas = document.getElementById("waveformCanvas");
    this.ctx = this.canvas ? this.canvas.getContext("2d") : null;
    this.audioData = [];
  }

  generate(audioBuffer) {
    if (!this.ctx) return;

    const channelData = audioBuffer.getChannelData(0);
    this.audioData = this.getChannelData(channelData);

    this.draw();
  }

  getChannelData(channelData) {
    const samples = Math.min(channelData.length, 1024);
    const block = Math.floor(channelData.length / samples);
    const data = [];

    for (let i = 0; i < samples; i++) {
      let sum = 0;
      for (let j = 0; j < block; j++) {
        sum += Math.abs(channelData[i * block + j]);
      }
      data.push(sum / block);
    }
    return data;
  }

  draw() {
    if (!this.ctx || !this.canvas) return;

    const width = this.canvas.width;
    const height = this.canvas.height;
    const ctx = this.ctx;

    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#00ff00";
    ctx.beginPath();

    const sliceWidth = width / this.audioData.length;
    let x = 0;

    for (let i = 0; i < this.audioData.length; i++) {
      const v = this.audioData[i];
      const y = height / 2 - (v * height) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    ctx.lineTo(width, height / 2);
    ctx.lineTo(0, height / 2);
    ctx.closePath();
    ctx.fill();
  }

  updateFromAudio(audioElement) {
    if (!audioElement) return;

    audioElement.addEventListener("loadedmetadata", () => {
      // Generate simple waveform based on duration
      this.audioData = Array(100).fill(0.5);
      this.draw();
    });
  }
}

window.WaveformManager = new WaveformManager();
