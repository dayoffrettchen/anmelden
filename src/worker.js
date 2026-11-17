import { HttpError, json, readBody, currentUser, isAdmin, authRoute } from './auth.js';
function required(value, max = 150) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new HttpError(400, 'Bitte prüfe die Eingaben.');
  }
  return value.trim();
}
async function api(request, env, url) {
  if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) {
    throw new HttpError(403, 'Ungültiger Ursprung.');
  }
  if (url.pathname.startsWith('/api/auth/')) return authRoute(request, env, url);
  const user = await currentUser(request, env, url);
  if (!user) throw new HttpError(401, 'Bitte melde dich an.');
  const path = url.pathname;
  if (path === '/api/trips' && request.method === 'GET') {
    const { results: trips } = await env.DB.prepare('SELECT id, title, destination, arrival_at AS arrival, stop FROM trips ORDER BY arrival_at').all();
    const { results: rides } = await env.DB.prepare(`SELECT r.*, u.name AS driver,
      (SELECT COUNT(*) FROM reservations b WHERE b.ride_id = r.id) AS booked
      FROM rides r JOIN users u ON u.id = r.driver_id`).all();
    return json(trips.map(trip => ({ ...trip, rides: rides.filter(ride => ride.trip_id === trip.id) })));
  }
  if (request.method !== 'POST') throw new HttpError(404, 'Nicht gefunden.');
  const body = await readBody(request);
  if (path === '/api/trips') {
    if (!isAdmin(user, env)) throw new HttpError(403, 'Nur Admins können Ausflüge anlegen.');
    const title = required(body.title, 100);
    const destination = required(body.destination);
    const arrival = required(body.arrival, 40);
    if (!/Z$|[+-]\d{2}:\d{2}$/.test(arrival) || !Number.isFinite(Date.parse(arrival))) throw new HttpError(400, 'Ungültige Ankunftszeit.');
    const stop = body.stop ? required(body.stop) : null;
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO trips VALUES (?, ?, ?, ?, ?, ?)').bind(id, title, destination, new Date(arrival).toISOString(), stop, user.id),
      env.DB.prepare('INSERT INTO trip_admins VALUES (?, ?)').bind(id, user.id),
    ]);
    return json({ id }, 201);
  }
  const offer = path.match(/^\/api\/trips\/([^/]+)\/rides$/);
  if (offer) {
    const trip = await env.DB.prepare('SELECT id FROM trips WHERE id = ?').bind(offer[1]).first();
    if (!trip) throw new HttpError(404, 'Ausflug nicht gefunden.');
    if (!['outbound', 'return'].includes(body.direction) || !Number.isInteger(body.capacity) || body.capacity < 1 || body.capacity > 8) {
      throw new HttpError(400, 'Richtung oder Platzanzahl ungültig.');
    }
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO rides VALUES (?, ?, ?, ?, ?, ?)').bind(id, trip.id, user.id, body.direction, required(body.pickup), body.capacity).run();
    return json({ id }, 201);
  }
  const booking = path.match(/^\/api\/rides\/([^/]+)\/reservations$/);
  if (booking) {
    const ride = await env.DB.prepare('SELECT * FROM rides WHERE id = ?').bind(booking[1]).first();
    if (!ride) throw new HttpError(404, 'Fahrt nicht gefunden.');
    const existing = await env.DB.prepare('SELECT id, ride_id FROM reservations WHERE trip_id = ? AND direction = ? AND passenger_id = ?').bind(ride.trip_id, ride.direction, user.id).first();
    if (existing?.ride_id === ride.id) return json({ id: existing.id });
    if (existing) throw new HttpError(409, 'Du hast für diese Richtung bereits einen Platz.');
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO reservations(id, ride_id, trip_id, direction, passenger_id) VALUES (?, ?, ?, ?, ?)').bind(id, ride.id, ride.trip_id, ride.direction, user.id).run();
    return json({ id }, 201);
  }
  throw new HttpError(404, 'Nicht gefunden.');
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try { return await api(request, env, url); }
    catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      const message = String(error.cause?.message ?? error.message);
      if (message.includes('ride_full')) return json({ error: 'Diese Fahrt ist inzwischen ausgebucht.' }, 409);
      if (message.includes('driver_cannot_book')) return json({ error: 'Du bist bereits Fahrer dieser Fahrt.' }, 409);
      if (message.includes('UNIQUE constraint failed')) return json({ error: 'Diese Buchung besteht bereits. Bitte aktualisieren.' }, 409);
      console.error('API request failed', { path: url.pathname, message });
      return json({ error: 'Die Anfrage ist fehlgeschlagen. Bitte erneut versuchen.' }, 500);
    }
  },
};
