import { HttpError, json, readBody, isAdmin, localPreview } from './auth.js';

function required(value, max = 150) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new HttpError(400, 'Bitte prüfe die Eingaben.');
  }
  return value.trim();
}
function emailAddress(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email) || email.length > 254) {
    throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse eingeben.');
  }
  return email;
}
function pathEmail(value) {
  try { return emailAddress(decodeURIComponent(value)); }
  catch { throw new HttpError(400, 'Ungültige E-Mail-Adresse.'); }
}
async function tripAccess(env, id, user, level = 'member') {
  const trip = await env.DB.prepare(
    "SELECT t.*, " +
    "(t.created_by = ? OR EXISTS (SELECT 1 FROM trip_admins a WHERE a.trip_id = t.id AND a.user_id = ?) " +
    "OR EXISTS (SELECT 1 FROM trip_invites i WHERE i.trip_id = t.id AND i.email = ? AND i.role = 'organizer')) AS organizer, " +
    "(t.created_by = ? OR EXISTS (SELECT 1 FROM trip_admins a WHERE a.trip_id = t.id AND a.user_id = ?) " +
    "OR EXISTS (SELECT 1 FROM trip_invites i WHERE i.trip_id = t.id AND i.email = ?)) AS member " +
    "FROM trips t WHERE t.id = ?"
  ).bind(user.id, user.id, user.email, user.id, user.id, user.email, id).first();
  if (!trip || !trip.member) throw new HttpError(404, 'Ausflug nicht gefunden.');
  if (level === 'organizer' && !trip.organizer) throw new HttpError(403, 'Nur die Ausflugsorganisation darf das.');
  if (level === 'owner' && trip.created_by !== user.id) throw new HttpError(403, 'Nur die erstellende Person darf das.');
  return trip;
}
async function invitationMail(env, url, to, trip) {
  if (localPreview(env, url)) return;
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM || env.APP_ORIGIN !== url.origin) {
    throw new HttpError(503, 'Der E-Mail-Versand ist noch nicht eingerichtet.');
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM, to: [to], subject: 'Einladung: ' + trip.title,
      text: 'Du bist zum Ausflug "' + trip.title + '" eingeladen.\n\n' +
        'Öffne ' + env.APP_ORIGIN + ' und melde dich mit dieser E-Mail-Adresse an, um Fahrten anzubieten oder zu reservieren.\n\n' +
        'Ziel: ' + trip.destination + '\nAnkunft: ' + trip.arrival_at,
    }),
  }).catch(() => null);
  if (!response?.ok) throw new HttpError(502, 'Einladung gespeichert, aber die E-Mail konnte nicht gesendet werden. Bitte erneut senden.');
}

