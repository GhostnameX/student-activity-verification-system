import { sleep } from 'k6';

export function randomSleep(min = 0.5, max = 2) {
  sleep(Math.random() * (max - min) + min);
}

export function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function buildQuery(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) q.set(k, String(v));
  });
  return q.toString();
}

export function tagRequest(name) {
  return { tags: { name } };
}

export const ENDPOINTS = {
  health: { path: '/health', auth: false, name: 'Health' },
  me: { path: '/api/me', auth: true, name: 'Me' },
  activities: { path: '/api/activities', auth: true, name: 'Activities' },
  requests: { path: '/api/requests', auth: true, name: 'Requests' },
  notifications: { path: '/api/notifications', auth: true, name: 'Notifications' },
};

export function makeRequest(baseUrl, endpoint, cookies) {
  const url = `${baseUrl}${endpoint.path}`;
  const options = endpoint.auth ? { jar: cookies } : {};
  return { url, options, name: endpoint.name };
}

export function checkResponse(res, name) {
  return {
    [`${name} 200`]: res.status === 200,
    [`${name} no 429`]: res.status !== 429,
    [`${name} no 5xx`]: res.status < 500,
    [`${name} no timeout`]: res.timings.duration < 30000,
    [`${name} valid json`]: (() => { try { JSON.parse(res.body); return true; } catch { return false; } })(),
  };
}