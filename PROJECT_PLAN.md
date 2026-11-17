# Fahrgemeinschaften zu Ausflügen

## Vereinbarter Ablauf

Mehrere Admins können Ausflüge organisieren. Sie legen Ziel, Ankunftszeit und Zwischenstopp fest. Teilnehmende bieten Plätze an oder reservieren einen Platz, jeweils für Hin- und Rückfahrt. Abholung unterwegs und spätere Änderungen sollen berücksichtigt werden.

Anmeldung über Name und E-Mail mit persönlichem Link sowie Google-Login. E-Mail-Adressen sollen für Personen im selben Auto sichtbar sein.

Als Betrieb sind Cloudflare Workers, D1, Resend und openrouteservice vorgesehen.

## Aktueller Stand

Die Oberfläche ist mit der Worker-API und D1 verbunden. Lokal sind drei Testpersonen auswählbar. Die API erstellt Ausflüge samt Adminzuordnung, Fahrtangebote und Reservierungen. SQL schützt gegen Überbuchung und doppelte Buchungen je Richtung. Wiederholte Buchungen derselben Fahrt werden erkannt.

E-Mail-Anmeldung mit einmaligem Link, Sitzungen und Logout ist implementiert. ADMIN_EMAILS steuert das Anlegen von Ausflügen. Onlineversand benötigt die Resend-Konfiguration und APP_ORIGIN.

## Nächste Umsetzung

Echten E-Mail-Versand und Browserablauf prüfen. Umbuchung und Google-Login ergänzen. Einladungen, Rollenverwaltung und Stornierungen sind im Feature-Branch implementiert und werden automatisiert geprüft. Vor produktiver Freischaltung D1-Migration 0003 ausführen. Abholorte und Zeitfenster mit Routing prüfen und automatische Zuteilung ergänzen.

Automatische Umbuchungen brauchen eine Regel für unlösbare Änderungen, beispielsweise den Wegfall eines Autos. Bis diese Regel umgesetzt ist, darf eine Änderung keine bestätigte Buchung stillschweigend entfernen.

## Prüfung

API-Integrationstests über SQLite, lokale D1-Migration samt Testdaten und Wrangler-Dry-Run erfolgreich. Der lokale Webserverstart scheiterte in der Entwicklungsumgebung an uv_interface_addresses. Browserablauf und Cloudflare-Deployment sind noch zu verifizieren.
