// pm2 process config for the TripSplit API.
//
// Deployed layout on the VPS (see docs/deploy/SETUP.md):
//   <DEPLOY_PATH>/
//     ecosystem.config.cjs   <- this file
//     server/                <- built server (dist/ + package.json), from deploy.sh
//       .env                 <- real secrets, created once by hand, never rsynced over
//       dist/index.js
//     web/
//       dist/                <- built SPA, served by nginx directly (not by this process)
//
// Usage on the VPS (also done by deploy.sh):
//   pm2 startOrReload ecosystem.config.cjs --only tripsplit-server
//   pm2 save
//   pm2 logs tripsplit-server

module.exports = {
  apps: [
    {
      name: 'tripsplit-server',
      cwd: __dirname + '/server',
      script: 'dist/index.js',
      // Node 22+ reads env vars from a dotenv-style file natively.
      node_args: '--env-file=.env',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
      out_file: '../logs/server.out.log',
      error_file: '../logs/server.error.log',
      time: true,
    },
  ],
};
