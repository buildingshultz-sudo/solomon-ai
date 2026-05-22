/**
 * PM2 Ecosystem Configuration — IronEdit
 *
 * Manages three processes:
 *   1. ironedit-api     — WebSocket + REST API (port 8080)
 *   2. ironedit-agent   — Server-side FFmpeg rendering agent
 *   3. ironedit-ui      — Web frontend + API proxy (port 3000)
 */

module.exports = {
  apps: [
    {
      name: "ironedit-api",
      cwd: "/root/ironedit-api",
      script: "dist/server.js",
      interpreter: "node",
      env: {
        PORT: "8080",
        HOST: "0.0.0.0",
        LOG_LEVEL: "info",
        AGENT_API_KEYS: "dev-agent-key-please-rotate",
        CONTROL_API_KEYS: "dev-control-key-please-rotate",
        OPENAI_API_KEY: "sk-jAjPcAr69WrN7v6dhZmwac",
        OPENAI_API_BASE: "https://api.manus.im/api/llm-proxy/v1",
        OPENAI_MODEL: "gpt-4.1-mini",
        DATA_DIR: "./data",
      },
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      log_file: "/root/logs/ironedit-api.log",
      error_file: "/root/logs/ironedit-api-error.log",
      out_file: "/root/logs/ironedit-api-out.log",
      time: true,
    },
    {
      name: "ironedit-agent",
      cwd: "/root/ironedit-agent",
      script: "agent.js",
      interpreter: "node",
      env: {
        IRONEDIT_WS_URL: "ws://localhost:8080/agent",
        IRONEDIT_AGENT_KEY: "dev-agent-key-please-rotate",
        IRONEDIT_API_URL: "http://localhost:8080",
        IRONEDIT_CONTROL_KEY: "dev-control-key-please-rotate",
        IRONEDIT_WORK_DIR: "/root/ironedit-renders",
        FFMPEG_BIN: "ffmpeg",
        FFPROBE_BIN: "ffprobe",
        OPENAI_API_KEY: "sk-jAjPcAr69WrN7v6dhZmwac",
      },
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      // Delay start so the API is up first
      wait_ready: false,
      kill_timeout: 5000,
      log_file: "/root/logs/ironedit-agent.log",
      error_file: "/root/logs/ironedit-agent-error.log",
      out_file: "/root/logs/ironedit-agent-out.log",
      time: true,
    },
    {
      name: "ironedit-ui",
      cwd: "/root/ironedit-ui",
      script: "server.js",
      interpreter: "node",
      env: {
        UI_PORT: "3000",
        API_BASE: "http://localhost:8080",
      },
      autorestart: true,
      watch: false,
      max_memory_restart: "128M",
      log_file: "/root/logs/ironedit-ui.log",
      error_file: "/root/logs/ironedit-ui-error.log",
      out_file: "/root/logs/ironedit-ui-out.log",
      time: true,
    },
  ],
};
