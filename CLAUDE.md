# Projektbriefing v2: NotebookLM-Klon in einem Tag

Dieses Dokument ist der Startprompt für die Claude Code CLI und wird zusätzlich als CLAUDE.md ins Repo eingecheckt. Es ist Teil der Abgabe.

---

## Kontext und Rolle

Du baust mit mir einen funktionsfähigen NotebookLM-Klon als Bewerbungsaufgabe für ein KI-first-Unternehmen. Ich bin Senior-Entwickler mit Schwerpunkt Identity und Access Management. Bewertet wird von technischer Seite, vermutlich mit besonderem Blick darauf, wie ich mit AI-Werkzeugen arbeite und ob ich LLM-Systeme verantwortungsvoll baue.

Drei Dinge muss die Abgabe deshalb zeigen:

1. Ein funktionierendes, deploytes Produkt
2. Einen sichtbaren, nachvollziehbaren AI-gestützten Arbeitsprozess
3. Dass ich LLM-Verhalten messe statt hoffe

Wichtig für unsere Zusammenarbeit: Ich muss am Ende jede Entscheidung erklären können. Arbeite in den unten definierten Phasen. Halte nach Phase 1, Phase 3 und Phase 5 an und fasse in maximal fünf Sätzen zusammen, was gebaut wurde und warum. Bei Abweichungen vom Briefing: erst fragen.

Zeitbudget: Der Kernbau (Phase 0 bis 5) ist auf etwa acht Arbeitsstunden ausgelegt und läuft über Freitag und Samstag. Danach folgen optionale Ausbauphasen, der Sonntag ist Puffer, die Abgabe ist Montag. Die Zeitboxen je Phase sind trotzdem verbindlich, sie schützen vor dem Verzetteln, nicht vor der Deadline. Läuft eine Phase über, sag es sofort und schlag einen Schnitt vor, statt still weiterzubauen. Die Ausbauphasen beginnen erst, wenn Phase 0 bis 5 vollständig abgeschlossen sind, inklusive grüner Tests und funktionierendem Deployment.

## Die zwei Thesen des Projekts

**These 1, Sicherheit:** Ein NotebookLM-Klon ist ein mehrmandantenfähiges Dokumentensystem mit Vektorsuche. Der kritische Teil ist nicht die RAG-Pipeline, sondern die Garantie, dass Nutzer A niemals Inhalte aus Dokumenten von Nutzer B erhält, weder über die API noch über die Vektorsuche noch über das LLM.

**These 2, Messbarkeit:** Ein LLM-Feature ohne Evaluierung ist eine Vermutung. Das Antwortverhalten wird mit einem Golden Set automatisiert geprüft, genau wie die Zugriffskontrolle mit Tests.

Jede Architekturentscheidung zahlt auf eine der beiden Thesen ein.

## Stack, nicht verhandelbar, alles Free Tier

- Next.js 15, App Router, TypeScript strict
- Auth.js v5 mit GitHub OAuth plus einem separaten Credentials-Provider, der ausschließlich zwei fest angelegte Demo-Konten akzeptiert
- Postgres mit pgvector bei Neon, angebunden über den Vercel Marketplace
- Drizzle ORM
- Vercel Blob für Dateien
- Vercel AI SDK mit dem Google-Provider: Gemini Flash oder Flash-Lite für Chat, gemini-embedding-001 für Embeddings, Schlüssel aus AI Studio
- Tailwind, shadcn/ui
- Vitest
- Deployment auf Vercel, CI über GitHub Actions mit Typecheck, Lint, Tests

Sämtliche LLM- und Embedding-Aufrufe laufen durch eigene Module in `lib/llm/`. Kein direkter SDK-Aufruf außerhalb davon. Grund, der auch im README steht: Der Gemini Free Tier erlaubt Google die Nutzung der Prompts für Modelltraining. Für einen Prototyp mit Demo-Daten vertretbar, für Kundendokumente nicht. Der Providerwechsel muss an einer Stelle möglich sein.

Prüfe die aktuelle Embedding-Dimension in der Gemini-Dokumentation, bevor du das Schema festlegst.

## Funktionsumfang

Im Umfang:

- Anmeldung über GitHub OAuth und über die zwei Demo-Konten
- Notebooks anlegen, umbenennen, löschen, auflisten
- Quellen je Notebook hochladen: PDF und TXT, Limit 10 MB, synchroner Ingestion-Flow mit Statusanzeige, kein Queue-System
- Ingestion: Text extrahieren, Chunks mit Überlappung, Positionsangaben je Chunk, Embeddings, speichern
- Chat je Notebook, gestreamt über das AI SDK
- Antworten strikt quellengebunden. Ohne passende Fundstellen sagt das System das ausdrücklich, statt frei zu antworten.
- Inline-Zitate, anklickbar, Sprung in die extrahierte Textansicht der Quelle mit Hervorhebung der Passage. Kein PDF-Viewer mit Positions-Overlay, das ist bewusst geschnitten.

