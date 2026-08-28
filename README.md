# NotebookLM Clone

Quellengebundener Dokumenten-Chat mit erzwungener Mandantentrennung. Nutzer
legen Notebooks an, laden PDF- und TXT-Quellen hoch und stellen Fragen dazu.
Antworten stützen sich ausschließlich auf gefundene Textstellen und verweigern
die Auskunft, wenn die Quellen sie nicht hergeben.

> Stand: Phase 0 von 5. Diese Datei wird in Phase 5 vollständig ausgeschrieben.
> Die Anforderungen an den Endstand stehen in `CLAUDE.md`.

## Lokales Setup

```bash
cp .env.example .env.local     # Werte eintragen, siehe Kommentare in der Datei
docker compose up -d           # Postgres mit pgvector auf Port 5432
npm install
npm run db:migrate             # ab Phase 1
npm run dev                    # http://localhost:3000
npm test                       # braucht die laufende Datenbank
```

## Dokumente

- `CLAUDE.md`: das Projektbriefing, zugleich Startprompt für die Zusammenarbeit
  mit Claude Code
- `docs/decisions.md`: Entscheidungen je Phase mit verworfener Alternative und
  Begründung
- `docs/ai-sessions/`: die vollständigen Sessions dieser Zusammenarbeit
