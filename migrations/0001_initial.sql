PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE
);
CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  destination TEXT NOT NULL,
  arrival_at TEXT NOT NULL,
  stop TEXT,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE trip_admins (
  trip_id TEXT NOT NULL REFERENCES trips(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (trip_id, user_id)
);
CREATE TABLE rides (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'return')),
  pickup TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 8),
  UNIQUE (id, trip_id, direction)
);
CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  passenger_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ride_id, trip_id, direction) REFERENCES rides(id, trip_id, direction),
  UNIQUE (trip_id, direction, passenger_id)
);
CREATE INDEX reservations_by_ride ON reservations(ride_id);

CREATE TRIGGER reservation_capacity BEFORE INSERT ON reservations
BEGIN
  SELECT RAISE(ABORT, 'ride_full')
  WHERE (SELECT COUNT(*) FROM reservations WHERE ride_id = NEW.ride_id)
    >= (SELECT capacity FROM rides WHERE id = NEW.ride_id);
  SELECT RAISE(ABORT, 'driver_cannot_book_own_ride')
  WHERE NEW.passenger_id = (SELECT driver_id FROM rides WHERE id = NEW.ride_id);
END;

CREATE TRIGGER reservation_update_capacity BEFORE UPDATE ON reservations
BEGIN
  SELECT RAISE(ABORT, 'ride_full')
  WHERE (SELECT COUNT(*) FROM reservations WHERE ride_id = NEW.ride_id AND id != OLD.id)
    >= (SELECT capacity FROM rides WHERE id = NEW.ride_id);
  SELECT RAISE(ABORT, 'driver_cannot_book_own_ride')
  WHERE NEW.passenger_id = (SELECT driver_id FROM rides WHERE id = NEW.ride_id);
END;

CREATE TRIGGER ride_capacity_update BEFORE UPDATE OF capacity ON rides
BEGIN
  SELECT RAISE(ABORT, 'capacity_below_bookings')
  WHERE NEW.capacity < (SELECT COUNT(*) FROM reservations WHERE ride_id = OLD.id);
END;