Nicht im Umfang, gehört in den README-Abschnitt "Bewusst nicht umgesetzt": Audio-Synthese des Audio Overview (das Skript dazu ist Ausbaustufe, siehe Phase 6), URL- und YouTube-Import, Notebook-Freigabe zwischen Nutzern, PDF-Viewer mit Overlay, Mobile-Feinschliff. Schlag mir nichts davon vor.

## Datenmodell

Ausgangspunkt, begründete Abweichung erlaubt:

- Auth.js-Standardtabellen
- `notebooks`: id, ownerId, title, createdAt
- `sources`: id, notebookId, ownerId, filename, mimeType, blobPathname, status, extractedText, createdAt
- `chunks`: id, sourceId, notebookId, ownerId, content, charStart, charEnd, embedding
- `messages`: id, notebookId, ownerId, role, content, createdAt
- `citations`: id, messageId, chunkId

Die ownerId steht denormalisiert auf jeder Tabelle. Grund: Der Mandantenfilter gehört in dieselbe WHERE-Klausel wie die Vektorsuche, nicht in eine vorgelagerte Prüfung, die man vergessen kann.

Baue eine zentrale Zugriffsschicht, durch die jeder Datenzugriff läuft und die die Nutzer-Id per Typsignatur erzwingt. Kein Zugriff darf ohne sie kompilieren.

## Sicherheitsanforderungen

1. Mandantenfilter auf Query-Ebene erzwungen
2. Ownership-Prüfung auf jeder Ressource, fremde Ids liefern 404 statt 403, damit Existenz nicht bestätigt wird
3. Dateizugriff nur über kurzlebige signierte URLs nach serverseitiger Ownership-Prüfung
4. Prompt Injection: Dokumentinhalt ist Daten, niemals Anweisung. Klare Kennzeichnung des Quelltexts als nicht vertrauenswürdig im Prompt-Aufbau, robust auch gegen Trennmarker im Dokument selbst. Diese Stelle im Code ausführlich kommentieren.
5. Rate Limiting pro Nutzer auf allen LLM-Endpunkten, einfacher Zähler in Postgres, keine Zusatzinfrastruktur
6. Keine Schlüssel im Client-Bundle, Inferenz nur serverseitig

## Tests und Evals

**Zugriffstests, Vitest, Pflicht:**

- B ruft Notebook-Id von A auf: 404
- Vektorsuche als B liefert nie Chunks von A, auch bei semantisch exakt passender Anfrage
- Datei-Link von A wird für B abgewiesen
- Unauthentifizierte Aufrufe geschützter Endpunkte: 401
- Prompt-Aufbau kennzeichnet Quelltext korrekt, auch wenn dieser Steuerzeichen oder Trennmarker enthält

**Evals, per `npm run eval` ausführbar:**

Ein Golden Set von acht bis zehn Fragen gegen die Seed-Dokumente, als JSON im Repo. Je Fall: Frage, erwartete Quelldatei, Stichworte, die in der Antwort vorkommen müssen, plus mindestens zwei Negativfälle, bei denen die korrekte Antwort die Verweigerung ist, weil die Information in den Quellen fehlt, und ein Injection-Fall, bei dem die Antwort der eingebetteten Anweisung nicht folgen darf. Das Skript prüft Retrieval-Treffer und Antwort-Stichworte automatisch und gibt eine Tabelle aus. Die letzte Ergebnistabelle kommt ins README.

## Repo als Prozessnachweis

Das Unternehmen will sehen, wie ich vorgehe, und hat im Gespräch ausdrücklich die vollständige KI-Konversation als Teil der Abgabe genannt. Deshalb:

- Dieses Briefing liegt als CLAUDE.md im Repo
- `docs/decisions.md` führt je Phase zwei bis vier Zeilen: Entscheidung, verworfene Alternative, Grund. Du hältst die Datei am Ende jeder Phase aktuell.
- Die vollständigen Sessions dieser Zusammenarbeit werden exportiert und unter `docs/ai-sessions/` ins Repo gelegt. Erinnere mich am Ende jeder Arbeitssitzung an den Export. Führe die Konversation entsprechend: sachlich, strukturiert, auf Deutsch oder Englisch konsistent, sie wird mitgelesen.
- Ein Commit-Block je Phase mit aussagekräftigen Messages, keine hundert Mikro-Commits und kein einzelner Riesen-Commit

