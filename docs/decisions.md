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

**Vercel-Scope: `keybilium-projects`.** Verworfen: der Scope `homesk`, unter dem
das Projekt zuerst angelegt war. Grund: `homesk` ist ein Kunden-Scope mit
fremden Projekten, dort gehört ein Bewerbungsprojekt nicht hin. Der
KeyBilium-Account geht später in persönlichen Besitz über und ist damit der
neutrale Ort. Das Projekt unter `homesk` wurde samt Deployments gelöscht, die
Git-Verbindung vorher gelöst, damit ein Push nicht zwei Projekte deployt.

**Function Region `fra1` in `vercel.json` statt in den Projekteinstellungen.**
Verworfen: die Region im Vercel-Dashboard setzen. Grund: Datenbank und
Blob-Store liegen in `eu-central-1`. Steht die Region in der Repository-Datei,
ist sie versioniert, im Review sichtbar und überlebt ein Neuanlegen des
Projekts, was beim Scope-Wechsel gerade passiert ist.

**Next.js 15 bleibt, `postcss` und `esbuild` werden per `overrides` angehoben.**
Verworfen: `npm audit fix --force`, das auf Next.js 16 aktualisiert hätte.
Grund: Der Stack ist im Briefing festgelegt. Beide Warnungen betrafen
Build-Werkzeuge, nicht die Laufzeit. Die Überschreibungen lösen sie ohne den
Stack zu brechen, `npm audit` meldet null Befunde.

## Phase 1, Identität und Daten

**Embedding-Breite 1536 statt der Modellvorgabe 3072.** Verworfen: die
Standardausgabe von `gemini-embedding-001` unverändert speichern. Grund:
pgvector speichert bis 16000 Dimensionen, indiziert mit HNSW und IVFFlat aber
nur bis 2000. Eine 3072 breite Spalte hätte bei jeder Suche einen sequenziellen
Scan bedeutet. 1536 ist der breiteste indizierbare Wert unter den vom Modell
empfohlenen Größen. Getrunkierte Vektoren dieses Modells sind nicht auf Länge
eins normiert, das Embedding-Modul normalisiert sie deshalb vor dem Speichern.

**Zugriffsschicht als eine Datei mit gleichförmigen Funktionen.** Verworfen:
eine generische Repository-Abstraktion, die den Mandantenfilter automatisch
anhängt. Grund: Automatik verschiebt die Frage nur. Wer prüfen will, ob der
Filter greift, müsste den Generator lesen statt die Abfrage. So steht in jeder
einzelnen Funktion `eq(table.ownerId, userId)` sichtbar in derselben
WHERE-Klausel wie die Suche, und die Prüfung ist ein Blick statt einer
Beweisführung.

**Zwei benannte Casts auf `UserId` statt einer generischen Konstruktorfunktion.**
Verworfen: ein `asUserId(string)`, das überall aufrufbar ist. Grund: Der Branded
Type ist nur so viel wert wie die Zahl der Stellen, die ihn erzeugen dürfen. Es
gibt genau zwei, `userIdFromSession` für den Anwendungspfad und
`trustedUserIdForSeed` für das Offline-Skript, jede mit eigener Begründung im
Code. Die Frage "woher kommt Mandantenidentität" ist damit eine Suche nach zwei
Symbolen.

**Passwort-Hashing mit scrypt aus `node:crypto` statt bcrypt oder Argon2id.**
Verworfen: `bcryptjs`, die übliche Wahl. Grund: scrypt ist speicherhart, von
OWASP als Passwort-Hash anerkannt und Teil der Laufzeit, also kein zusätzliches
Paket und kein natives Modul im Vercel-Build für eine Funktion, die nur
existiert, damit ein Prüfer sich anmelden kann. Die Kostenparameter stehen im
Hash-String, ein späteres Anheben entwertet bestehende Hashes nicht.

**Tests dürfen unter die Zugriffsschicht greifen, Anwendungscode nicht.**
Verworfen: die Lint-Regel auch auf `tests/` anwenden. Grund: Die Zugriffstests
müssen Daten für zwei Konten anlegen und danach von außen prüfen, dass die
Grenze hält. Eine Regel, die ihnen den direkten Zugriff verbietet, würde genau
den Test verhindern, der die These belegt. `tests/access-layer-boundary.test.ts`
lintet dafür einen absichtlichen Verstoß und schlägt fehl, wenn die Regel nicht
mehr greift.

## Korrektur am Briefing

**Die Begründung für die LLM-Provider-Abstraktion im Briefing ist sachlich
falsch und wird hier richtiggestellt.** `CLAUDE.md` nennt als Grund, dass der
Gemini Free Tier Google die Nutzung der Prompts für Modelltraining erlaubt. Die
Nutzungsbedingungen der Gemini API sagen für unsere Rechtslage das Gegenteil:
Für Nutzer im EWR, der Schweiz und dem Vereinigten Königreich gelten die
Bedingungen der kostenpflichtigen Dienste für alle Dienste, ausdrücklich
einschließlich Google AI Studio und des unbezahlten Kontingents der API. Prompts
und Antworten werden dort also nicht zur Produktverbesserung verwendet.

