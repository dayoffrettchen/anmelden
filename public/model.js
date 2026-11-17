export function reserveSeat(ride, name) {
  const passenger = name.trim();
  if (!passenger) throw new Error('Gib deinen Namen ein.');
  if (ride.passengers.length >= ride.capacity) throw new Error('Diese Fahrt ist ausgebucht.');
  return { ...ride, passengers: [...ride.passengers, passenger] };
}
