module.exports = {
  apps: [
    {
      name: 'telegram-bot',
      script: 'npm',
      args: 'start',
      cwd: './telegram-bot',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
