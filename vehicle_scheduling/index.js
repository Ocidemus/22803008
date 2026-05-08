
const BASE_URL = 'http://4.224.186.213/evaluation-service';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const axios = require('axios');
const logger = require('./logger');

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Bearer ${AUTH_TOKEN}`
  }
});

function solveKnapsack(tasks, capacity) {
  const n = tasks.length;
  logger.info('Starting knapsack solver', { tasks: n, capacity });

  const dp = Array.from({ length: n + 1 }, () => new Array(capacity + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    const wei = tasks[i - 1].Duration;
    const val = tasks[i - 1].Impact;

    for (let w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i - 1][w];
      if (wei <= w && dp[i - 1][w - wei] + val > dp[i][w]) {
        dp[i][w] = dp[i - 1][w - wei] + val;
      }
    }
  }

async function vehiclesfetch() {
  logger.info('Fetching vehicles from API');
  try {
    const response = await api.get('/vehicles');
    logger.info(`Fetched ${response.data.vehicles.length} vehicles`);
    return response.data.vehicles;
  } catch (err) {
    logger.error('Failed to fetch vehicles', { error: err.message });
    throw err;
  }
}

async function depotfetch() {
  logger.info('Fetching depots from API');
  try {
    const response = await api.get('/depots');
    logger.info(`Fetched ${response.data.depots.length} depots`);
    return response.data.depots;
  } catch (err) {
    logger.error('Failed to fetch depots', { error: err.message });
    throw err;
  }
}


  const selected = [];
  let w = capacity;
  for (let i = n; i > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      selected.push(tasks[i - 1]);
      w -= tasks[i - 1].Duration;
    }
  }

  const maxImpact = dp[n][capacity];
  logger.info('Knapsack solved', { maxImpact, selectedCount: selected.length });
  return { maxImpact, selected };
}

async function main() {
  logger.info('Vehicle Maintenance Scheduler Started');

  const depots = await depotfetch();
  const vehicles = await vehiclesfetch();

  console.log('VEHICLE MAINTENANCE SCHEDULING RESULTS');

  for (const depot of depots) {
    const { ID, MechanicHours } = depot;
    logger.info(`Processing Depot ${ID}`, { mechanicHours: MechanicHours });

    const { maxImpact, selected } = solveKnapsack(vehicles, MechanicHours);
    const totalDuration = selected.reduce((sum, t) => sum + t.Duration, 0);

    console.log(`--- Depot ${ID} (Budget: ${MechanicHours} mechanic-hours) ---`);
    console.log(`  Max Impact Score : ${maxImpact}`);
    console.log(`  Tasks taken   : ${selected.length}`);
    console.log(`  Hours Usage       : ${totalDuration} / ${MechanicHours}`);
    console.log('  Selected Tasks:');
    selected.forEach(t => {
      console.log(`    [Impact: ${t.Impact}, Duration: ${t.Duration}h] ${t.TaskID}`);
    });
    console.log('');
  }

  logger.info('Vehicle Maintenance Scheduler Complete ');
}

main().catch(err => {
  logger.error('Fatal error in main', { error: err.message, stack: err.stack });
  process.exit(1);
});
