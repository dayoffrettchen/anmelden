import assert from 'node:assert/strict';
import test from 'node:test';
import { reserveSeat } from '../public/model.js';

test('the last seat can be booked and a further booking is rejected', () => {
  const ride = { capacity: 1, passengers: [] };
  const bookedRide = reserveSeat(ride, ' Mara ');
  assert.deepEqual(bookedRide.passengers, ['Mara']);
  assert.deepEqual(ride.passengers, []);
  assert.throws(() => reserveSeat(bookedRide, 'Oskar'), /ausgebucht/);
});

test('a booking requires a nonblank name', () => {
  assert.throws(() => reserveSeat({ capacity: 1, passengers: [] }, ' '), /Namen/);
});
