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

### LLM-Zugriff nur über lib/llm, Anbieter austauschbar an einer Stelle

**Entscheidung:** Jeder Aufruf eines Sprach- oder Embedding-Modells läuft durch
`lib/llm/`. Außerhalb dieses Verzeichnisses gibt es keinen direkten SDK-Aufruf,
und die Modellkonfiguration steht an einer einzigen Stelle.

**Alternative:** Das Vercel AI SDK dort aufrufen, wo es gebraucht wird, also in
der Chat-Route und im Ingestion-Pfad. Weniger Code, ein Sprung weniger beim
Lesen.

**Begründung:** Anbieterunabhängigkeit. Ein Wechsel des Modellanbieters ist
sonst eine Suche über die gesamte Codebasis, mit dem Risiko, eine Aufrufstelle
zu übersehen. Der konkrete Anlass für diesen Prototyp ist die Frage der
Auftragsverarbeitung: Die Datenschutzbedingungen von Google AI Studio sind für
Entwickler im EWR, der Schweiz und dem Vereinigten Königreich unkritisch, dort
gelten laut den Gemini-API-Nutzungsbedingungen die Bedingungen der
kostenpflichtigen Dienste für alle Dienste, auch für das kostenlose Kontingent,
Prompts und Antworten werden also nicht zur Produktverbesserung verwendet. Was
ein API-Schlüssel aus AI Studio nicht mitbringt, ist ein vertraglich
zugesicherter Auftragsverarbeitungsvertrag. Für einen Prototyp mit Demo-Daten
ist das unerheblich. Sobald echte Kundendokumente verarbeitet würden, wäre der
Wechsel zu einem Anbieter mit vertraglicher Zusicherung erforderlich, etwa
Vertex AI unter dem Cloud-Rahmenvertrag. Diese Abstraktion macht daraus eine
Änderung in einem Verzeichnis statt einer Migration.

Der API-Schlüssel liegt in einem eigenen Google-Cloud-Projekt `notebooklm-clone`
und nicht im Default-Projekt. Damit ist er isoliert widerrufbar und das
Kontingent von anderen Projekten getrennt.

### Negativtests, weil eine Prüfung sich selbst nicht prüft

**Entscheidung:** Jede Schutzmaßnahme in diesem Projekt wird mit einem absichtlich
kaputten Eingabewert getestet, nicht nur mit einem gültigen.

**Alternative:** Prüfen, dass die Schutzmaßnahme bei korrekter Eingabe nicht
stört, und daraus schließen, dass sie bei falscher Eingabe greift.

**Begründung:** Der Anlass ist ein eigener Fehlgriff. Die erste Fassung der
Blob-Prüfung hat den Fehler des Anbieters über einen Textvergleich auf der
Fehlermeldung eingeordnet. Mit einem gültigen Token lief sie durch, und der Code
sah richtig aus. Erst der Test mit einem frei erfundenen Token hat gezeigt, dass
sie ihn als Netzwerkproblem einstuft und damit als nicht fatal durchwinkt, also
genau den Fall verfehlt, für den sie existiert. Der SDK wirft typisierte Fehler,
ein erfundener Token ergibt `BlobStoreNotFoundError`; seitdem entscheidet die
Fehlerklasse. Dieselbe Logik trägt die Zugriffstests und die Verweigerungsfälle
im Golden Set: eine Prüfung, die nur mit gültigen Eingaben getestet wird,
beweist, dass sie nicht stört, nicht dass sie schützt. Auch die Lint-Regel um die
Zugriffsschicht wird deshalb gegen einen absichtlichen Verstoß getestet, denn
eine Regel, die still nicht mehr greift, sieht aus wie ein sauberer
Codebestand.

### Konfiguration wird an drei Stellen geprüft

**Entscheidung:** Fehlende oder ungültige Konfiguration fällt im Build auf, nicht
beim ersten Nutzer. Drei Ebenen: `scripts/check-env.ts` prüft vor dem Build Form
und Gültigkeit, `/api/health` prüft zur Laufzeit, `scripts/verify-deployment.ts`
prüft nach jedem Deploy und läuft als eigener CI-Job.

**Alternative:** Sich auf die Validierung in `lib/env.ts` verlassen.

**Begründung:** Die läuft nachweislich erst beim ersten Request. Seit der
Datenbankzugriff faul initialisiert wird, baut das Projekt vollständig ohne
gesetzte Umgebungsvariablen durch, was ein Build mit beiseitegeschobener
`.env.local` bestätigt. Ein grüner Build vor einer toten Anwendung ist damit ein
realistischer Zustand. Der Build prüft deshalb zuerst die Form jeder Variablen
und probiert danach die beiden Anbieterzugangsdaten live an, über die Modellliste
und einen Blob-Eintrag, beides ohne Tokenverbrauch. Ein abgelehnter Schlüssel
bricht den Build ab, ein Netzwerkproblem beim Anbieter nicht. Die Formatregeln
wurden gegen die tatsächlichen Werte verifiziert statt aus dem Gedächtnis
geschrieben; der Gemini-Schlüssel dieses Projekts hat das neuere Präfix `AQ.`,
und eine aus der Erinnerung geschriebene Regel auf `AIza` hätte einen intakten
Schlüssel abgelehnt.

Der tiefe Healthcheck unter `/api/health?deep=1` setzt eine angemeldete Session
voraus, damit nicht öffentlich abfragbar ist, welche Abhängigkeit gerade
ausfällt. Ein eigenes Token wurde verworfen, weil die CI das produktive
`AUTH_SECRET` ohnehin nicht besitzen kann und ein abgeleiteter Wert dort nicht
berechenbar wäre. Der flache Endpunkt bleibt offen und macht keine externen
Aufrufe.

### Migrationen laufen im Build

**Entscheidung:** `npm run build` wendet ausstehende Migrationen an, bevor
Next.js baut, abgesichert durch einen Advisory Lock in Postgres.

**Alternative:** Migrationen von Hand aus der Entwicklungsumgebung gegen die
Produktionsdatenbank anwenden.

**Begründung:** Vercel gibt Produktions-Secrets nicht an die CLI heraus, ein
`vercel env pull` liefert für alle sensiblen Werte Platzhalter. Der Weg von Hand
hätte also bedeutet, eine Verbindungszeichenfolge außerhalb der Plattform
weiterzureichen. Im Build stehen die Zugangsdaten ohnehin bereit, und das Schema
einer deployten Umgebung kann nicht mehr von dem Code abweichen, mit dem sie
deployt wurde. Der Advisory Lock ist keine Vorsichtsmaßnahme auf Verdacht: beim
ersten Versuch liefen ein Git-Deploy und ein manuelles Deploy gleichzeitig, beide
migrierten dieselbe Datenbank, und eines davon ist mitten in der Migration
abgebrochen. `pg_advisory_lock` serialisiert sie, ohne zusätzliche
Infrastruktur, und wird beim Verbindungsabbruch automatisch freigegeben.

## Dokumente

- `CLAUDE.md`: das Projektbriefing, zugleich Startprompt für die Zusammenarbeit
  mit Claude Code
- `docs/decisions.md`: Entscheidungen je Phase mit verworfener Alternative und
  Begründung
- `docs/ai-sessions/`: die vollständigen Sessions dieser Zusammenarbeit
