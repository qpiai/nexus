module.exports = {
  apps: [
    {
      name: 'nexus-server',
      cwd: '/workspace/llm-integration-platform',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 6001',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 8000,
      kill_timeout: 10000,
    },
  ],
};
