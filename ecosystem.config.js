/**
 * Solomon v6.0 PM2 Ecosystem Config (Hardened)
 *
 * Ensures both bot and relay restart correctly after:
 * - Process crash
 * - VPS reboot
 * - OOM kill
 * - Manual pm2 restart all
 *
 * Start order: relay FIRST (it must be up before bot tries to use it)
 */
module.exports = {
  apps: [
    // ── RELAY (starts first — bot depends on it) ─────────────────────────
    {
      name: 'solomon-relay',
      script: 'relay.js',
      cwd: '/root/solomon-bot',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/root/.nvm/versions/node/v22.13.0/bin'
      },
      error_file: '/root/solomon-bot/logs/relay-error.log',
      out_file: '/root/solomon-bot/logs/relay-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 2000,
      max_restarts: 50,
      min_uptime: '5s',
      kill_timeout: 5000
    },

    // ── CREWAI BACKEND (starts before bot — provides autonomous task execution) ──
    {
      name: 'solomon-crewai',
      script: '/root/solomon-bot/crewai_backend_main.py',
      interpreter: 'python3',
      cwd: '/root/solomon-bot',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      },
      error_file: '/root/solomon-bot/logs/crewai-error.log',
      out_file: '/root/solomon-bot/logs/crewai-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 3000,
      max_restarts: 50,
      min_uptime: '10s',
      kill_timeout: 10000
    },
    // ── BOT (starts after relay) ─────────────────────────────────────────
    {
      name: 'solomon-bot',
      script: 'bot.js',
      cwd: '/root/solomon-bot',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '600M',
      env: {
        NODE_ENV: 'production',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/root/.nvm/versions/node/v22.13.0/bin'
      },
      error_file: '/root/solomon-bot/logs/bot-error.log',
      out_file: '/root/solomon-bot/logs/bot-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 5000,
      max_restarts: 50,
      min_uptime: '10s',
      kill_timeout: 10000,
      // Exponential backoff on repeated crashes
      exp_backoff_restart_delay: 100
    }
  ]
};
