"use strict";

const { spawn } = require("child_process");
const path = require("path");

/**
 * Locate a usable ffmpeg binary.
 * Priority: FFMPEG_PATH env var  ->  system "ffmpeg" on PATH.
 * (An A/V backend cannot run without FFmpeg; we detect it on startup.)
 */
function resolveFfmpeg() {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

const FFMPEG = resolveFfmpeg();

/** Check whether the ffmpeg binary is available (cached result). */
let _available = null;
function isAvailable() {
  if (_available !== null) return _available;
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, ["-version"], { windowsHide: true });
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("error", () => {
      _available = false;
      resolve(false);
    });
    proc.on("close", (code) => {
      _available = code === 0 && /ffmpeg/i.test(out);
      resolve(_available);
    });
  });
}

/**
 * Run an ffmpeg command.
 * @param {string[]} args full argument list including input/output
 * @returns {Promise<{stdout:string,stderr:string,command:string}>}
 */
function runFfmpeg(args, { timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const flat = args.flat(Infinity).map(String);
    const full = ["-hide_banner", "-loglevel", "error", "-y", ...flat];
    let stdout = "",
      stderr = "";
    let timedOut = false;
    const proc = spawn(FFMPEG, full, { windowsHide: true });
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          proc.kill("SIGKILL");
        }, timeoutMs)
      : null;

    proc.stdout && proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr && proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut)
        return reject(new Error("FFmpeg timed out while processing the file."));
      if (code === 0) return resolve({ stdout, stderr });
      reject(
        new Error(
          `FFmpeg exited with code ${code}.\n${tail(stderr)}`,
        ),
      );
    });
  });
}

function tail(str, n = 500) {
  return str ? str.trim().slice(-n) : "";
}

/** Probe the duration (in seconds) of a media file using ffprobe. */
function probeDuration(file) {
  return new Promise((resolve, reject) => {
    const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
    const proc = spawn(
      ffprobe,
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { windowsHide: true },
    );
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      const secs = parseFloat(out.trim());
      if (code === 0 && isFinite(secs) && secs > 0) resolve(secs);
      else reject(new Error("Could not read media duration."));
    });
  });
}

/**
 * Full media probe: duration + per-stream bitrates + dimensions.
 * Used so re-encodes can MIRROR the source bitrate instead of inflating files.
 */
function probeMedia(file) {
  return new Promise((resolve, reject) => {
    const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
    const proc = spawn(
      ffprobe,
      [
        "-v", "error",
        "-print_format", "json",
        "-show_format", "-show_streams",
        file,
      ],
      { windowsHide: true },
    );
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error("ffprobe failed."));
      try {
        const j = JSON.parse(out || "{}");
        const fmt = j.format || {};
        const streams = j.streams || [];
        const num = (v) => {
          const n = parseFloat(v);
          return isFinite(n) && n > 0 ? n : null;
        };
        const audio = streams.find((s) => s.codec_type === "audio");
        const video = streams.find((s) => s.codec_type === "video");

        let audioBitrate = num(audio && audio.bit_rate);
        let videoBitrate = num(video && video.bit_rate);
        let total = num(fmt.bit_rate);

        // Some containers (MKV…) omit stream bitrates — derive them.
        if (!audioBitrate && total && videoBitrate)
          audioBitrate = Math.max(0, total - videoBitrate);
        if (!videoBitrate && total && audioBitrate)
          videoBitrate = Math.max(0, total - audioBitrate);

        const duration =
          num(fmt.duration) ??
          num(video && video.duration) ??
          num(audio && audio.duration) ??
          0;

        // Last resort: average bitrate from file size.
        if (!total && duration > 0) {
          try {
            const st = require("fs").statSync(file);
            total = (st.size * 8) / duration;
          } catch (e) {}
        }

        resolve({
          duration: duration || 0,
          audioBitrate,
          videoBitrate,
          totalBitrate: total,
          width: num(video && video.width) || 0,
          height: num(video && video.height) || 0,
          // Needed by the pitch-shift tool's resample method (asetrate must
          // be relative to the REAL source rate, not an assumed 44.1 kHz).
          sampleRate: num(audio && audio.sample_rate) || 0,
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}

module.exports = {
  FFMPEG,
  runFfmpeg,
  isAvailable,
  probeDuration,
  probeMedia,
  tail,
};