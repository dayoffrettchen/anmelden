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

Lokal liefert die API einen Testlink direkt zurück. Im Onlinebetrieb wird er über Resend versendet. Die API begrenzt Linkanforderungen je E-Mail auf eine pro Minute. Ausflüge sind nur der ausflugserstellenden Person, den Ausflugsorganisatoren und eingeladenen E-Mail-Adressen zugänglich. Einladungen werden per Resend verschickt, Zugriffe ausschließlich im Worker geprüft. Veranstalter sehen eingeladene Personen und Buchungen, können Einladungen widerrufen und Reservierungen stornieren. Erstellende Personen können eingeladene Personen zu Organisatoren ernennen. Teilnehmer können ihre eigenen Reservierungen stornieren. Einladungen von Personen mit bestehenden Fahrten oder Reservierungen können nicht entfernt werden, bis diese Verpflichtungen geklärt sind. Das Entfernen angebotener Fahrten und Google-Login sind noch offen.

Bestehende lokale Installationen müssen erneut npm run db:migrate ausführen und ADMIN_EMAILS=mara@example.test in .dev.vars ergänzen.

Automatisierte API-, Migrations- und Resend-Mocktests laufen mit `npm test` und bei jedem Pull Request über `.github/workflows/ci.yml`. Der echte Versand einer Einladung, ein vollständiger Browser-End-to-End-Test und das Cloudflare-Deployment müssen anschließend gesondert in einer Staging-Umgebung geprüft werden.
