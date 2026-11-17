# Anmelden

Lokale Vorschau für Fahrgemeinschaften zu Ausflügen. Ausflug mit Ziel, Ankunftszeit und optionalem Zwischenstopp anlegen. Anschließend Plätze für Hin- oder Rückfahrten anbieten und reservieren.

## Lokal starten

```sh
python3 -m http.server 8787 --bind 127.0.0.1 --directory public
```

Im Browser [http://localhost:8787](http://localhost:8787) öffnen. Die Vorschau speichert Daten im aktuellen Browser. Sie dient zum Testen des Ablaufs mit Beispieldaten.

```sh
npm test
```

Für die gemeinsame Nutzung sind Cloudflare Workers und D1 vorgesehen. Dazu kommen Einladungslinks, persönliche Anmeldungen, Adminzugriff und serverseitige Platzreservierungen. Die lokale Vorschau benötigt keine Anmeldedaten oder Cloudflare-Konfiguration.
