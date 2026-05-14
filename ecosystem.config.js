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
    },
    {
      name: 'langgraph-service',
      script: `${process.env.HOME}/bot/langgraph-service/venv/bin/uvicorn`,
      args: 'main:app --host 127.0.0.1 --port 8001 --workers 2',
      cwd: `${process.env.HOME}/bot/langgraph-service`,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        PYTHONUNBUFFERED: '1',
        VECTOR_DB_PATH: `${process.env.HOME}/bot/telegram-bot/storage/vectors/vector_db.json`,
        FAQ_DATA_PATH: `${process.env.HOME}/bot/telegram-bot/faq_data.json`,
      }
    }
  ]
};
