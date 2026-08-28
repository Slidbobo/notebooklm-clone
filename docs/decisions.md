# Entscheidungen

Je Phase die Entscheidungen, die nicht offensichtlich sind: was gewählt wurde,
was verworfen wurde, warum. Ergänzt das Briefing in `CLAUDE.md`, das den
Rahmen setzt, aber nicht jede Abwägung vorwegnimmt.

## Rahmen

**Branch-Modell: `main` als einziger Branch, ein Commit-Block je Phase.**
Verworfen: Feature-Branch plus Pull Request je Phase, wie es meine sonstige
Arbeitsweise vorsieht. Grund: Solo-Repo, sechs Phasen an einem Wochenende, kein
Reviewer. Sechs Pull Requests gegen mich selbst erzeugen Verwaltungsaufwand ohne
Erkenntnisgewinn. Die Nachvollziehbarkeit liefern hier die Phasen-Commits und
diese Datei.

**Sprache: Code, Kommentare, Commits und CI auf Englisch, README und diese Datei
auf Deutsch.** Verworfen: durchgehend eine Sprache. Grund: Der Code soll für ein
beliebiges Team lesbar sein, die Abgabedokumente richten sich an konkrete
deutschsprachige Leser.

## Phase 0, Fundament

**Deployment am Anfang statt am Ende.** Verworfen: lokal bauen und zum Schluss
deployen. Grund: Die teuren Überraschungen bei Vercel, Neon und OAuth sind
Konfigurationsfehler, keine Codefehler. Sie sollen auftreten, solange noch
nichts darauf aufbaut.

**Datenbanktreiber: `postgres.js` über TCP.** Verworfen:
`@neondatabase/serverless`. Grund: Der Neon-Treiber spricht ausschließlich mit
dem HTTP- und WebSocket-Proxy von Neon. Damit ließen sich die Zugriffstests aus
These 1 nicht gegen einen gewöhnlichen pgvector-Container in der CI ausführen.
Ein Treiber für beide Umgebungen hält die Tests ehrlich. Preis: kein
HTTP-Fallback, dafür `prepare: false` gegen den PgBouncer-Pooler von Neon.

**CI-Datenbank: pgvector-Service-Container in GitHub Actions.** Verworfen:
gemockte Datenbankschicht, alternativ ein Neon-Test-Branch mit Secrets in der
CI. Grund: Die zentrale Zusicherung des Projekts lautet, dass der Mandantenfilter
in derselben WHERE-Klausel steht wie die Vektorsuche. Das ist eine Eigenschaft
von erzeugtem SQL. Ein Mock würde den Mock prüfen. Ein Neon-Branch würde
Produktionszugangsdaten in die CI tragen. `docker-compose.yml` benutzt dasselbe
Image, damit lokal und in der CI dasselbe läuft.

**Next.js 15 bleibt, `postcss` und `esbuild` werden per `overrides` angehoben.**
Verworfen: `npm audit fix --force`, das auf Next.js 16 aktualisiert hätte.
Grund: Der Stack ist im Briefing festgelegt. Beide Warnungen betrafen
Build-Werkzeuge, nicht die Laufzeit. Die Überschreibungen lösen sie ohne den
Stack zu brechen, `npm audit` meldet null Befunde.
