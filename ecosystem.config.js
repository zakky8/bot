module.exports = {
  apps: [
    {
      name: 'tenet-bot',
      script: 'dist/index.js',
      cwd: './telegram-bot',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      }
    },
  ]
};
