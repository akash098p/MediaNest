# 🎬 MediaNest

<p align="center">
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5" />
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white" alt="CSS3" />
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/FFmpeg-007808?style=for-the-badge&logo=ffmpeg&logoColor=white" alt="FFmpeg" />
  <img src="https://img.shields.io/badge/Local--First-00A67E?style=for-the-badge&logo=lock&logoColor=white" alt="Local First" />
  <img src="https://img.shields.io/badge/Offline--Ready-5C2D91?style=for-the-badge&logo=wifi&logoColor=white" alt="Offline Ready" />
</p>

**A local-first audio/video studio + swiss-army toolbox that runs entirely on your own machine.**

MediaNest ships as two apps served by one tiny Node.js server:

| App | Entry | What it is |
|---|---|---|
| 🎞️ **MediaNest Editor** | `/index.html` | A browser-based timeline editor with recording, effects, live visualizers and project files |
| 🧰 **MediaNest Tools** | `/tools/index.html` | A registry-driven portal of **31 one-purpose FFmpeg tools** for audio, video and GIF work |

Everything runs locally through the bundled Node server — files never leave your computer, and both apps work fully offline once set up.

---

## ✨ Highlights

- 🔒 **100% local & private** — uploads are staged in your OS temp folder and deleted when the job finishes
- ⚡ **Zero build step** — plain HTML/CSS/JS front-end, one Express back-end, no bundlers
- 🎛️ **31 tools out of the box** — convert, compress, trim, merge, mix, clean up, resize, rotate, flip, reverse, re-time, GIF-fy…
- 🤖 **Smart quality defaults** — bitrates mirror the source file, so conversions never silently balloon in size
- 🖼️ **Registry-driven UI** — every tool's form (inputs, dropdowns, limits) is generated from `server/tools.js`
- 🎥 **Real editor** — multi-track timeline, clip ops, mic/system/screen recording, spectrum & waveform views
- 🚀 **One-click launch** — `run-tools.bat` installs dependencies, boots the server and opens your browser

---

## 💻 Preview

<div align="center">
  <video src="https://github.com/user-attachments/assets/02bc12e1-f193-4daf-a4a2-78d51856bb28" controls width="100%";>
    Your browser does not support the video tag.
  </video>
</div>

| Demo 1 | Demo 2 |
| :---: | :---: |
| <video src="https://github.com/user-attachments/assets/3705fc35-2721-425a-86ac-4e6752c231d9" width="100%"></video> | <video src="https://github.com/user-attachments/assets/dc9a47f6-c0a7-4cb6-8e44-220fa9702f63" width="100%"></video> |



---

## 🎞️ MediaNest Editor

The main app (`index.html`) is a full multi-workspace editing environment:

| Workspace | What you get |
|---|---|
| **Editor** | Media library with drag-&-drop, zoomable multi-track timeline with clip **split / cut / copy / paste / duplicate / join / delete**, undo-redo history, timeline markers, per-track mute · lock · hide, clip inspector + audio mixer |
| **Effects** | Audio effect sliders (bass boost, etc.) and quick video processing actions on the selected clip |
| **Record** | Capture from **microphone**, **system audio**, or the **screen** straight into the project |
| **Project** | Save / open project files so sessions survive reloads |
| **Appearance** | Theme selector for the whole studio |

Also built in:

- ▶️ Preview player with live **frequency spectrum** and **waveform** visualizers
- 📤 Export dialog with format choice, plus advanced video processing pipeline
- ⌨️ Keyboard shortcuts (e.g. `Space` = play/pause), plugin manager and notification system
- 💾 Metadata database + local storage layer (`js/database.js`, `js/storage.js`)

---

## 🧰 Tools Portal

The portal at `/tools/index.html` groups all tools into **Audio**, **Video** and **GIF**
cards. Clicking a tool opens the same generic `tool.html` page, whose form is generated
from that tool's registry entry. **Drag & drop** files straight into any tool (or click to
browse), tweak the options, hit run — FFmpeg does the work server-side and the result appears
in a preview panel with download buttons.

How jobs are handled:

1. Files are uploaded as `multipart/form-data` (up to **1 GB**) and staged in a temp folder
2. `ffprobe` inspects the media so smart defaults can mirror source quality
3. The tool's `build()` produces an ffmpeg argument list; output goes back inline
4. Temp inputs and outputs are cleaned up automatically after every request

## 🛠️ All 31 Tools

### 🔊 Audio (13)

