import crypto from 'crypto';

const WORKER_URL = 'https://a2a-escrow-worker.colefarrar70.workers.dev';

async function safeParse(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function runTests() {
  console.log('--- 1. Agent Discovery Endpoint ---');
  const agentRes = await fetch(`${WORKER_URL}/.well-known/agent.json`);
  console.log(`HTTP Status: ${agentRes.status}`);
  console.log(await safeParse(agentRes));

  console.log('\n--- 2. Health Endpoint ---');
  const healthRes = await fetch(`${WORKER_URL}/health`);
  console.log(`HTTP Status: ${healthRes.status}`);
  console.log(await safeParse(healthRes));
}

runTests().catch(console.error);
