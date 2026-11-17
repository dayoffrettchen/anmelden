# Fahrgemeinschaften zu Ausflügen

## Vereinbarter Ablauf

Mehrere Admins können Ausflüge organisieren. Sie legen Ziel, Ankunftszeit und Zwischenstopp fest. Teilnehmende bieten Plätze an oder reservieren einen Platz, jeweils für Hin- und Rückfahrt. Abholung unterwegs und spätere Änderungen sollen berücksichtigt werden.

Anmeldung über Name und E-Mail mit persönlichem Link sowie Google-Login. E-Mail-Adressen sollen für Personen im selben Auto sichtbar sein.

Als Betrieb sind Cloudflare Workers, D1, Resend und openrouteservice vorgesehen.

## Aktueller Stand

Die Oberfläche ist eine lokale Vorschau mit Browser-Speicherung. Sie unterstützt Ausflüge, Fahrtangebote und Platzreservierungen. Alle Eingaben sind auf diesen Browser beschränkt. Login, gemeinsame Speicherung und Berechtigungen sind noch offen.

Die erste SQL-Migration bereitet Benutzer, mehrere Admins je Ausflug, Fahrten und Reservierungen vor. Constraints und Trigger verhindern doppelte Reservierungen derselben Person je Richtung, überbuchte Autos und eine Reduzierung der Kapazität unter bestehende Buchungen. Das Schema ist noch nicht an die Oberfläche angeschlossen.

## Nächste Umsetzung

1. Worker-API mit D1 und serverseitiger Validierung an die Oberfläche anschließen.
2. Persönliche Anmeldelinks, Sitzungen und Adminberechtigungen implementieren.
3. Reservieren, Stornieren und Umbuchen als atomare Datenbankoperationen.
4. Resend und Google-Login anbinden.
5. Abholorte und Zeitfenster mit Routing prüfen und automatische Zuteilung ergänzen.

Automatische Umbuchungen brauchen eine Regel für unlösbare Änderungen, beispielsweise den Wegfall eines Autos. Bis diese Regel umgesetzt ist, darf eine Änderung keine bestätigte Buchung stillschweigend entfernen.

## Prüfung

Die lokale Reservierungslogik wird mit Node getestet. Das Datenbankschema wird zusätzlich gegen SQLite geprüft. Deployment und D1-Ausführung bleiben bis zur Cloudflare-Anbindung unbestätigt.
