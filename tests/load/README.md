# Load Testing with k6

## Structure
```
tests/load/
├── .env.loadtest.example    # Env template (copy to .env.loadtest)
├── config/
│   └── thresholds.js        # Shared thresholds & checks
├── utils/
│   ├── auth.js              # Login helpers (staff/student)
│   └── helpers.js           # Common functions, endpoints
├── scenarios/
│   ├── smoke.js             # Baseline: 1-5 VU, 30-60s
│   ├── read-load.js         # Normal load: 10→25→50→0
│   └── stress.js            # Stress: 10→25→50→75→100 (MANUAL ONLY)
└── data/                    # Test data files (gitignored)
```

## Prerequisites
- k6 installed: `winget install k6` or `brew install k6`
- Staging environment deployed
- Test accounts seeded (run `bun run db:seed` on staging)

## Quick Start

### 1. Configure Environment
```bash
cd tests/load
cp .env.loadtest.example .env.loadtest
# Edit .env.loadtest with your staging URL and credentials
```

### 2. Run Smoke Test (Always First)
```bash
k6 run scenarios/smoke.js --env-file=.env.loadtest
```

### 3. Run Normal Load Test
```bash
k6 run scenarios/read-load.js --env-file=.env.loadtest --out json=results-load.json
```

### 4. Run Stress Test (MANUAL ONLY - Requires Explicit Approval)
```bash
# ⚠️ Only run after smoke + load pass, and with team approval
k6 run scenarios/stress.js --env-file=.env.loadtest --out json=results-stress.json
```

## Test Account Setup

Seed test accounts on staging:
```bash
cd apps/api
bun run db:seed
```

This creates:
- Staff: `admin001` / `testpass123` (admin role)
- Students: via Google OAuth (requires `AUTH_BYPASS_GOOGLE=true`)

## Thresholds

| Test | http_req_failed | p95 Duration | Checks |
|------|-----------------|--------------|--------|
| Smoke | < 1% | < 500ms | > 99% |
| Load | < 1% | < 1.5s (API) | > 99% |
| Stress | < 5% | < 3s | > 95% |

## Key Endpoints Tested

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | No | Health check |
| `GET /api/me` | Yes | Current session |
| `GET /api/activities` | Yes | List activities |
| `GET /api/requests` | Yes | List own requests |
| `GET /api/notifications` | Yes | Notifications |

## Safety Rules

1. **Never run against production**
2. **Stress test requires manual trigger** - no CI auto-run
3. **No write endpoints** in load tests (no POST /requests, /approve, /upload)
4. **Use test accounts only** - no real user data
5. **Monitor DB connections** - Supabase pooler has limits

## CI/CD Integration (Optional)

```yaml
# .github/workflows/load-test.yml
name: Load Test
on:
  workflow_dispatch:
    inputs:
      test_type:
        type: choice
        options: [smoke, load]
        default: smoke
jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: grafana/k6-action@v0.2.0
        with:
          filename: tests/load/scenarios/${{ github.event.inputs.test_type }}.js
          env: ${{ secrets.LOAD_TEST_ENV }}
```

## Analyzing Results

```bash
# View summary
k6 run --summary-export=summary.json scenarios/read-load.js

# Check specific thresholds
jq '.metrics.http_req_duration.values.p95' summary.json
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| 429 Too Many Requests | Rate limit hit - reduce VU or add delay |
| 500 Errors | Check API logs, DB connection pool |
| Login fails | Verify TEST_STAFF_CODE/PASSWORD, check AUTH_BYPASS_GOOGLE |
| Timeout | Increase `timeout` in request options |