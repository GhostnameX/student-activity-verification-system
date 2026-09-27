import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const STAFF_CODE = __ENV.TEST_STAFF_CODE || 'admin001';
const PASSWORD = __ENV.TEST_STAFF_PASSWORD || 'testpass123';
const AUTH_BYPASS = __ENV.AUTH_BYPASS_GOOGLE === 'true';

export function getBaseUrl() {
  return BASE_URL;
}

function createJar() {
  return http.cookieJar();
}

export function getAuthHeaders(cookies) {
  if (!cookies) return {};
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v[0]?.value || v}`)
    .join('; ');
  return { headers: { Cookie: cookieHeader } };
}

export async function loginStaff(vuId = 0) {
  const jar = createJar();
  const code = __ENV[`TEST_STAFF_CODE_${vuId}`] || STAFF_CODE;
  const pwd = __ENV[`TEST_STAFF_PASSWORD_${vuId}`] || PASSWORD;

  const payload = JSON.stringify({ staffCode: code, password: pwd });
  const res = http.post(`${BASE_URL}/api/auth/password/signin`, payload, {
    headers: { 'Content-Type': 'application/json' },
    jar,
  });

  check(res, {
    'staff login 200': (r) => r.status === 200,
    'staff login has session': (r) => r.cookies?.ua_session?.length > 0,
  });

  return jar.cookiesForURL(BASE_URL);
}

export async function loginStudent(vuId = 0) {
  if (!AUTH_BYPASS) {
    throw new Error('Student login requires AUTH_BYPASS_GOOGLE=true (dev only)');
  }

  const jar = createJar();
  const payload = JSON.stringify({ staffCode: 'dev-student', password: 'dev' });
  const res = http.post(`${BASE_URL}/api/auth/password/signin`, payload, {
    headers: { 'Content-Type': 'application/json' },
    jar,
  });

  check(res, {
    'student login 200': (r) => r.status === 200,
  });

  return jar.cookiesForURL(BASE_URL);
}

export async function getSession(vuId = 0) {
  const jar = createJar();
  const res = http.get(`${BASE_URL}/api/me`, { jar });
  check(res, { 'get session 200': (r) => r.status === 200 });
  return jar.cookiesForURL(BASE_URL);
}

export function clearCookies() {
  const jar = createJar();
  jar.clear();
}