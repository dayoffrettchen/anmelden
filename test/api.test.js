import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
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
  const env = { DB: database(), LOCAL_PREVIEW: 'true' };
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
  const results = await Promise.all([call(route, 'oskar', {}), call(route, 'alex', {})]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const winner = results[0].status === 201 ? 'oskar' : 'alex';
  assert.equal((await call(route, winner, {})).status, 200);
  const trips = await (await call('/api/trips', winner)).json();
  assert.equal(trips[0].rides[0].booked, 1);
  assert.equal((await call('/api/trips', 'unknown')).status, 401);
  assert.equal((await call('/api/trips', 'mara', { title: ' ' })).status, 400);
  const response = await worker.fetch(new Request('https://example.com/api/trips'), env);
  assert.equal(response.status, 503);
});
