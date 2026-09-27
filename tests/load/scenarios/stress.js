import http from 'k6/http';
import { check, sleep } from 'k6';
import { thresholds } from '../config/thresholds.js';
import { loginStaff, getAuthHeaders, getBaseUrl } from '../utils/auth.js';
import { ENDPOINTS, checkResponse, randomSleep } from '../utils/helpers.js';

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      stages: [
        { duration: '1m', target: 10 },
        { duration: '2m', target: 25 },
        { duration: '3m', target: 50 },
        { duration: '4m', target: 75 },
        { duration: '5m', target: 100 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '60s',
    },
  },
  thresholds: thresholds.stress,
  tags: { test_type: 'stress' },
  // Fail fast on critical issues
  abortOnFail: true,
};

export function setup() {
  const baseUrl = getBaseUrl();
  console.log(`[stress] Testing against: ${baseUrl}`);
  console.log('[stress] ⚠️  This is a STRESS test - run only on staging with explicit approval');
  const cookies = loginStaff(0);
  return { baseUrl, cookies };
}

export default function (data) {
  const { baseUrl, cookies } = data;
  const authHeaders = getAuthHeaders(cookies);

  const endpoints = [
    ENDPOINTS.health,
    ENDPOINTS.me,
    ENDPOINTS.activities,
    ENDPOINTS.requests,
    ENDPOINTS.notifications,
  ];

  const allChecks = {};

  for (const ep of endpoints) {
    const res = http.get(`${baseUrl}${ep.path}`, {
      ...(ep.auth ? authHeaders : {}),
      tags: { name: ep.name },
      timeout: '60s',
    });
    Object.assign(allChecks, checkResponse(res, ep.name));
  }

  check(null, allChecks);

  randomSleep(0.2, 1);
}

export function teardown(data) {
  console.log('[stress] Test completed');
}