Die Abstraktion bleibt, die Begründung wechselt: Anbieterunabhängigkeit, und die
Möglichkeit, für echte Kundendokumente auf einen Anbieter mit vertraglich
zugesichertem Auftragsverarbeitungsvertrag zu wechseln, den ein
AI-Studio-Schlüssel nicht mitbringt. Das Briefing bleibt unverändert im Repo,
weil es der Ausgangsstand ist; diese Datei hält fest, was die Prüfung an der
Dokumentation ergeben hat.

**Der Gemini-Schlüssel liegt in einem eigenen Google-Cloud-Projekt.** Verworfen:
den Schlüssel im Default-Projekt anlegen. Grund: isoliert widerrufbar, eigenes
Kontingent, keine Wechselwirkung mit anderen Projekten desselben Kontos.

## Phase 0, Nachtrag

**Migrationen im Build statt von Hand.** Verworfen: die Produktionsdatenbank aus
der Entwicklungsumgebung migrieren. Grund: Vercel gibt Produktions-Secrets nicht
an die CLI heraus, `vercel env pull` schreibt für sensible Werte Platzhalter.
Von Hand hätte bedeutet, eine Verbindungszeichenfolge außerhalb der Plattform
weiterzureichen. Im Build sind die Zugangsdaten ohnehin vorhanden.

**Advisory Lock um die Migration.** Verworfen: `drizzle-kit migrate` direkt im
Build-Skript aufrufen. Grund: nicht theoretisch, sondern beobachtet. Beim ersten
Produktions-Deploy liefen ein Git-Deploy und ein manuelles Deploy gleichzeitig,
beide migrierten dieselbe Datenbank, eines brach mitten in der Migration ab.
`scripts/migrate.ts` nimmt vorher `pg_advisory_lock`, der zweite Build wartet und
findet danach nichts mehr zu tun. Der Lock liegt in Postgres, braucht also keine
zusätzliche Infrastruktur, und wird beim Verbindungsabbruch von selbst
freigegeben.

## Phase 1, Konfigurationskontrolle

**Die Regeln der Formatvalidierung wurden gegen die echten Werte geprüft, nicht
aus dem Gedächtnis geschrieben.** Das war kein Formalismus: Der Gemini-Schlüssel
dieses Projekts beginnt mit `AQ.`, nicht mit `AIza`. Ein aus der Erinnerung
festgeschriebenes `^AIza` hätte einen intakten Schlüssel abgelehnt und den
Deploy mit einer Fehlermeldung gestoppt, die auf die falsche Ursache zeigt.
Geprüft wurden alle Regeln so, dass nur Treffer oder Nichttreffer ausgegeben
wurde, nie der Wert. Die Validierung akzeptiert daher beide Formate.

**Buildzeit-Prüfung statt Prüfung beim ersten Request.** Verworfen: sich auf die
Validierung in `lib/env.ts` verlassen. Grund: Die läuft nachweislich erst zur
Laufzeit. Nachdem der Datenbankzugriff in Phase 0 faul gemacht wurde, baut das
Projekt vollständig ohne gesetzte Umgebungsvariablen durch, verifiziert durch
einen Build mit beiseitegeschobener `.env.local`. Ein fehlender Wert wäre also
erst dem ersten Nutzer aufgefallen. `scripts/check-env.ts` läuft jetzt als
erster Schritt des Builds.

**Der Build probiert die Zugangsdaten zusätzlich live an.** Verworfen: nur die
Form prüfen. Grund: Ein Schlüssel kann formal einwandfrei und trotzdem
widerrufen, abgelaufen oder regional gesperrt sein. Der Build fragt deshalb die
Modell-API nach ihrer Modellliste und den Blob-Store nach einem einzigen
Eintrag. Beides kostet keine Tokens und kein Generierungskontingent, schlägt
aber genauso fehl wie ein echter Aufruf. Ein abgelehntes Zugangsdatum bricht den
Build ab, ein Netzwerkproblem beim Anbieter nicht, sonst wären Deploys aus
Gründen instabil, die nichts mit diesem Projekt zu tun haben.

**Blob-Fehler werden über die Fehlerklasse klassifiziert, nicht über den
Meldungstext.** Verworfen: Textvergleich auf der Fehlermeldung, die erste
Fassung. Grund: Sie hat im Test einen gefälschten Token als Netzwerkproblem
eingestuft und damit als nicht fatal durchgewinkt. Der SDK wirft typisierte
Fehler, ein erfundener Token ergibt `BlobStoreNotFoundError`. Über die Klasse
geprüft ist die Einordnung eindeutig.

**Der tiefe Healthcheck hängt an der Session, nicht an einem eigenen Token.**
Verworfen: ein aus `AUTH_SECRET` abgeleitetes HMAC-Token. Grund: Es hätte nichts
gebracht. Die CI kann das produktive `AUTH_SECRET` nicht besitzen, also hätte
auch ein abgeleitetes Token dort nicht berechnet werden können. Die Session
existiert ohnehin, kostet keine zusätzliche Umgebungsvariable und genau darum
ging es bei dieser Übung.

**Die CI prüft nur den flachen Endpunkt.** Verworfen: die CI mit
Produktionszugangsdaten ausstatten, damit sie auch die Anbieter prüfen kann.
Grund: Was still kaputtgeht, ist die Frage, ob der gepushte Commit live ist und
seine Datenbank erreicht. Genau das prüft die CI, ohne ein einziges Secret. Die
Gültigkeit der Anbieterschlüssel ist bereits im Build geprüft, also eine Stufe
früher.
