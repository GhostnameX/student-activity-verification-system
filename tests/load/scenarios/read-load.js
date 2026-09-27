import http from 'k6/http';
import { check, sleep } from 'k6';
import { thresholds } from '../config/thresholds.js';
import { loginStaff, getAuthHeaders, getBaseUrl } from '../utils/auth.js';
import { ENDPOINTS, checkResponse, randomSleep } from '../utils/helpers.js';

export const options = {
  scenarios: {
    load: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 25 },
        { duration: '2m', target: 50 },
        { duration: '1m', target: 25 },
        { duration: '30s', target: 10 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: thresholds.load,
  tags: { test_type: 'load' },
};

export function setup() {
  const baseUrl = getBaseUrl();
  console.log(`[load] Testing against: ${baseUrl}`);
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
    });
    Object.assign(allChecks, checkResponse(res, ep.name));
  }

  check(null, allChecks);

  randomSleep(0.5, 2);
}

export function teardown(data) {
  console.log('[load] Test completed');
}