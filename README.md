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

In wrangler.jsonc steht eine Platzhalter-Datenbank-ID. Nach Erstellung der D1-Datenbank muss deren ID eingetragen werden. Für den Onlinebetrieb LOCAL_PREVIEW weglassen. RESEND_API_KEY als Worker-Secret setzen. EMAIL_FROM muss eine bei Resend freigegebene Absenderadresse sein, APP_ORIGIN die vollständige HTTPS-Adresse der App. ADMIN_EMAILS enthält die kommaseparierten E-Mail-Adressen der Personen, die Ausflüge anlegen dürfen. Diese Konfiguration steht noch aus.

Vorherige Browser-Daten der Vorschau bleiben im localStorage erhalten. Sie werden nicht automatisch in D1 übernommen, da ihnen verifizierte Benutzeridentitäten fehlen.


## E-Mail-Anmeldung

Die Oberfläche fordert einen Link mit Name und E-Mail an. Der Link ist 15 Minuten gültig und wird nach dem Öffnen ausdrücklich bestätigt. Danach besteht eine siebentägige Sitzung. Abmelden widerruft die Sitzung auf dem Server. In der Datenbank liegen Hashes der Link- und Sitzungstoken.

Lokal liefert die API einen Testlink direkt zurück. Im Onlinebetrieb wird er über Resend versendet. Die API begrenzt Linkanforderungen je E-Mail auf eine pro Minute. Google-Login, Einladungen je Ausflug und die Verwaltung weiterer Ausflugsadmins über die Oberfläche sind noch offen. Angemeldete Personen können derzeit alle Ausflüge sehen.

Bestehende lokale Installationen müssen erneut npm run db:migrate ausführen und ADMIN_EMAILS=mara@example.test in .dev.vars ergänzen.

Der echte E-Mail-Versand und die Browserbedienung wurden in dieser Umgebung noch nicht geprüft.