| Tool | What it can do | Key options |
|---|---|---|
| **Audio Converter** | Convert between MP3, WAV, OGG, FLAC, M4A, AAC, OPUS and more | Output format; bitrate *Auto* (mirrors source) or 96–320 kbps · drag-&-drop many files at once — download individually or as a single ZIP |
| **Add Cover Art / MP4** | Embed album art into an MP3, or combine audio + image into an MP4 "music video" | MP3-cover or MP4 mode; output width/height |
| **Audio Compressor** | Shrink file size to a fraction of the **source** bitrate — never bigger | Compress by *preset level* (light/balanced/strong/extreme), *percentage of original*, or a *target size (KB/MB)* · keep/auto format · mono downmix |
| **Audio Transition (Fade)** | Smooth fade-in / fade-out transitions, auto-timed to track length | Fade-in & fade-out seconds |
| **Merge Audio (Concatenate)** | Join multiple files end-to-end into one track | Multi-select, plays in the chosen order |
| **Change Audio Speed** | Speed up or slow down audio **without changing pitch** | 0.25× – 4× speed |
| **Reverse Audio** | Play an audio file backwards — every sample is mirrored end-to-end | — |
| **Trim Audio** | Extract a segment losslessly (stream copy) | Start & end in `mm:ss` or seconds |
| **Increase / Decrease Volume** | Raise or lower loudness | Gain from −30 dB to +30 dB |
| **Mix Audio** | Overlay tracks so they play **at the same time** | Multi-select; longest input wins |
| **Remove Noise** | Reduce background hiss/static via FFmpeg's `afftdn` filter | Noise reduction −40…−5 dB |
| **Remove Silence** | Strip leading/trailing silence and long dead gaps | Threshold (dB) + minimum gap length |
| **Repair M4A** | Rebuild truncated or damaged M4A/MP4 audio by remuxing | — |

### 🎥 Video (12)

| Tool | What it can do | Key options |
|---|---|---|
| **Extract Audio from Video** | Save a video's soundtrack as its own audio file | mp3 / wav / aac / m4a / ogg / flac |
| **Remove Sound from Video** | Delete the audio track — video stream is copied untouched | — |
| **Video Compressor** | Targets a fraction of the source bitrate so the result is **always smaller** | Level; optional width scale; MP4 or WebM |
| **Replace Audio in Video** | Swap a video's soundtrack with a new audio file | Replacement audio upload |
| **Convert Video Format** | Transcode to MP4, WebM or MOV without bloating the file | Format; Auto quality matches source bitrate (or high/balanced/small) |
| **Crop Video** | Cut a rectangular region out of any video | Width / height / X / Y in pixels |
| **Resize Video** | Scale to new dimensions while keeping aspect ratio | Target W × H |
| **Rotate Video** | Straighten sideways phone clips | 90° / 180° / 270° |
| **Flip Video** | Mirror a video horizontally, vertically, or both — great for selfies | Horizontal / Vertical / Both |
| **Reverse Video** | Play a video backwards — both picture and soundtrack are reversed end-to-end | — |
| **Trim Video** | Keep only a start→end slice | Timestamps |
| **Merge Videos** | Concatenate multiple clips into a single file | Multi-select order |

### 🌈 GIF (6)

| Tool | What it can do | Key options |
|---|---|---|
| **GIF Compressor** | Smaller GIFs via down-scaling + frame-rate reduction | Width (0 = keep); frame rate 1–30 fps |
| **Video to GIF** | Optimized animated GIF from any clip using FFmpeg palette generation for crisp colors | Frame rate; scale width |
| **Resize GIF** | Resize an animated GIF to a new width and height (keeps aspect ratio unless you lock it) | Width; height (0 = auto) |
| **Crop GIF** | Crop a region out of an animated GIF — pick standard aspect ratios or draw a free box | Width / height / X / Y in pixels |
| **GIF to Video** | Turn an animated GIF into a shareable video | MP4 (+faststart) / WebM VP9 / MOV; odd sizes auto-aligned to even pixels |
| **Create GIF from Images** | Build a slideshow GIF from a set of images shown in order | Seconds per image; fps; canvas W × H |

---

## 🚀 Quick Start

### Requirements

