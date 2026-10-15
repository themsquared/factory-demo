# checkout-api — Factory on-call demo service

Small, realistic checkout service for the Factory incident-response demo.
Datadog watches it; a Factory automation responds when it breaks. Fictional
customer: Meridian Mutual. No real payments.

- `GET /health` — liveness and the deployed commit SHA
- `GET /api/price?sku=SKU-1001&currency=EUR` — price a SKU in USD, EUR or GBP
- `POST /api/checkout` — price a cart `{"items":[{"sku":"SKU-1001","qty":1}],"currency":"EUR"}` and get a demo order
- `npm test` — unit + route tests; must pass before any change

Deployed on Render (free tier, blueprint in `render.yaml`). Traced with
dd-trace straight to the Datadog intake (agentless), logs streamed by Render
into Datadog, and self-reported hit/error counters feed the error-rate monitor.

See `AGENTS.md` for the binding on-call rules and
`.factory/droids/oncall-responder.md` for the standing responder.
