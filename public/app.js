const tripForm = document.querySelector('#trip-form');
const tripList = document.querySelector('#trips');
const status = document.querySelector('#status');
const tripTemplate = document.querySelector('#trip-template');
const rideTemplate = document.querySelector('#ride-template');
const directions = { outbound: 'Hinfahrt', return: 'Rückfahrt' };
const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeStyle: 'short' });

const identity = document.querySelector('#identity');
let previewEnabled = false;
let previewIdentity = true;
let loginToken = new URLSearchParams(location.hash.slice(1)).get('login');
if (loginToken) history.replaceState(null, '', location.pathname + location.search);
document.querySelector('#verify-panel').hidden = !loginToken;
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(previewEnabled && previewIdentity ? { 'X-Preview-User': identity.value } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Anfrage fehlgeschlagen.');
  return data;
}
async function refresh() {
  let state = await request('/api/auth/me');
  previewEnabled = state.localPreview;
  if (previewEnabled && previewIdentity && !state.user) state = await request('/api/auth/me');
  document.querySelector('#preview-control').hidden = !previewEnabled;
  document.querySelector('#login-panel').hidden = Boolean(state.user);
  document.querySelector('#create-panel').hidden = !state.user?.isAdmin;
  document.querySelector('#logout').hidden = !state.user;
  document.querySelector('#account').textContent = state.user ? 'Angemeldet als ' + state.user.name : '';
  await render(state.user ? await request('/api/trips') : []);
}

function formValues(form) {
  return Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, value.trim()]));
}

function handleSubmit(form, update) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const message = await update(formValues(form));
      form.reset();
      await refresh();
      status.textContent = message;
      status.tabIndex = -1;
      status.focus();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

async function perform(button, callback) {
  button.disabled = true;
  try {
    const message = await callback();
    await refresh();
    status.textContent = message;
    status.tabIndex = -1;
    status.focus();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function renderRide(trip, ride) {
  const row = rideTemplate.content.cloneNode(true);
  row.querySelector('h4').textContent = ride.driver + ' · ab ' + ride.pickup;
  const remaining = ride.capacity - ride.booked;
  row.querySelector('.availability').textContent = remaining === 0
    ? 'Ausgebucht'
    : remaining === 1 ? '1 freier Platz' : remaining + ' freie Plätze';
  const booking = row.querySelector('.booking');
  booking.hidden = remaining === 0 || ride.isMine || Boolean(ride.my_reservation_id);
  handleSubmit(booking, async () => {
    await request('/api/rides/' + ride.id + '/reservations', {});
    return 'Platz bei ' + ride.driver + ' reserviert (' + directions[ride.direction] + ').';
  });
  const cancel = row.querySelector('.cancel-booking');
  cancel.hidden = !ride.my_reservation_id;
  if (ride.my_reservation_id) {
    cancel.addEventListener('click', () => perform(cancel, async () => {
      await request('/api/reservations/' + ride.my_reservation_id, undefined, 'DELETE');
      return 'Reservierung storniert.';
    }));
  }
  const removeRide = row.querySelector('.remove-ride');
  removeRide.hidden = !(ride.isMine || trip.isOrganizer);
  removeRide.disabled = ride.booked > 0;
  if (ride.booked > 0) removeRide.title = 'Zuerst müssen Reservierungen storniert werden.';
  removeRide.addEventListener('click', () => {
    if (!confirm('Fahrtangebot wirklich entfernen?')) return;
    perform(removeRide, async () => {
      await request('/api/rides/' + ride.id, undefined, 'DELETE');
      return 'Fahrtangebot entfernt.';
    });
  });
  return row;
}

async function renderManagement(trip, root) {
  const base = '/api/trips/' + encodeURIComponent(trip.id);
  const data = await request(base + '/manage');
  root.querySelector('.owner').textContent =
    'Organisiert von ' + data.owner.name + ' (' + data.owner.email + ')';

  handleSubmit(root.querySelector('.invite-form'), async values => {
    const result = await request(base + '/invites', values);
    return result.previewOnly ? 'Einladung im lokalen Testmodus gespeichert.' : 'Einladung gesendet.';
  });

  const inviteList = root.querySelector('.invite-list');
  if (!data.invites.length) {
    const empty = document.createElement('li');
    empty.textContent = 'Noch niemand eingeladen.';
    inviteList.append(empty);
  }
  for (const invite of data.invites) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = invite.email + (invite.registered_name ? ' (' + invite.registered_name + ')' : ' (noch nicht angemeldet)');
    item.append(label);
    const role = document.createElement('select');
    role.setAttribute('aria-label', 'Rolle für ' + invite.email);
    for (const [value, title] of [['participant', 'Teilnehmer'], ['organizer', 'Organisator']]) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = title;
      role.append(opt);
    }
    role.value = invite.role;
    role.disabled = !trip.isCreator;
    if (trip.isCreator) {
      role.addEventListener('change', () => perform(role, async () => {
        await request(base + '/invites/' + encodeURIComponent(invite.email) + '/role', { role: role.value });
        return 'Rolle geändert.';
      }));
    }
    item.append(role);
    const remove = document.createElement('button');
    remove.textContent = 'Einladung entfernen';
    remove.addEventListener('click', () => {
      if (!confirm('Einladung für ' + invite.email + ' entfernen?')) return;
      perform(remove, async () => {
        await request(base + '/invites/' + encodeURIComponent(invite.email), undefined, 'DELETE');
        return 'Einladung entfernt.';
      });
    });
    item.append(remove);
    inviteList.append(item);
  }

  const bookings = root.querySelector('.reservation-list');
  if (!data.reservations.length) {
    const empty = document.createElement('li');
    empty.textContent = 'Noch keine Reservierungen.';
    bookings.append(empty);
  }
  for (const reservation of data.reservations) {
    const item = document.createElement('li');
    const detail = document.createElement('span');
    detail.textContent = reservation.name + ' (' + reservation.email + ') · ' +
      directions[reservation.direction] + ' ab ' + reservation.pickup +
      ' bei ' + reservation.driver;
    item.append(detail);
    const cancel = document.createElement('button');
    cancel.textContent = 'Reservierung stornieren';
    cancel.addEventListener('click', () => {
      if (!confirm('Reservierung von ' + reservation.name + ' wirklich stornieren?')) return;
      perform(cancel, async () => {
        await request('/api/reservations/' + reservation.id, undefined, 'DELETE');
        return 'Reservierung storniert.';
      });
    });
    item.append(cancel);
    bookings.append(item);
  }
}

