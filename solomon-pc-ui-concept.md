# Solomon PC UI Concept: "Solomon Desktop"

## Overview
Jed requires a local PC interface for Solomon—a dashboard or chat panel he can interact with directly on his Windows PC, similar to how he interacts with Manus via Telegram, but native to his desktop environment. This document outlines the conceptual architecture, features, and implementation plan for "Solomon Desktop."

## Architecture Approach
The most efficient and maintainable approach is a **Standalone Lightweight Electron App**. 

While integrating into IronEdit is possible, keeping Solomon Desktop standalone ensures:
1. **Separation of Concerns:** IronEdit remains focused on video editing, while Solomon Desktop acts as the general-purpose AI assistant.
2. **Always-On Availability:** Solomon Desktop can run in the system tray and be summoned via a global hotkey (e.g., `Ctrl+Space`), regardless of whether IronEdit is open.
3. **Shared Backend:** The Electron app will communicate directly with the existing `solomon-bot` backend on the VPS (167.99.237.26) via a new WebSocket or REST API layer, ensuring it's the exact same "Sol" that Jed talks to on Telegram.

## Core Features

### 1. The Chat Interface
- **Familiar UX:** Modeled after the Manus AI UI and Telegram.
- **Real-Time Streaming:** Responses stream in real-time.
- **Context Awareness:** The chat history syncs with the VPS database, so a conversation started on Telegram can be continued on the PC.

### 2. Real-Time Task Dashboard
- **Live Execution View:** A side panel showing active tasks, queued tasks, and recently completed tasks.
- **Agent Logs:** A live feed of what the PC Agent is currently doing (e.g., "Opening browser...", "Scraping vidIQ...").
- **Visual Feedback:** When Sol executes a PC command, the UI briefly highlights the action.

### 3. Quick-Action Buttons
- **Contextual Actions:** Buttons for common tasks (e.g., "Summarize this page", "Scrape vidIQ", "Check IronEdit status").
- **Screen Context:** A button to instantly send a screenshot of the current active window to Sol for analysis.

### 4. System Tray & Hotkey Integration
- Runs silently in the background.
- Summoned instantly via a global keyboard shortcut.

## Implementation Plan

### Phase 1: Backend API (VPS)
1. Add an Express.js REST/WebSocket server to `bot.js` alongside the Telegram polling.
2. Expose endpoints for:
   - Sending/receiving messages.
   - Fetching task queue status (`/task_results`, `/improvement_status`).
   - Streaming PC Agent logs.

### Phase 2: Electron App Scaffold (Local PC)
1. Initialize a minimal Electron + React + TailwindCSS project.
2. Build the main chat view and connect it to the VPS API.
3. Implement the system tray icon and global hotkey listener.

### Phase 3: Dashboard & Integration
1. Build the Task Dashboard panel.
2. Add the "Capture Screen" utility using Electron's `desktopCapturer` API.
3. Package the app into a Windows installer (`.exe`).

## Next Steps
Review this concept with Jed. Once approved, we can begin Phase 1 by exposing the necessary APIs on the VPS backend.
