#!/usr/bin/env node
// Constrained rollback helper for the on-call responder.
// Demo guardrails:
//   - refuses to touch any service that is not checkout-api
//   - only redeploys a commit Render already built successfully
//   - does a forward deploy of an earlier commit; never rewrites git history
// Usage: RENDER_API_KEY=... RENDER_SERVICE_ID=... node scripts/rollback.mjs [goodSha]
const required = ['RENDER_API_KEY', 'RENDER_SERVICE_ID'];
for (const name of required) {
  if (!process.env[name]) {
    console.error(`rollback: missing required env var ${name}`);
    process.exit(2);
  }
}

const API = 'https://api.render.com/v1';

async function main() {
  const headers = {
    Authorization: `Bearer ${process.env.RENDER_API_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const svcRes = await fetch(`${API}/services/${process.env.RENDER_SERVICE_ID}`, { headers });
  if (!svcRes.ok) throw new Error(`service lookup failed: ${svcRes.status}`);
  const service = await svcRes.json();
  if (!/checkout-api/i.test(service.name || '')) {
    console.error(`rollback: refusing, target service is "${service.name}", not checkout-api`);
    process.exit(2);
  }

  const deploysRes = await fetch(
    `${API}/services/${process.env.RENDER_SERVICE_ID}/deploys?limit=20`,
    { headers }
  );
  if (!deploysRes.ok) throw new Error(`deploy history lookup failed: ${deploysRes.status}`);
  // The Render API wraps each deploy as { deploy: {...}, cursor } — unwrap it.
  const deploysJson = await deploysRes.json();
  const deployItems = Array.isArray(deploysJson) ? deploysJson : deploysJson.data ?? [];
  const deploys = deployItems.map((d) => (d && d.deploy) ? d.deploy : d);

  const live = deploys.find((d) => d.status === 'live');
  const goodStatuses = new Set(['live', 'succeeded', 'deactivated']);
  const requestedSha = process.argv[2];
  const previous = requestedSha
    ? deploys.find(
        (d) => d.commit && d.commit.id === requestedSha && d.id !== live?.id && goodStatuses.has(d.status)
      )
    : deploys.find(
        (d) => d.commit && d.commit.id !== live?.commit?.id && goodStatuses.has(d.status)
      );

  if (!previous) throw new Error('no previously successful deploy found to roll back to');
  if (!previous.commit || !previous.commit.id) throw new Error('previous deploy has no commit id');

  console.log(
    `rollback: live is ${short(live?.commit?.id)}, redeploying ${short(previous.commit.id)} ` +
      `(commit message: "${previous.commit.message || 'n/a'}")`
  );

  const res = await fetch(`${API}/services/${process.env.RENDER_SERVICE_ID}/deploys`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ commitId: previous.commit.id }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`rollback deploy failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const deploy = await res.json();
  console.log(`rollback: deploy ${deploy.id} queued for commit ${short(previous.commit.id)}`);
  console.log(`rollback: watch it with: render___get_deploy / Render dashboard, or GET ${API}/services/${process.env.RENDER_SERVICE_ID}/deploys`);
}

function short(sha) {
  return sha ? String(sha).slice(0, 7) : 'unknown';
}

main().catch((err) => {
  console.error(`rollback: ${String((err && err.message) || err)}`);
  process.exit(1);
});
