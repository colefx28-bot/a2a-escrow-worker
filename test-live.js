import crypto from 'crypto';

const WORKER_URL = 'https://a2a-escrow-worker.colefarrar70.workers.dev';
const SECRET = process.env.API_SECRET_KEY || 'secret_key_123456789_abcdef';

async function safeParse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function runTestSuite() {
  console.log('=== 1. Edge Health Endpoint ===');
  const healthRes = await fetch(`${WORKER_URL}/health`);
  console.log(`HTTP Status: ${healthRes.status}`);
  console.log(await safeParse(healthRes));

  console.log('\n=== 2. Signed Settlement Request (HTTP 200) ===');
  const body = JSON.stringify({
    buyer: '0x44b28353654bf6E94687aD3af17583263c2d6834',
    seller: '0xd0Abea51c0144215412369D558334937A20658d1',
    amount: '1.00',
    serviceSlaMs: 5000,
    schemaVersion: 'v1.0'
  });

  const uniqueKey = 'live-test-' + Date.now();
  const signature = crypto.createHmac('sha256', SECRET).update(body).digest('hex');

  const verifyRes = await fetch(`${WORKER_URL}/verify-escrow`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature': signature,
      'X-Idempotency-Key': uniqueKey
    },
    body
  });
  console.log(`HTTP Status: ${verifyRes.status}`);
  console.log(await safeParse(verifyRes));

  if (verifyRes.status === 200) {
    console.log('\n=== 3. Workers KV Idempotency Lock (HTTP 409) ===');
    const staticKey = 'replay-lock-test-' + Math.floor(Date.now() / 100000);
    const makeRequest = () => fetch(`${WORKER_URL}/verify-escrow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': crypto.createHmac('sha256', SECRET).update(body).digest('hex'),
        'X-Idempotency-Key': staticKey
      },
      body
    });

    await makeRequest();
    const replayRes = await makeRequest();
    console.log(`HTTP Status: ${replayRes.status} (Expected: 409)`);
    console.log(await safeParse(replayRes));
  } else {
    console.log('\n[!] Skipping step 3: Cloudflare build is propagating. Re-run in 15 seconds.');
  }
}

runTestSuite().catch(console.error);
