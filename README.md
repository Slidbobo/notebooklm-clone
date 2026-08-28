# NotebookLM Clone

Quellengebundener Dokumenten-Chat mit erzwungener Mandantentrennung. Nutzer
legen Notebooks an, laden PDF- und TXT-Quellen hoch und stellen Fragen dazu.
Antworten stützen sich ausschließlich auf gefundene Textstellen und verweigern
die Auskunft, wenn die Quellen sie nicht hergeben.

> Stand: Phase 0 von 5. Diese Datei wird in Phase 5 vollständig ausgeschrieben.
> Die Anforderungen an den Endstand stehen in `CLAUDE.md`.

## Deployment

https://notebooklm-clone.vercel.app

Serverless Functions laufen in `fra1` (Frankfurt), zusammen mit der Datenbank
und dem Blob-Store. Demo-Zugangsdaten folgen mit Phase 1.

## Lokales Setup

```bash
cp .env.example .env.local     # Werte eintragen, siehe Kommentare in der Datei
docker compose up -d           # Postgres mit pgvector auf Port 5432
npm install
npm run db:migrate             # ab Phase 1
npm run dev                    # http://localhost:3000
npm test                       # braucht die laufende Datenbank
```

## Architekturentscheidungen

Die vollständige Liste entsteht bis Phase 5. Bisher festgelegt:

### Datenbanktreiber: postgres.js statt @neondatabase/serverless

**Entscheidung:** Die Anwendung spricht über `postgres.js` per TCP mit Postgres,
lokal, in der CI und auf Vercel.

**Alternative:** `@neondatabase/serverless`, der von Neon empfohlene Treiber, der
Abfragen über HTTP oder WebSocket an Neons eigenen Proxy schickt und in
kurzlebigen Serverless-Umgebungen weniger Verbindungsaufwand hat.

**Begründung:** Die tragende These dieses Projekts lautet, dass Nutzer A niemals
Inhalte von Nutzer B erhält, auch nicht über die Vektorsuche. Diese Zusicherung
ist eine Eigenschaft des erzeugten SQL: der Mandantenfilter steht in derselben
WHERE-Klausel wie die Ähnlichkeitssuche. Prüfen lässt sich das nur, indem die
Abfrage gegen eine echte Postgres-Instanz mit pgvector läuft. Der Neon-Treiber
spricht ausschließlich mit Neons Proxy, also hätte die CI entweder gegen eine
gemockte Datenbankschicht getestet, was den Mock prüft statt die Zusicherung,
oder gegen einen echten Neon-Branch, was Produktionszugangsdaten in die
GitHub-Actions-Umgebung getragen hätte. Mit `postgres.js` läuft in der CI ein
gewöhnlicher `pgvector/pgvector`-Container, lokal derselbe über
`docker-compose.yml`, und auf Vercel dieselbe Codezeile gegen Neon. Der Preis
ist der Verzicht auf Neons HTTP-Pfad und die Notwendigkeit von `prepare: false`,
weil Neons Pooler PgBouncer im Transaction-Mode betreibt und keine Prepared
Statements unterstützt. Die Testbarkeit der Sicherheitsthese hat hier den
Treiber bestimmt, nicht umgekehrt.

## Dokumente

- `CLAUDE.md`: das Projektbriefing, zugleich Startprompt für die Zusammenarbeit
  mit Claude Code
- `docs/decisions.md`: Entscheidungen je Phase mit verworfener Alternative und
  Begründung
- `docs/ai-sessions/`: die vollständigen Sessions dieser Zusammenarbeit
