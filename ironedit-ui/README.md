# IronEdit Web UI

A lightweight web frontend for testing the IronEdit AI video editing pipeline.

## Access

**Live URL:** http://167.99.237.26:3000

## Features

- Submit video clips with a brief description → AI generates an EDL → FFmpeg renders the output
- Real-time job status polling
- View generated EDL (Edit Decision List) JSON
- Download rendered video output
- API health dashboard

## API Keys (for testing)

| Key | Value |
|---|---|
| Control API Key | `dev-control-key-please-rotate` |
| Agent API Key | `dev-agent-key-please-rotate` |

> **Security note:** Rotate these keys before production use by updating the `AGENT_API_KEYS` and `CONTROL_API_KEYS` environment variables in the PM2 ecosystem config.

## Running Locally

```bash
npm install
UI_PORT=3000 API_BASE=http://localhost:8080 node server.js
```

## Architecture

The UI server:
1. Serves static HTML/JS from the same directory
2. Proxies `/api/*`, `/health`, and `/agent` to the IronEdit API on port 8080
3. Adds CORS headers to all proxied responses
