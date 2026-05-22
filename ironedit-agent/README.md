# IronEdit FFmpeg Rendering Agent

A server-side rendering agent that connects to the IronEdit API via WebSocket and executes FFmpeg to render video from AI-generated EDLs.

## Architecture

```
[Jed's Browser] → [ironedit-ui :3000] → [ironedit-api :8080] ←→ [ironedit-agent]
                                                                         ↓
                                                                      FFmpeg
                                                                         ↓
                                                              /root/ironedit-renders/
```

## How It Works

1. The agent connects to the IronEdit API WebSocket endpoint (`/agent`) using an API key.
2. When the API dispatches an `execute_render` job, the agent receives the EDL (Edit Decision List).
3. The agent builds an FFmpeg `filter_complex` command from the EDL and executes it.
4. Progress updates are sent back to the API via WebSocket.
5. On completion, the artifact path is reported back.

## EDL Schema

```json
{
  "version": 1,
  "output": "/path/to/output.mp4",
  "width": 1280,
  "height": 720,
  "fps": 25,
  "cuts": [
    {
      "source": "/path/to/clip.mp4",
      "in_seconds": 2.0,
      "out_seconds": 6.0,
      "scale": "1280:720",
      "eq": {
        "brightness": 0,
        "contrast": 1.05,
        "saturation": 1.1,
        "gamma": 1.0
      },
      "audio_gain_db": 0
    }
  ],
  "audio_normalize": {
    "target_lufs": -14
  }
}
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `IRONEDIT_WS_URL` | `ws://localhost:8080/agent` | WebSocket URL of the IronEdit API |
| `IRONEDIT_AGENT_KEY` | *(required)* | Agent authentication key |
| `IRONEDIT_API_URL` | `http://localhost:8080` | REST API base URL |
| `IRONEDIT_CONTROL_KEY` | *(required)* | Control API key for status updates |
| `IRONEDIT_WORK_DIR` | `/tmp/ironedit-renders` | Directory for render outputs |
| `FFMPEG_BIN` | `ffmpeg` | Path to FFmpeg binary |
| `FFPROBE_BIN` | `ffprobe` | Path to FFprobe binary |

## Running

```bash
npm install
node agent.js
```

## VPS Notes

- The VPS has 2GB RAM and no swap. FFmpeg 1080p encodes can trigger OOM.
- Default output resolution is **1280×720** to stay within memory limits.
- Use `ultrafast` preset and CRF 26 for speed/quality balance.
- Add a swap file if 1080p rendering is needed: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`
