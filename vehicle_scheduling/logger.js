const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'app.log');


function log(level, message, meta = {}) {
  const entry = {
    timestamp: getTimestamp(),
    level,
    message,
    ...(Object.keys(meta).length > 0 && { meta })
  };
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(LOG_FILE, line);
  const prefix = `[${entry.timestamp}] [${level}]`;
  if (level === 'ERROR') {
    process.stderr.write(`${prefix} ${message}\n`);
  } else {
    process.stdout.write(`${prefix} ${message}\n`);
  }
}

function getTimestamp() {
  return new Date().toISOString();
}

module.exports = {
  info: (msg, meta) => log('INFO', msg, meta),
  warn: (msg, meta) => log('WARN', msg, meta),
  error: (msg, meta) => log('ERROR', msg, meta),
  debug: (msg, meta) => log('DEBUG', msg, meta),
};
