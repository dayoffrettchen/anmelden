import { HttpError, json, currentUser, authRoute } from './auth.js';
import { tripsRoute } from './trips.js';

async function api(request, env, url) {
  if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) {
    throw new HttpError(403, 'Ungültiger Ursprung.');
  }
  if (url.pathname.startsWith('/api/auth/')) return authRoute(request, env, url);
  const user = await currentUser(request, env, url);
  if (!user) throw new HttpError(401, 'Bitte melde dich an.');
  return tripsRoute(request, env, url, user);
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
