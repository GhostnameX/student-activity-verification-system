import http from 'k6/http';
import { check, sleep } from 'k6';
import { thresholds } from '../config/thresholds.js';
import { loginStaff, getAuthHeaders, getBaseUrl } from '../utils/auth.js';
import { ENDPOINTS, checkResponse, makeRequest, randomSleep } from '../utils/helpers.js';

export const options = {
  scenarios: {
    smoke: {
      executor: 'ramping-vus',
      stages: [
        { duration: '10s', target: 1 },
        { duration: '30s', target: 3 },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: thresholds.smoke,
  tags: { test_type: 'smoke' },
};

export function setup() {
  const baseUrl = getBaseUrl();
  console.log(`[smoke] Testing against: ${baseUrl}`);
  const cookies = loginStaff(0);
  return { baseUrl, cookies };
}

export default function (data) {
  const { baseUrl, cookies } = data;
  const authHeaders = getAuthHeaders(cookies);

  const checks = {};

  const healthRes = http.get(`${baseUrl}${ENDPOINTS.health.path}`, { tags: { name: ENDPOINTS.health.name } });
  Object.assign(checks, checkResponse(healthRes, ENDPOINTS.health.name));

  const meRes = http.get(`${baseUrl}${ENDPOINTS.me.path}`, { ...authHeaders, tags: { name: ENDPOINTS.me.name } });
  Object.assign(checks, checkResponse(meRes, ENDPOINTS.me.name));

  const activitiesRes = http.get(`${baseUrl}${ENDPOINTS.activities.path}`, { ...authHeaders, tags: { name: ENDPOINTS.activities.name } });
  Object.assign(checks, checkResponse(activitiesRes, ENDPOINTS.activities.name));

  const requestsRes = http.get(`${baseUrl}${ENDPOINTS.requests.path}`, { ...authHeaders, tags: { name: ENDPOINTS.requests.name } });
  Object.assign(checks, checkResponse(requestsRes, ENDPOINTS.requests.name));

  check(null, checks);

  randomSleep(0.5, 1.5);
}

export function teardown(data) {
  console.log('[smoke] Test completed');
}