export async function tripsRoute(request, env, url, user) {
  const path = url.pathname;
  if (path === '/api/trips' && request.method === 'GET') {
    const { results: trips } = await env.DB.prepare(
      "SELECT t.id, t.title, t.destination, t.arrival_at AS arrival, t.stop, t.created_by, " +
      "(t.created_by = ? OR EXISTS (SELECT 1 FROM trip_admins a WHERE a.trip_id = t.id AND a.user_id = ?) " +
      "OR EXISTS (SELECT 1 FROM trip_invites i WHERE i.trip_id = t.id AND i.email = ? AND i.role = 'organizer')) AS is_organizer " +
      "FROM trips t WHERE t.created_by = ? " +
      "OR EXISTS (SELECT 1 FROM trip_admins a WHERE a.trip_id = t.id AND a.user_id = ?) " +
      "OR EXISTS (SELECT 1 FROM trip_invites i WHERE i.trip_id = t.id AND i.email = ?) ORDER BY t.arrival_at"
    ).bind(user.id, user.id, user.email, user.id, user.id, user.email).all();
    const { results: rides } = await env.DB.prepare(
      "SELECT r.*, u.name AS driver, " +
      "(SELECT COUNT(*) FROM reservations b WHERE b.ride_id = r.id) AS booked, " +
      "(SELECT b.id FROM reservations b WHERE b.ride_id = r.id AND b.passenger_id = ?) AS my_reservation_id " +
      "FROM rides r JOIN users u ON u.id = r.driver_id " +
      "WHERE EXISTS (SELECT 1 FROM trips t WHERE t.id = r.trip_id AND " +
      "(t.created_by = ? OR EXISTS (SELECT 1 FROM trip_admins a WHERE a.trip_id = t.id AND a.user_id = ?) " +
      "OR EXISTS (SELECT 1 FROM trip_invites i WHERE i.trip_id = t.id AND i.email = ?)))"
    ).bind(user.id, user.id, user.id, user.email).all();
    return json(trips.map(trip => ({
      ...trip,
      isOrganizer: Boolean(trip.is_organizer),
      isCreator: trip.created_by === user.id,
      rides: rides.filter(ride => ride.trip_id === trip.id).map(ride => ({
        ...ride, isMine: ride.driver_id === user.id,
      })),
    })));
  }

  const manage = path.match(/^\/api\/trips\/([^/]+)\/manage$/);
  if (manage && request.method === 'GET') {
    const trip = await tripAccess(env, manage[1], user, 'organizer');
    const invites = await env.DB.prepare(
      'SELECT i.email, i.role, i.created_at, u.name AS registered_name FROM trip_invites i ' +
      'LEFT JOIN users u ON u.email = i.email WHERE i.trip_id = ? ORDER BY i.email'
    ).bind(trip.id).all();
    const reservations = await env.DB.prepare(
      'SELECT b.id, b.ride_id, u.name, u.email, r.direction, r.pickup, d.name AS driver ' +
      'FROM reservations b JOIN users u ON u.id = b.passenger_id ' +
      'JOIN rides r ON r.id = b.ride_id JOIN users d ON d.id = r.driver_id ' +
      'WHERE b.trip_id = ? ORDER BY r.direction, u.name'
    ).bind(trip.id).all();
    const owner = await env.DB.prepare('SELECT name, email FROM users WHERE id = ?').bind(trip.created_by).first();
    return json({ invites: invites.results, reservations: reservations.results, owner });
  }

  if (path === '/api/trips' && request.method === 'POST') {
    if (!isAdmin(user, env)) throw new HttpError(403, 'Nur Admins können Ausflüge anlegen.');
    const body = await readBody(request);
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
  if (offer && request.method === 'POST') {
    const trip = await tripAccess(env, offer[1], user);
    const body = await readBody(request);
    if (!['outbound', 'return'].includes(body.direction) || !Number.isInteger(body.capacity) || body.capacity < 1 || body.capacity > 8) {
      throw new HttpError(400, 'Richtung oder Platzanzahl ungültig.');
    }
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO rides VALUES (?, ?, ?, ?, ?, ?)').bind(id, trip.id, user.id, body.direction, required(body.pickup), body.capacity).run();
    return json({ id }, 201);
  }

  const booking = path.match(/^\/api\/rides\/([^/]+)\/reservations$/);
  if (booking && request.method === 'POST') {
    const ride = await env.DB.prepare('SELECT * FROM rides WHERE id = ?').bind(booking[1]).first();
    if (!ride) throw new HttpError(404, 'Fahrt nicht gefunden.');
    await tripAccess(env, ride.trip_id, user);
    const existing = await env.DB.prepare('SELECT id, ride_id FROM reservations WHERE trip_id = ? AND direction = ? AND passenger_id = ?')
      .bind(ride.trip_id, ride.direction, user.id).first();
    if (existing?.ride_id === ride.id) return json({ id: existing.id });
    if (existing) throw new HttpError(409, 'Du hast für diese Richtung bereits einen Platz.');
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO reservations(id, ride_id, trip_id, direction, passenger_id) VALUES (?, ?, ?, ?, ?)')
      .bind(id, ride.id, ride.trip_id, ride.direction, user.id).run();
    return json({ id }, 201);
  }

  const removeRide = path.match(/^\/api\/rides\/([^/]+)$/);
  if (removeRide && request.method === 'DELETE') {
    const ride = await env.DB.prepare('SELECT id, trip_id, driver_id FROM rides WHERE id = ?').bind(removeRide[1]).first();
    if (!ride) throw new HttpError(404, 'Fahrt nicht gefunden.');
    const trip = await tripAccess(env, ride.trip_id, user);
    if (ride.driver_id !== user.id && !trip.organizer) throw new HttpError(403, 'Nur Fahrer oder Organisatoren können eine Fahrt entfernen.');
    const booked = await env.DB.prepare('SELECT COUNT(*) AS n FROM reservations WHERE ride_id = ?').bind(ride.id).first();
    if (booked.n) throw new HttpError(409, 'Zuerst die Reservierungen dieser Fahrt stornieren.');
    await env.DB.prepare('DELETE FROM rides WHERE id = ?').bind(ride.id).run();
    return json({ removed: true });
  }

  const cancel = path.match(/^\/api\/reservations\/([^/]+)$/);
  if (cancel && request.method === 'DELETE') {
    const reservation = await env.DB.prepare('SELECT id, trip_id, passenger_id FROM reservations WHERE id = ?').bind(cancel[1]).first();
    if (!reservation) throw new HttpError(404, 'Reservierung nicht gefunden.');
    const trip = await tripAccess(env, reservation.trip_id, user);
    if (reservation.passenger_id !== user.id && !trip.organizer) throw new HttpError(403, 'Du kannst nur deine Reservierungen stornieren.');
    await env.DB.prepare('DELETE FROM reservations WHERE id = ?').bind(reservation.id).run();
    return json({ cancelled: true });
  }

  const invite = path.match(/^\/api\/trips\/([^/]+)\/invites$/);
  if (invite && request.method === 'POST') {
    const trip = await tripAccess(env, invite[1], user, 'organizer');
    const body = await readBody(request);
    const email = emailAddress(body.email);
    if (!localPreview(env, url) && (!env.RESEND_API_KEY || !env.EMAIL_FROM || env.APP_ORIGIN !== url.origin)) {
      throw new HttpError(503, 'Der E-Mail-Versand ist noch nicht eingerichtet.');
    }
    await env.DB.prepare(
      "INSERT INTO trip_invites (trip_id, email, role, invited_by, created_at) VALUES (?, ?, 'participant', ?, ?) " +
      'ON CONFLICT(trip_id, email) DO UPDATE SET invited_by = excluded.invited_by'
    ).bind(trip.id, email, user.id, Date.now()).run();
    await invitationMail(env, url, email, trip);
    return json({ invited: true, previewOnly: localPreview(env, url) }, 201);
  }

  const role = path.match(/^\/api\/trips\/([^/]+)\/invites\/([^/]+)\/role$/);
  if (role && request.method === 'POST') {
    const trip = await tripAccess(env, role[1], user, 'owner');
    const email = pathEmail(role[2]);
    const body = await readBody(request);
    if (!['participant', 'organizer'].includes(body.role)) throw new HttpError(400, 'Ungültige Rolle.');
    const invite = await env.DB.prepare('SELECT email FROM trip_invites WHERE trip_id = ? AND email = ?').bind(trip.id, email).first();
    if (!invite) throw new HttpError(404, 'Einladung nicht gefunden.');
    await env.DB.prepare('UPDATE trip_invites SET role = ? WHERE trip_id = ? AND email = ?').bind(body.role, trip.id, email).run();
    return json({ updated: true });
  }

  const revoke = path.match(/^\/api\/trips\/([^/]+)\/invites\/([^/]+)$/);
  if (revoke && request.method === 'DELETE') {
    const trip = await tripAccess(env, revoke[1], user, 'organizer');
    const email = pathEmail(revoke[2]);
    const participant = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (participant?.id === trip.created_by) throw new HttpError(403, 'Die Ausflugsleitung kann nicht entfernt werden.');
    if (participant) {
      const rides = await env.DB.prepare('SELECT COUNT(*) AS n FROM rides WHERE trip_id = ? AND driver_id = ?').bind(trip.id, participant.id).first();
      const reservations = await env.DB.prepare('SELECT COUNT(*) AS n FROM reservations WHERE trip_id = ? AND passenger_id = ?').bind(trip.id, participant.id).first();
      if (rides.n || reservations.n) throw new HttpError(409, 'Zuerst müssen Fahrten oder Reservierungen dieser Person geklärt werden.');
    }
    await env.DB.prepare('DELETE FROM trip_invites WHERE trip_id = ? AND email = ?').bind(trip.id, email).run();
    return json({ removed: true });
  }

  throw new HttpError(404, 'Nicht gefunden.');
}
