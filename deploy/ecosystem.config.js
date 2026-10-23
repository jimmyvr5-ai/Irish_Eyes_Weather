// pm2 start deploy/ecosystem.config.js  (run from the repo folder)
module.exports = {
  apps: [{
    name: 'irish-weather',
    script: 'server.js',
    cwd: __dirname + '/..',
    env: { PORT: 3005, HOST: '0.0.0.0', NODE_ENV: 'production' },
  }],
};
