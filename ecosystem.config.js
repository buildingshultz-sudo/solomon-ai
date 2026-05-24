// ecosystem.config.js — PM2 process config for Solomon V4
// Start all: pm2 start ecosystem.config.js
// Save: pm2 save
// Resurrect on reboot: pm2 startup

module.exports = {
  apps: [
    {
      name: 'solomon-v4',
      script: 'bot.js',
      cwd: '/root/solomon-v4',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',

      // Restart policy: exponential backoff, max 10 restarts in 10 minutes
      restart_delay: 2000,
      max_restarts: 10,
      min_uptime: '30s',

      // Environment
      env: {
        NODE_ENV: 'production'
      },

      // Logging
      out_file: '/root/solomon-v4/logs/pm2-out.log',
      error_file: '/root/solomon-v4/logs/pm2-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // Log rotation (requires pm2-logrotate module)
      // Install: pm2 install pm2-logrotate
      // pm2 set pm2-logrotate:max_size 20M
      // pm2 set pm2-logrotate:retain 7
    },
    {
      name: 'solomon-scheduler',
      script: 'scheduler.js',
      cwd: '/root/solomon-v4',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',

      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '30s',

      env: {
        NODE_ENV: 'production'
      },

      out_file: '/root/solomon-v4/logs/pm2-scheduler-out.log',
      error_file: '/root/solomon-v4/logs/pm2-scheduler-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};