async function render(trips) {
  tripList.replaceChildren();
  for (const trip of trips) {
    const card = tripTemplate.content.cloneNode(true);
    card.querySelector('h2').textContent = trip.title;
    const arrival = dateFormat.format(new Date(trip.arrival));
    const stop = trip.stop ? ' · Zwischenstopp: ' + trip.stop : '';
    card.querySelector('.details').textContent =
      trip.destination + ' · Ankunft ' + arrival + stop;

    const rides = card.querySelector('.rides');
    for (const [direction, label] of Object.entries(directions)) {
      const group = document.createElement('div');
      const heading = document.createElement('h3');
      heading.textContent = label;
      group.append(heading);
      const matching = trip.rides.filter(ride => ride.direction === direction);
      if (matching.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = 'Noch keine Fahrt angeboten.';
        group.append(empty);
      }
      for (const ride of matching) group.append(renderRide(trip, ride));
      rides.append(group);
    }

    const manage = card.querySelector('.manage');
    manage.hidden = !trip.isOrganizer;
    if (trip.isOrganizer) await renderManagement(trip, manage);
    handleSubmit(card.querySelector('.offer'), async values => {
      await request('/api/trips/' + trip.id + '/rides', { ...values, capacity: Number(values.capacity) });
      return directions[values.direction] + ' hinzugefügt.';
    });
    tripList.append(card);
  }
}

handleSubmit(tripForm, async values => {
  await request('/api/trips', { ...values, arrival: new Date(values.arrival).toISOString() });
  return 'Ausflug angelegt.';
});
identity.addEventListener('change', () => {
  previewIdentity = true;
  status.textContent = '';
  refresh().catch(error => { status.textContent = error.message; });
});
refresh().catch(error => { status.textContent = error.message; });

handleSubmit(document.querySelector('#login-form'), async values => {
  const result = await request('/api/auth/request', values);
  const link = document.querySelector('#preview-link');
  link.hidden = !result.previewLink;
  if (result.previewLink) link.href = result.previewLink;
  return result.previewLink ? 'Lokaler Testlink erstellt.' : 'Der Anmeldelink wurde per E-Mail versendet.';
});
document.querySelector('#preview-link').addEventListener('click', event => {
  event.preventDefault();
  loginToken = new URL(event.currentTarget.href).hash.slice(7);
  document.querySelector('#verify-panel').hidden = false;
});
document.querySelector('#verify').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try {
    await request('/api/auth/verify', { token: loginToken });
    loginToken = null;
    previewIdentity = false;
    document.querySelector('#verify-panel').hidden = true;
    await refresh();
    status.textContent = 'Du bist angemeldet.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    document.querySelector('#verify').disabled = false;
  }
});
document.querySelector('#logout').addEventListener('click', async () => {
  try {
    await request('/api/auth/logout', {});
    previewIdentity = false;
    await refresh();
    status.textContent = 'Du bist abgemeldet.';
  } catch (error) { status.textContent = error.message; }
});
