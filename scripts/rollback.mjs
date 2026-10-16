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

// The Render API wraps list entries as { <kind>: {...} } (e.g. { deploy },
// { service }); unwrap either shape.
function unwrapList(json, kind) {
  const items = Array.isArray(json) ? json : json.data ?? [];
  return items.map((entry) => (entry && entry[kind]) ? entry[kind] : entry);
}

async function main() {
  const headers = {
    Authorization: `Bearer ${process.env.RENDER_API_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  // Resolve the service to act on. The injected RENDER_SERVICE_ID can be
  // stale: incidents ef940e0f (IR-3) and 24931d39 (IR-4) both hit a 404 on
  // this lookup and the responder had to resolve the real service itself.
  // On 404 only, fall back to matching the checkout-api web service by name;
  // the name check below still refuses anything that is not checkout-api.
  let targetId = process.env.RENDER_SERVICE_ID;
  const svcRes = await fetch(`${API}/services/${targetId}`, { headers });
  let service;
  if (svcRes.ok) {
    service = await svcRes.json();
  } else if (svcRes.status === 404) {
    const listRes = await fetch(`${API}/services?limit=100`, { headers });
    if (!listRes.ok) {
      throw new Error(`service lookup failed: 404, and fallback listing failed: ${listRes.status}`);
    }
    const match = unwrapList(await listRes.json(), 'service').find(
      (s) => s.type === 'web_service' && /checkout-api/i.test(s.name || '')
    );
    if (!match) {
      throw new Error('service lookup failed: 404, and no checkout-api web service found to fall back to');
    }
    targetId = match.id;
    service = match;
    console.error(`rollback: RENDER_SERVICE_ID lookup returned 404; using ${service.name} (${service.id}) resolved by name instead`);
  } else {
    throw new Error(`service lookup failed: ${svcRes.status}`);
  }
  if (!/checkout-api/i.test(service.name || '')) {
    console.error(`rollback: refusing, target service is "${service.name}", not checkout-api`);
    process.exit(2);
  }

  const deploysRes = await fetch(
    `${API}/services/${targetId}/deploys?limit=20`,
    { headers }
  );
  if (!deploysRes.ok) throw new Error(`deploy history lookup failed: ${deploysRes.status}`);
  const deploys = unwrapList(await deploysRes.json(), 'deploy');

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

  const res = await fetch(`${API}/services/${targetId}/deploys`, {
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
  console.log(`rollback: watch it with: render___get_deploy / Render dashboard, or GET ${API}/services/${targetId}/deploys`);
}

function short(sha) {
  return sha ? String(sha).slice(0, 7) : 'unknown';
}

main().catch((err) => {
  console.error(`rollback: ${String((err && err.message) || err)}`);
  process.exit(1);
});
