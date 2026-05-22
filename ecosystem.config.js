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
