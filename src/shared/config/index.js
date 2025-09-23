const path = require('path');
const os = require('os');

function getWingmanHome() {
  return process.env.WINGMAN_HOME || path.join(os.homedir(), '.wingman');
}

function paths() {
  const home = getWingmanHome();
  return {
    home,
    configDir: path.join(home, 'config'),
    sessionsDir: path.join(home, 'sessions'),
    logsDir: path.join(home, 'logs'),
    cacheDir: path.join(home, 'cache'),
    tmpDir: path.join(home, 'tmp'),
  };
}

module.exports = {
  getWingmanHome,
  paths,
};

