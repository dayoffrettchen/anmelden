import { reserveSeat } from './model.js';

const storageKey = 'anmelden.local-trips.v1';
const tripForm = document.querySelector('#trip-form');
const tripList = document.querySelector('#trips');
const status = document.querySelector('#status');
const tripTemplate = document.querySelector('#trip-template');
const rideTemplate = document.querySelector('#ride-template');
const directions = { outbound: 'Hinfahrt', return: 'Rückfahrt' };
const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeStyle: 'short' });

function readTrips() {
  return JSON.parse(localStorage.getItem(storageKey) ?? '[]');
}

function saveTrips(trips) {
  localStorage.setItem(storageKey, JSON.stringify(trips));
}

function formValues(form) {
  return Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, value.trim()]));
}

function handleSubmit(form, update) {
  form.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const trips = readTrips();
      const message = update(trips, formValues(form));
      saveTrips(trips);
      form.reset();
      render(trips);
      status.textContent = message;
      status.tabIndex = -1;
      status.focus();
    } catch (error) {
      status.textContent = error.message;
    }
  });
}

function renderRide(trip, ride) {
  const row = rideTemplate.content.cloneNode(true);
  row.querySelector('h4').textContent = `${ride.driver} · ab ${ride.pickup}`;
  const remaining = ride.capacity - ride.passengers.length;
  row.querySelector('.availability').textContent = remaining === 0
    ? 'Ausgebucht'
    : remaining === 1 ? '1 freier Platz' : `${remaining} freie Plätze`;
  const booking = row.querySelector('.booking');
  booking.hidden = remaining === 0;
  handleSubmit(booking, (trips, values) => {
    const currentTrip = trips.find(item => item.id === trip.id);
    const rideIndex = currentTrip.rides.findIndex(item => item.id === ride.id);
    currentTrip.rides[rideIndex] = reserveSeat(currentTrip.rides[rideIndex], values.name);
    return `Platz für ${values.name} bei ${ride.driver} reserviert (${directions[ride.direction]}).`;
  });
  return row;
}

function render(trips) {
  tripList.replaceChildren();
  for (const trip of trips) {
    const card = tripTemplate.content.cloneNode(true);
    card.querySelector('h2').textContent = trip.title;
    const arrival = dateFormat.format(new Date(trip.arrival));
    const stop = trip.stop ? ` · Zwischenstopp: ${trip.stop}` : '';
    card.querySelector('.details').textContent = `${trip.destination} · Ankunft ${arrival}${stop}`;

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

    handleSubmit(card.querySelector('.offer'), (trips, values) => {
      if (!values.driver || !values.pickup) throw new Error('Gib Name und Abholort ein.');
      const currentTrip = trips.find(item => item.id === trip.id);
      currentTrip.rides.push({
        ...values, capacity: Number(values.capacity), id: crypto.randomUUID(), passengers: [],
      });
      return `${directions[values.direction]} hinzugefügt.`;
    });
    tripList.append(card);
  }
}

handleSubmit(tripForm, (trips, values) => {
  if (!values.title || !values.destination) throw new Error('Gib einen Titel und ein Ziel ein.');
  trips.unshift({ ...values, id: crypto.randomUUID(), rides: [] });
  return 'Ausflug angelegt.';
});

render(readTrips());
window.addEventListener('storage', event => {
  if (event.key === storageKey || event.key === null) render(readTrips());
});
