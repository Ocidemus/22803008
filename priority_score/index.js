const TYPE_WEIGHTS = {
  'Placement': 3,
  'Result': 2,
  'Event': 1
};

const TOP_N = parseInt(process.env.TOP_N || '10', 10);
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const logger = require('./logger');
const axios = require('axios');


const BASE_URL = 'http://4.224.186.213/evaluation-service';



const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Bearer ${AUTH_TOKEN}`
  }
});

function gettop(notif, n) {
  logger.info(`Computing top ${n} priority notif`);

  const score = notif.map(notif => ({
    ...notif,
    score: calPriorityScore(notif)
  }));


async function fetchNotif() {
  logger.info('Fetching notif from API');
  try {
    const response = await api.get('/notif');
    logger.info(`Fetched ${response.data.notif.length} notif`);
    return response.data.notif;
  } catch (err) {
    logger.error('Failed to fetch notif', { error: err.message });
    throw err;
  }
}


function calPriorityScore(notification) {
  const time = new Date(notification.time).getTime() / 1000;
  const weighttype = TYPE_WEIGHTS[notification.Type] || 0;

  return weighttype * 1e10 + time;
}

  score.sort((a, b) => b.score - a.score);

  const topN = score.slice(0, n);
  logger.info(`Top ${n} notif selected`);
  return topN;
}

async function main() {
  logger.info('Priority Inbox Started');
  logger.info(`Configured to top ${TOP_N} notifications`);

  const notif = await fetchNotif();
  const topNotif = gettop(notif, TOP_N);

  
  console.log(`   PRIORITY INBOX - Top ${TOP_N} `);
  console.log('Priority: Placement > Result > Event, then by recency\n');

  topNotif.forEach((notif, idx) => {
    console.log(`${idx + 1}. [${notif.Type}] ${notif.Message}`);
    console.log(`ID: ${notif.ID}`);
    console.log(`time: ${notif.time}`);
    console.log(`Priority Score: ${notif.score.toFixed(0)}`);
    console.log('');
  });

  logger.info('=== Priority Inbox Complete ===');
}

main().catch(err => {
  logger.error('Fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