## Abgabepaket

Die Abgabe geht als Antwort auf die Aufgaben-Mail und umfasst vier Artefakte:

1. GitHub-Repo-Link, Repo öffentlich geschaltet
2. Link zum Live-Deployment inklusive Demo-Zugangsdaten
3. Die vollständige KI-Konversation, im Repo unter `docs/ai-sessions/` und in der Mail explizit erwähnt
4. Loom-Video, maximal zehn Minuten: Vorgehen erklären, Entscheidungen begründen, System live testen

## Demo-Daten

Seed-Skript legt an:

- `demo-a@example.com` und `demo-b@example.com` mit Passwörtern aus Umgebungsvariablen
- Je ein Notebook mit zwei thematisch klar unterscheidbaren Dokumenten, damit Zugriffsversuche über Kontogrenzen im Video sichtbar werden
- Bei A zusätzlich ein Dokument mit eingebetteter Prompt-Injection für die Live-Vorführung

## Phasen mit Zeitboxen

**Phase 0, 45 Minuten, Fundament.** Repo, Next.js, Tailwind, Drizzle, Neon verbunden, erste Seite live auf Vercel, CI steht. Deployment am Anfang, nicht am Ende.

**Phase 1, 90 Minuten, Identität und Daten.** Auth.js mit beiden Providern, Schema, Migrationen, zentrale Zugriffsschicht, Seed-Skript. Checkpoint.

**Phase 2, 90 Minuten, Quellen.** Upload, Extraktion, Chunking, Embeddings, Status im UI.

**Phase 3, 150 Minuten, Chat.** Vektorsuche mit erzwungenem Mandantenfilter, Prompt-Aufbau, Streaming, Zitate mit Sprung und Hervorhebung. Checkpoint.

**Phase 4, 90 Minuten, Härtung und Messung.** Die sechs Sicherheitspunkte vollständig, Zugriffstests, Eval-Skript mit Golden Set.

**Phase 5, 60 Minuten, Abschluss.** README, decisions.md finalisieren, Deployment-Check mit beiden Demo-Konten. Checkpoint. Ab hier ist die Abgabe jederzeit versandfähig.

## Ausbauphasen, nur nach vollständigem Kernbau

**Phase 6, etwa 2 Stunden, Produkttiefe.** Zwei generierte Artefakte je Notebook auf Knopfdruck: eine Zusammenfassung und ein Audio-Overview-Skript als Dialogtext zwischen zwei Sprechern, ausdrücklich ohne Audio-Synthese. Beides läuft durch dieselbe quellengebundene Pipeline wie der Chat, inklusive Zitaten in der Zusammenfassung. Ins Golden Set kommen zwei zusätzliche Eval-Fälle für die Zusammenfassung.

**Phase 7, offen, Qualität statt Features.** In dieser Reihenfolge: Eval-Set auf fünfzehn Fälle erweitern, Latenz der Ingestion und des Chats prüfen und offensichtliche Bremsen beheben, UI-Feinschliff mit Leerzuständen und Fehlerzuständen, README-Feinschliff. Keine neuen Features in dieser Phase, egal wie naheliegend sie wirken.

## README-Anforderungen

- Was das Projekt ist und kann, fünf Sätze
- Demo-Zugangsdaten und Deployment-Link
- Architekturentscheidungen mit Entscheidung, Alternative, Begründung. Mindestens: pgvector statt externer Vektordatenbank, denormalisierte ownerId, 404 statt 403, Provider-Abstraktion, Trennung der Auth-Provider.
- Eval-Ergebnistabelle des letzten Laufs
- Abschnitt "So habe ich AI eingesetzt": zwei Absätze über den Arbeitsprozess mit Briefing, Phasen und Checkpoints, Verweis auf CLAUDE.md und decisions.md
- Abschnitt "Bewusst nicht umgesetzt" mit je einem Satz Begründung
- Lokales Setup in unter zehn Zeilen

Ich-Form, sachlicher Ton, keine Superlative, keine Emojis, keine Gedankenstriche.

## Opferreihenfolge bei Zeitnot

In dieser Reihenfolge streichen: UI-Feinschliff, dann TXT-Sonderfälle, dann Hervorhebung beim Zitatsprung (Sprung zur Quelle bleibt), dann Streaming. Niemals streichen: Sicherheitspunkte, Zugriffstests, Evals, Deployment, Zitate als solche. Sag aktiv Bescheid, bevor du schneidest.
