# MediaNest - Professional Browser-Based Audio & Video Editor

## 🎬 Welcome to MediaNest

MediaNest is a powerful, audio and video editing application that brings professional-grade editing capabilities to the web platform.

## 🌟 Key Features

### 🎥 Video Editing Suite
- **Clip Editing**: Trim, cut, splice, and arrange video clips on a multi-track timeline
- **Visual Effects**: Apply filters, transitions, and color corrections
- **Transformations**: Rotate, resize, and reposition video elements
- **Multi-track Timeline**: Independent video and audio tracks for complex editing

### 🎧 Audio Editing Suite
- **Multi-track Mixing**: Balance audio levels, pan channels, and apply effects
- **Advanced Effects**: Bass Boost, Treble, Equalizer, Reverb, Echo, Noise Reduction
- **Audio Processing**: Normalization, pitch shifting, playback speed control

### 📤 Export & Sharing
- **Multiple Export Formats**: MP4, MP3, WAV, AAC, OGG, FLAC
- **Quality Control**: Adjust bitrate, resolution, and compression settings
- **Batch Export**: Export multiple projects at once
- **Direct Sharing**: Generate shareable links for collaboration

### 🎥 Recording Capabilities
- **Microphone Recording**: Capture high-quality audio directly in the browser
- **System Audio Recording**: Record system audio output
- **Screen Recording**: Capture video and audio from your desktop
- **Instant Playback**: Immediate preview of recordings

### 🎨 User Interface
- **Multiple Workspaces**: Switch between Editor, Effects, Recording, and Project views
- **Customizable Themes**: Dark, Light, Midnight, and Neon themes
- **Intuitive Interface**: Drag-and-drop media library with real-time feedback
- **Keyboard Shortcuts**: Efficient workflow with spacebar play/pause and arrow keys for navigation

### 🧰 Standalone Media Tools (FFmpeg backend)
A suite of individual, single-purpose tools with their own home page — powered by a
Node.js + FFmpeg backend so heavy processing runs on your machine, not in a tab:

- **Audio**: Converter · Add cover art / make MP4 · Fade transition · Change speed · Trim audio · Volume · Merge · Mix · Remove noise · Remove silence · Repair M4A
- **Video**: Compressor · Extract audio · Remove sound · Convert format · Crop · Resize · Rotate · Trim · Merge videos · Replace audio
- **GIF**: GIF compressor · Video → GIF

