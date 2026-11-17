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

In wrangler.jsonc steht eine Platzhalter-Datenbank-ID. Nach Erstellung der D1-Datenbank muss deren ID eingetragen werden. Vor öffentlicher Nutzung sind persönliche Anmeldung und Berechtigungen zu implementieren. Die Online-API bleibt bis dahin gesperrt.

Vorherige Browser-Daten der Vorschau bleiben im localStorage erhalten. Sie werden nicht automatisch in D1 übernommen, da ihnen verifizierte Benutzeridentitäten fehlen.
