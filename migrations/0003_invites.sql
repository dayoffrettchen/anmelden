CREATE TABLE trip_invites (
  trip_id TEXT NOT NULL REFERENCES trips(id),
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('participant', 'organizer')),
  invited_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, email)
);
CREATE INDEX trip_invites_by_email ON trip_invites(email, trip_id);

-- Preserve access for everyone who already offered a ride or made a booking.
-- Other previously uninvited viewers will intentionally lose access.
INSERT OR IGNORE INTO trip_invites(trip_id, email, role, invited_by, created_at)
SELECT DISTINCT r.trip_id, u.email, 'participant', t.created_by, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM rides r JOIN users u ON u.id = r.driver_id JOIN trips t ON t.id = r.trip_id;
INSERT OR IGNORE INTO trip_invites(trip_id, email, role, invited_by, created_at)
SELECT DISTINCT b.trip_id, u.email, 'participant', t.created_by, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM reservations b JOIN users u ON u.id = b.passenger_id JOIN trips t ON t.id = b.trip_id;
