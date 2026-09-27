export const thresholds = {
  smoke: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
    checks: ['rate>0.99'],
  },
  load: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500'],
    'http_req_duration{name:Health}': ['p(95)<300'],
    'http_req_duration{name:Me}': ['p(95)<500'],
    'http_req_duration{name:Activities}': ['p(95)<1000'],
    'http_req_duration{name:Requests}': ['p(95)<1500'],
    'http_req_duration{name:Notifications}': ['p(95)<1000'],
    checks: ['rate>0.99'],
  },
  stress: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<3000'],
    'http_req_duration{name:Health}': ['p(95)<500'],
    'http_req_duration{name:Me}': ['p(95)<1000'],
    'http_req_duration{name:Activities}': ['p(95)<2000'],
    'http_req_duration{name:Requests}': ['p(95)<2500'],
    'http_req_duration{name:Notifications}': ['p(95)<2000'],
    checks: ['rate>0.95'],
  },
};

export const commonChecks = (res, name) => {
  const checks = {
    [`${name} status 200`]: res.status === 200,
    [`${name} no 429`]: res.status !== 429,
    [`${name} no 5xx`]: res.status < 500,
    [`${name} no timeout`]: res.timings.duration < 30000,
    [`${name} valid json`]: (() => {
      try { JSON.parse(res.body); return true; } catch { return false; }
    })(),
  };
  return checks;
};