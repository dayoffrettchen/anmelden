import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { database } from './api.test.js';
import worker from '../src/worker.js';

function context() {
  const env = { DB: database(), LOCAL_PREVIEW: 'true', ADMIN_EMAILS: 'mara@example.test' };
  const call = (path, user, body, method = body === undefined ? 'GET' : 'POST') =>
    worker.fetch(new Request('http://localhost' + path, {
      method,
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', 'X-Preview-User': user },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
  return { env, call };
}

test('uninvited users cannot list, book, offer, invite or view management details', async () => {
  const { call } = context();
  const trip = await (await call('/api/trips', 'mara', {
    title: 'Privater Ausflug', destination: 'Harz', arrival: '2027-03-01T10:00:00Z',
  })).json();
  const ride = await (await call('/api/trips/' + trip.id + '/rides', 'mara', {
    pickup: 'Göttingen', direction: 'outbound', capacity: 2,
  })).json();
  assert.deepEqual(await (await call('/api/trips', 'oskar')).json(), []);
  assert.equal((await call('/api/trips/' + trip.id + '/rides', 'oskar', {
    pickup: 'Berlin', direction: 'return', capacity: 2,
  })).status, 404);
  assert.equal((await call('/api/rides/' + ride.id + '/reservations', 'oskar', {})).status, 404);
  assert.equal((await call('/api/trips/' + trip.id + '/manage', 'oskar')).status, 404);
  assert.equal((await call('/api/trips/' + trip.id + '/invites', 'oskar', { email: 'alex@example.test' })).status, 404);
  assert.equal((await call('/api/trips/' + trip.id + '/invites', 'mara', { email: 'invalid' })).status, 400);
});

test('an invited participant can reserve and cancel; organizer can manage participants and bookings', async () => {
  const { call } = context();
  const trip = await (await call('/api/trips', 'mara', {
    title: 'Bergtour', destination: 'Brocken', arrival: '2027-03-10T11:00:00Z',
  })).json();
  const base = '/api/trips/' + trip.id;
  assert.equal((await call(base + '/invites', 'mara', { email: 'OSKAR@example.test' })).status, 201);
  assert.equal((await call(base + '/invites', 'mara', { email: 'alex@example.test' })).status, 201);
  assert.equal((await call(base + '/invites', 'oskar', { email: 'stranger@example.test' })).status, 403);
  assert.equal((await call(base + '/invites/oskar%40example.test/role', 'oskar', { role: 'organizer' })).status, 403);
  const memberTrips = await (await call('/api/trips', 'oskar')).json();
  assert.equal(memberTrips.length, 1);
  assert.equal(memberTrips[0].isOrganizer, false);

  const ride = await (await call(base + '/rides', 'oskar', {
    direction: 'outbound', pickup: 'Bahnhof', capacity: 1,
  })).json();
  const reservation = await (await call('/api/rides/' + ride.id + '/reservations', 'alex', {})).json();
  const alexTrip = (await (await call('/api/trips', 'alex')).json())[0];
  assert.equal(alexTrip.rides[0].my_reservation_id, reservation.id);
  assert.equal(alexTrip.rides[0].booked, 1);
  assert.equal((await call(base + '/invites/alex%40example.test', 'mara', undefined, 'DELETE')).status, 409);
  assert.equal((await call('/api/rides/' + ride.id, 'oskar', undefined, 'DELETE')).status, 409);
  assert.equal((await call('/api/reservations/' + reservation.id, 'oskar', undefined, 'DELETE')).status, 403);
  assert.equal((await call('/api/reservations/' + reservation.id, 'alex', undefined, 'DELETE')).status, 200);
  assert.equal((await call('/api/reservations/' + reservation.id, 'alex', undefined, 'DELETE')).status, 404);

  const second = await (await call('/api/rides/' + ride.id + '/reservations', 'alex', {})).json();
  const manage = await (await call(base + '/manage', 'mara')).json();
  assert.equal(manage.reservations.length, 1);
  assert.equal(manage.reservations[0].email, 'alex@example.test');
  assert.equal((await call('/api/reservations/' + second.id, 'mara', undefined, 'DELETE')).status, 200);
  assert.equal((await call(base + '/invites/alex%40example.test', 'mara', undefined, 'DELETE')).status, 200);
  assert.deepEqual(await (await call('/api/trips', 'alex')).json(), []);
  assert.equal((await call(base + '/invites/oskar%40example.test', 'mara', undefined, 'DELETE')).status, 409);

  assert.equal((await call(base + '/invites/oskar%40example.test/role', 'mara', { role: 'organizer' })).status, 200);
  assert.equal((await call(base + '/invites', 'oskar', { email: 'friend@example.test' })).status, 201);
  assert.equal((await call(base + '/invites/oskar%40example.test/role', 'oskar', { role: 'participant' })).status, 403);
  assert.equal((await call(base + '/invites/oskar%40example.test/role', 'mara', { role: 'participant' })).status, 200);
  assert.equal((await call(base + '/manage', 'oskar')).status, 403);
  assert.equal((await call(base + '/invites/friend%40example.test', 'oskar', undefined, 'DELETE')).status, 403);
  assert.equal((await call(base + '/invites/friend%40example.test', 'mara', undefined, 'DELETE')).status, 200);
  assert.equal((await call('/api/rides/' + ride.id, 'oskar', undefined, 'DELETE')).status, 200);
  assert.equal((await call(base + '/invites/oskar%40example.test', 'mara', undefined, 'DELETE')).status, 200);
  assert.deepEqual(await (await call('/api/trips', 'oskar')).json(), []);
});

test('SQL migration preserves invitation access for existing riders and passengers', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0002_auth.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../dev/seed.sql', import.meta.url), 'utf8'));
  db.exec("INSERT INTO trips VALUES ('t', 'Alt', 'Harz', '2027-01-01T10:00:00Z', NULL, 'mara')");
  db.exec("INSERT INTO rides VALUES ('r', 't', 'oskar', 'outbound', 'Bf', 2)");
  db.exec("INSERT INTO reservations(id,ride_id,trip_id,direction,passenger_id) VALUES ('b','r','t','outbound','alex')");
  db.exec(readFileSync(new URL('../migrations/0003_invites.sql', import.meta.url), 'utf8'));
  const invites = db.prepare('SELECT email FROM trip_invites WHERE trip_id = ? ORDER BY email').all('t');
  assert.deepEqual(invites.map(row => row.email), ['alex@example.test', 'oskar@example.test']);
});

test('invitation sends via Resend in production and handles failed delivery', async () => {
  const { env, call } = context();
  const trip = await (await call('/api/trips', 'mara', {
    title: 'Mailtest', destination: 'Göttingen', arrival: '2027-01-01T10:00:00Z',
  })).json();

  const sent = await call('/api/auth/request', 'mara', { name: 'Mara', email: 'mara@example.test' });
  const token = new URL((await sent.json()).previewLink).hash.slice(7);
  const verified = await call('/api/auth/verify', 'mara', { token });
  const cookie = verified.headers.get('set-cookie').split(';')[0];
  env.LOCAL_PREVIEW = 'false';
  env.RESEND_API_KEY = 'test-only';
  env.EMAIL_FROM = 'test@example.com';
  env.APP_ORIGIN = 'http://localhost';
  const orig = globalThis.fetch;
  const calls = [];
  const invite = (email) => worker.fetch(new Request('http://localhost/api/trips/' + trip.id + '/invites', {
    method: 'POST',
    headers: { Origin: 'http://localhost', Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }), env);
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return new Response('{}', { status: calls.length === 1 ? 200 : 422 });
    };
    assert.equal((await invite('oskar@example.test')).status, 201);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    const payload = JSON.parse(calls[0].options.body);
    assert.deepEqual(payload.to, ['oskar@example.test']);
    assert.ok(payload.text.includes('Mailtest'));
    assert.equal((await invite('alex@example.test')).status, 502);
    const saved = await (await worker.fetch(new Request(
      'http://localhost/api/trips/' + trip.id + '/manage',
      { headers: { Cookie: cookie } },
    ), env)).json();
    assert.equal(saved.invites.length, 2);
  } finally {
    globalThis.fetch = orig;
  }
});