See **[Tools Suite](#--tools-suite)** below for setup.

## 📂 Project Structure

```
MediaNest/
├── css/                # Professional styling with premium themes
├── js/                 # Complete JavaScript implementation:
│   ├── ui.js           # UI manager with workspace switching
│   ├── player.js       # Video/audio player with playback controls
│   ├── timeline.js     # Multi-track timeline management
│   ├── storage.js      # Browser localStorage persistence
│   ├── notifications.js# System notifications & alerts
│   ├── loading.js      # Startup sequence manager
│   ├── editor.js       # Editing operations & shortcuts
│   ├── waveform.js     # Audio waveform visualization
│   ├── recorder.js     # Recording functionality
│   ├── export.js       # Export manager with format selection
│   └── ffmpeg.js       # Media processing engine
├── tools/              # 🆕 Standalone media tools UI (home page + per-tool pages)
├── server/             # 🆕 Node.js + Express + FFmpeg backend for the tools
│   ├── server.js       # API + static file server
│   ├── tools.js        # Registry of all 24 tools (ffmpeg command builders)
│   └── lib/ffmpeg.js   # ffmpeg/ffprobe runner helpers
├── index.html          # Main application entry point with full UI
└── README.md           # Documentation
```

## 🚀 Getting Started

1. **Open the Application**: Simply open `index.html` in your browser
2. **Create New Project**: Click "New Project" to start fresh
3. **Import Media**: Drag and drop files into the Media Library
4. **Edit Your Project**: 
   - Drag clips onto the timeline
   - Trim and cut clips with precision
   - Apply visual effects and audio effects
   - Adjust volume, opacity, and transformations
5. **Export Your Work**: Choose format and quality, then save

## 🧰 Tools Suite (FFmpeg backend)

The standalone tools run through a small Node.js backend that shells out to FFmpeg.
This gives real, fast processing for jobs a browser cannot do well (MP3 encoding,
M4A repair, noise removal, GIF palette optimization, etc.).

### 1. Requirements
- **Node.js 18+** (`node -v`)
- **FFmpeg + ffprobe** on your PATH (`ffmpeg -version`)

### 2. Start the backend
```bash
cd server
npm install        # express + multer
node server.js     # http://localhost:4000
```

### 3. Open the tools
- **Tools home page** → http://localhost:4000/tools/index.html
- **Main editor** → http://localhost:4000/index.html
  (the editor's top menu also has a **Tools** button linking there)

Pick any tool card, drop your file(s) in, adjust the options and press **Start**.
The result is previewed inline with a download button.

### 4. Available tools

| Group | Tool | What it does |
|---|---|---|
| Audio | Audio Converter | MP3 ⇄ WAV / OGG / FLAC / M4A / AAC / OPUS |
| Audio | Add Cover Art / MP4 | Attach cover to MP3 or build an MP4 music video from audio + image |
| Audio | Audio Transition | Fade-in / fade-out transitions |
| Audio | Change Speed | Speed up / slow down without pitch change |
| Audio | Trim Audio | Extract a start → end segment |
| Audio | Volume | Raise or lower loudness |
| Audio | Merge Audio | Concatenate several tracks |
| Audio | Mix Audio | Play several tracks at once |
| Audio | Remove Noise | FFT denoise (afftdn) |
| Audio | Remove Silence | Trim silent gaps |
| Audio | Audio Compressor | Shrink any audio — fraction of source bitrate, optional mono |
| Audio | Repair M4A | Remux truncated/damaged files |
| Video | Extract Audio | Save the video's soundtrack as MP3/WAV/… |
| Video | Remove Sound | Silent video (audio track dropped) |
| Video | Video Compressor | CRF-based size reduction (+ optional scale) |
| GIF | GIF Compressor | Smaller GIFs via scale + fps |
| GIF | Video → GIF | Palette-optimized animated GIF |
| Editing | Convert Format | MP4 / WebM / MOV |
| Editing | Crop / Resize / Rotate / Trim | Geometry edits |
| Editing | Merge Videos / Replace Audio | Multi-input operations |

### 5. Configuration
| Variable | Purpose |
|---|---|
| `PORT` | Server port (default `4000`) — `PORT=5000 node server.js` |
| `FFMPEG_PATH` | Custom ffmpeg binary path if not on PATH |
| `FFPROBE_PATH` | Custom ffprobe binary path if not on PATH |

## 💡 Advanced Features

- **Multi-track Editing**: Work with separate audio tracks simultaneously
- **Live Preview**: Real-time playback with visual effects
- **Project Autosave**: Automatic saving with version history
- **Custom Themes**: Personalize the look and feel of the app
- **Keyboard Shortcuts**: Efficient workflow with spacebar, arrow keys, and shortcuts

## 🛠️ Technical Implementation

### 🧩 Core Components
- **UIManager**: Controls workspace visibility and user interactions
- **PlayerManager**: Handles media playback, volume control, seek functionality
- **TimelineManager**: Manages multi-track operations and clip positioning
- **StorageManager**: Persists project data using browser localStorage
- **App Controller**: Orchestrates initialization, main loop, and theme loading

### 🌐 Remote Access (Mode 5)
MediaNest supports remote access through a secure tunnel:
1. Open AionUi from your computer
2. Enable WebUI in Settings → WebUI → Turn it on
3. Use the remote access feature to open AionUi from your phone or another device
4. Share the generated access link with others

## 🛠️ Technical Requirements

- **Browser**: Modern web browser (Chrome, Firefox, Edge, Safari)
- **Internet Connection**: Required for initial setup and updates
- **No Installation**: Runs entirely in the browser
- **No Server**: Client-side only application

## 🛠️ Support & Contribution

For support, bug reports, and feature requests:
- Visit the project's issue tracker on GitHub
- Submit pull requests for improvements
- Share your creations using #MediaNest
- Join the community discussion on our forum

## 📜 License

MediaNest is released under the MIT License - see `LICENSE` file for details.

## 📞 Support

