module.exports = {
  apps: [
    {
      name: 'blockchain-evm',
      cwd: '/var/www/vhosts/1usdt.game/blockchain-network',
      script: 'evm.js',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
    },
    {
      name: 'blockchain-tron',
      cwd: '/var/www/vhosts/1usdt.game/blockchain-network',
      script: 'tron.js',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
    },
  ],
};
