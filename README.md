# Anmelden

Fahrgemeinschaften für Ausflüge mit Hin- und Rückfahrten. Die Oberfläche verwendet eine Worker-API mit D1. Reservierungen werden serverseitig gespeichert. SQL-Trigger prüfen die Kapazität auch bei konkurrierenden Buchungen.

## Lokal starten

Node.js 22.13 oder neuer verwenden.

```sh
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate
npm run db:seed
npm run dev
```

Die von Wrangler angezeigte localhost-Adresse öffnen. Mit Mara eine Fahrt anbieten, dann zu Oskar oder Alex wechseln und reservieren. Die Testpersonen sind ausschließlich für den lokalen Funktionstest vorgesehen. Ohne LOCAL_PREVIEW=true und einen localhost-Hostnamen verweigert die API den Zugriff.

```sh
npm test
npm run build
```

Die API-Tests verwenden einen SQLite-Adapter für D1. Sie prüfen Erstellen, Buchen, konkurrierende Reservierungen, Wiederholung derselben Buchung, Selbstbuchung und die Zugriffssperre außerhalb localhost. Ein echter D1-Test erfolgt zusätzlich beim lokalen Wrangler-Start.

## Cloudflare anbinden

Die D1-Datenbank-ID wird in wrangler.jsonc konfiguriert. Für den Onlinebetrieb LOCAL_PREVIEW weglassen. RESEND_API_KEY als Worker-Secret setzen. EMAIL_FROM muss eine bei Resend freigegebene Absenderadresse sein, APP_ORIGIN die vollständige HTTPS-Adresse der App. ADMIN_EMAILS enthält die kommaseparierten E-Mail-Adressen der Personen, die Ausflüge anlegen dürfen.

Vor einem Deployment mit privaten Ausflügen zuerst die D1-Migration in der Cloud ausführen (empfohlen: vorher Datenbanksicherung/Export):

```sh
npx wrangler d1 migrations apply anmelden --remote
npm test
npm run build
npx wrangler deploy
```

Die Migration 0003 legt Einladungen an und übernimmt automatisch Fahrer und Fahrgäste bereits bestehender Ausflüge. Sonstige frühere Betrachter werden bewusst nicht übernommen. In der Produktion muss der Resend-API-Key bereits als Secret hinterlegt sein. Ohne Migration wird die neue API nicht funktionieren.

Vorherige Browser-Daten der Vorschau bleiben im localStorage erhalten. Sie werden nicht automatisch in D1 übernommen, da ihnen verifizierte Benutzeridentitäten fehlen.


## E-Mail-Anmeldung

Die Oberfläche fordert einen Link mit Name und E-Mail an. Der Link ist 15 Minuten gültig und wird nach dem Öffnen ausdrücklich bestätigt. Danach besteht eine siebentägige Sitzung. Abmelden widerruft die Sitzung auf dem Server. In der Datenbank liegen Hashes der Link- und Sitzungstoken.

Lokal liefert die API einen Testlink direkt zurück. Im Onlinebetrieb wird er über Resend versendet. Die API begrenzt Linkanforderungen je E-Mail auf eine pro Minute. Ausflüge sind nur der ausflugserstellenden Person, den Ausflugsorganisatoren und eingeladenen E-Mail-Adressen zugänglich. Einladungen werden per Resend verschickt, Zugriffe ausschließlich im Worker geprüft. Veranstalter sehen eingeladene Personen und Buchungen, können Einladungen widerrufen und Reservierungen stornieren. Erstellende Personen können eingeladene Personen zu Organisatoren ernennen. Teilnehmer können ihre eigenen Reservierungen stornieren. Einladungen von Personen mit bestehenden Fahrten oder Reservierungen können nicht entfernt werden, bis diese Verpflichtungen geklärt sind. Fahrer und Organisatoren können Fahrtangebote ohne bestehende Reservierungen entfernen. Google-Login ist noch offen.

Bestehende lokale Installationen müssen erneut npm run db:migrate ausführen und ADMIN_EMAILS=mara@example.test in .dev.vars ergänzen.

