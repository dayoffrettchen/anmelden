import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';

export function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0002_auth.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0003_invites.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../dev/seed.sql', import.meta.url), 'utf8'));
  function prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { return db.prepare(sql).run(...args); },
    };
  }
  return {
    prepare,
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec('COMMIT');
        return results;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}

test('API creates trips and rides, persists bookings and protects the final seat', async () => {
  const env = { DB: database(), LOCAL_PREVIEW: 'true', ADMIN_EMAILS: 'mara@example.test' };
  async function call(path, user, body) {
    return worker.fetch(new Request('http://localhost' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', 'X-Preview-User': user },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
  }
  const tripResponse = await call('/api/trips', 'mara', { title: 'Ausflug', destination: 'Hannover', arrival: '2026-12-01T10:00:00Z' });
  assert.equal(tripResponse.status, 201);
  const trip = await tripResponse.json();
  const rideResponse = await call('/api/trips/' + trip.id + '/rides', 'mara', { direction: 'outbound', pickup: 'Göttingen', capacity: 1 });
  assert.equal(rideResponse.status, 201);
  const ride = await rideResponse.json();
  const route = '/api/rides/' + ride.id + '/reservations';
  assert.equal((await call(route, 'mara', {})).status, 409);
  assert.equal((await call(route, 'oskar', {})).status, 404);
  assert.deepEqual(await (await call('/api/trips', 'oskar')).json(), []);
  assert.equal((await call('/api/trips/' + trip.id + '/invites', 'mara', { email: 'oskar@example.test' })).status, 201);
  assert.equal((await call('/api/trips/' + trip.id + '/invites', 'mara', { email: 'alex@example.test' })).status, 201);
  const results = await Promise.all([call(route, 'oskar', {}), call(route, 'alex', {})]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const winner = results[0].status === 201 ? 'oskar' : 'alex';
  assert.equal((await call(route, winner, {})).status, 200);
  const trips = await (await call('/api/trips', winner)).json();
  assert.equal(trips[0].rides[0].booked, 1);
  assert.equal((await call('/api/trips', 'unknown')).status, 401);
  assert.equal((await call('/api/trips', 'mara', { title: ' ' })).status, 400);
  const response = await worker.fetch(new Request('https://example.com/api/trips'), env);
  assert.equal(response.status, 401);
});

test('email login consumes links once, creates a session and revokes it on logout', async () => {
  const env = { DB: database(), LOCAL_PREVIEW: 'true', ADMIN_EMAILS: 'mara@example.test' };
  let cookie = '';
  async function call(path, body) {
    return worker.fetch(new Request('http://localhost/api/auth/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    }), env);
  }
  const sent = await call('request', { email: 'new@example.test', name: 'Neu' });
  assert.equal(sent.status, 200);
  const token = new URL((await sent.json()).previewLink).hash.slice(7);
  assert.equal((await call('request', { email: 'new@example.test', name: 'Neu' })).status, 429);
  const verified = await call('verify', { token });
  assert.equal(verified.status, 200);
  cookie = verified.headers.get('set-cookie').split(';')[0];
  assert.match(verified.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await call('verify', { token })).status, 400);
  const state = await (await call('me')).json();
  assert.equal(state.user.name, 'Neu');
  assert.equal(state.user.isAdmin, false);
  const denied = await worker.fetch(new Request('http://localhost/api/trips', {
    method: 'POST', headers: { Origin: 'http://localhost', Cookie: cookie, 'Content-Type': 'application/json' },
    body: '{}',
  }), env);
  assert.equal(denied.status, 403);
  await call('logout', {});
  assert.equal((await (await call('me')).json()).user, null);
});