| Need | Notes |
|---|---|
| [Node.js](https://nodejs.org) 18+ | Only runtime dependency (`express` + `multer` auto-install on first run) |
| [FFmpeg](https://ffmpeg.org) | Must be on `PATH` (or point `FFMPEG_PATH` / `FFPROBE_PATH` at the binaries) |

### Easiest way (Windows)

Clone the repository:
   ```bash
   git clone https://github.com/akash098p/MediaNest.git
   cd MediaNest
   ```

Double-click **`run-tools.bat`**. It will:

1. Verify Node.js is installed
2. Run `npm install` inside `server/` on first launch
3. Start the server (skips startup if it already responds)
4. Open the Tools Portal in your default browser

### Manual way (any OS)

```bash
git clone https://github.com/akash098p/MediaNest.git
cd server
npm install
npm start            # serves on http://localhost:4000
```

Then visit:

- Tools Portal → **http://localhost:4000/tools/index.html**
- Main Editor → **http://localhost:4000/index.html**

> 💡 Use a different port with `PORT=8080` (manual) or `set MEDIA_NEST_PORT=8080` before running `run-tools.bat`.

---

## 📁 Project Structure

```
Media-Nest/
├── index.html            # Main editor application
├── run-tools.bat         # One-click Windows launcher
├── css/                  # Editor stylesheets
├── js/                   # Editor front-end modules (timeline, recorder,
│                         #   effects, exporter, storage, speech-bubble…)
├── assets/ fonts/        # Static resources
├── icons/                # Per-tool PNG icons
├── libraries/ workers/   # Vendored libs & web workers
├── tools/
│   ├── index.html        # Tools Portal homepage (grouped tool cards)
│   ├── tool.html         # Generic per-tool page (form built from the registry)
│   └── tools.css         # Portal styling
└── server/
    ├── server.js         # Express app: static hosting + JSON API
    ├── package.json      # express ^4, multer ^2 (no other deps!)
    ├── lib/ffmpeg.js     # ffmpeg/ffprobe wrappers + media probing
    └── tools.js          # ★ The 31-tool registry — edit me to add tools
```

---

## 🔌 REST API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/tools` | Public list of every tool (id, name, group, icon, description, form fields) — this is what powers the portal cards and forms |
| `GET` | `/api/health` | `{ ok }` plus which ffmpeg binary will be used |
| `POST` | `/api/tools/:id` | Run a tool: multipart fields named after the tool's inputs + regular params; responds with the processed file |

## ⚙️ Configuration

| Environment variable | Default | Effect |
|---|---|---|
| `PORT` / `MEDIA_NEST_PORT` | `4000` | HTTP port (`run-tools.bat` reads `MEDIA_NEST_PORT`) |
| `FFMPEG_PATH` | `ffmpeg` | Custom path to the ffmpeg binary |
| `FFPROBE_PATH` | `ffprobe` | Custom path to the ffprobe binary |

## ➕ Adding Your Own Tool

The whole toolbox is data-driven — drop an entry into **`server/tools.js`** and it instantly
appears on the portal with its own generated page:

```js
tools.push({
  id: "my-tool",                    // used in the URL  → /tools/tool.html?id=my-tool
  name: "My Tool",                  // shown on cards & pages
  group: "Audio",                   // Audio | Video | GIF  (portal section)
  icon: "icons/my tool.png",        // PNG in /icons
  description: "One clear sentence.",
  inputs: [{ name: "audio", label: "Audio file", accept: "audio/*" }],
  fields: [
    { name: "gain", label: "Gain (dB)", type: "number", default: 3, min: -12, max: 12 },
  ],
  defaultExt: "mp3",
  build(ctx) {                      // returns ffmpeg args + output extension
    return {
      args: ["-i", ctx.file("audio"), "-af", `volume=${ctx.param("gain")}dB`],
      ext: "mp3",
    };
  },
});
```

`build(ctx)` receives uploaded file paths (`ctx.file()` / `ctx.files()`), user params
(`ctx.param()`), and probed media info (`ctx.media`, `ctx.duration`).

## 🩺 Troubleshooting

- **"ffmpeg not found"** at startup → install FFmpeg or set `FFMPEG_PATH`/`FFPROBE_PATH`
- **Port already in use** → pick another port (`set MEDIA_NEST_PORT=8080`, then re-run the launcher)
- **Portal shows no tools** → check `http://localhost:4000/api/health`; if it fails, the server isn't running
- **Launcher opens but server is dead** → close any stray `node.exe` processes, then run `server/npm install` manually

## 🧱 Tech Stack

- **Front-end:** vanilla HTML/CSS/JavaScript (no frameworks, no build step)
- **Back-end:** Node.js + Express 4, Multer 2 uploads, child-process FFmpeg/ffprobe
- **Processing engine:** [FFmpeg](https://ffmpeg.org) — encoding, filtering, palette GIFs

---

## 📬 Contact

<h3>Akash Pramanik</h3>

<p>
  <strong>For questions or support: </strong>
<a href="https://instagram.com/akash.098p" target="_blank">
  <img src="https://img.shields.io/badge/akash.098p-E4405F?style=flat&logo=instagram&logoColor=white"/>
</a> 

<a href="mailto:akashpramanik098@gmail.com">
  <img src="https://img.shields.io/badge/akashpramanik422%40gmail.com-D14836?style=flat&logo=gmail&logoColor=white"/>
</a>
</p>