Automatisierte API-, Migrations- und Resend-Mocktests laufen mit `npm test` und bei jedem Pull Request über `.github/workflows/ci.yml`. GitHub Actions startet zusätzlich einen echten lokalen Cloudflare Worker mit D1 und prüft im Chromium-Browser Ausflug anlegen, Einladen, Buchung, Stornierung und Zugriffsschutz. Der echte Versand einer Einladung über Resend und das produktive Cloudflare-Deployment müssen weiterhin in einer Staging-Umgebung geprüft werden.


## Cloudflare-Deployment über GitHub Actions (manuell)

Der Workflow .github/workflows/cloudflare-production.yml bietet drei getrennte
Aktionen: inspect (D1-Schema und noch offene Migrationen anzeigen),
migrate (remote D1-Migrationen anwenden) und deploy (Worker deployen).
Er läuft nicht automatisch bei einem Push. Nur der Branch main ist zugelassen.

### Einmalige Einrichtung

1. In Cloudflare einen API-Token nur für das zugehörige Konto anlegen, mit
   Account > Workers Scripts > Edit und Account > D1 > Edit
   (soweit verfügbar weiter auf den Worker anmelden eingrenzen).
2. In GitHub unter Settings > Environments ein Environment namens
   cloudflare-production anlegen. Optional Required Reviewer konfigurieren.
3. Dort Environment secrets anlegen:
   - CLOUDFLARE_API_TOKEN: der neue API-Token, niemals ins Repository committen.
   - CLOUDFLARE_ACCOUNT_ID: die Cloudflare Account ID (nicht die D1-Database-ID).
4. Auf Actions > Cloudflare Produktion (manuell) > Run workflow starten.
   Zunächst inspect wählen und die D1-Ausgabe prüfen. Danach migrate
   und erst anschließend deploy ausführen.

Bei migrate wird vor den SQL-Änderungen ein Cloudflare D1 Time-Travel-Bookmark
im Workflow-Protokoll angezeigt; Cloudflare erstellt außerdem bei Migrationen
eine Sicherung. Bei Bedarf die Datenbank nicht eigenständig zurücksetzen,
sondern den gewünschten Wiederherstellungspunkt genau prüfen. Time Travel ist
zeitlich begrenzt (7 Tage Workers Free, 30 Tage Workers Paid). Für eine
langfristige Aufbewahrung einen separaten verschlüsselten Export verwenden.

Vor deploy prüft der Workflow, dass die Tabelle trip_invites vorhanden ist.
Nach dem Deployment prüft er den öffentlichen Login-Endpunkt.
Das Wrangler-Flag keep_vars: true erhält bereits im Cloudflare-Dashboard
gesetzte Variablen. Die GitHub Actions können die Produktivdatenbank verändern;
die Freigabe muss bewusst erfolgen.

GitHub Actions und das verfügbare GitHub-Plugin ermöglichen mir Codeänderungen,
Testauswertung und das Lesen der Workflow-Protokolle. Der Cloudflare-Token wird
nicht an ChatGPT weitergegeben. Das manuelle Starten des Produktionsworkflows
bleibt eine GitHub-Bedienhandlung; ein direkter Cloudflare-Kontozugriff
aus dem Chat ist damit nicht eingerichtet.


## Debug-Zugang ohne E-Mail

Zum Aktivieren in den Worker-Einstellungen DEBUG_LOGIN_ENABLED auf true setzen und DEBUG_LOGIN_SECRET als Secret mit einem zufällig generierten Wert von mindestens 32 Zeichen hinterlegen. Danach erscheint der Debug-Zugang. Das Passwort kann im Passwortmanager gespeichert werden. Es wird von der App weder in URLs noch im localStorage abgelegt.

Zwei feste Testkonten stehen bereit. Organisation (debug-organizer@example.test) kann Ausflüge anlegen, Teilnehmer (debug-participant@example.test) nutzt die normalen Einladungs- und Buchungsrechte. Für den Durchlauf einen Testausflug erstellen, debug-participant@example.test einladen und zum Teilnehmerkonto wechseln. Einladungen zwischen diesen Debug-Konten benötigen keinen E-Mail-Versand. Für andere Empfänger gelten die normalen Versandregeln.

Die Sitzung hält sieben Tage. DEBUG_LOGIN_ENABLED=false oder ein Wechsel des Secrets sperrt bereits ausgestellte Debug-Sitzungen sofort bei der nächsten Anfrage. Der Modus ist standardmäßig aus. Testdaten liegen in derselben Datenbank und bleiben beim Abschalten erhalten.
