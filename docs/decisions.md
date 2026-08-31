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

## Phase 2, Quellen

**Client-Upload direkt zu Blob statt durch eine Route.** Verworfen: die Datei an
eine Route Handler schicken. Grund: Vercel begrenzt den Request-Body einer
Function auf 4,5 MB, das Limit für eine Quelle ist 10 MB. Der Umweg ist
sicherheitsseitig sogar der bessere: Die Ownership-Prüfung wandert in die
Token-Ausstellung, der Server entscheidet also vor dem ersten Byte, ob dieses
Konto in dieses Notebook schreiben darf, und der Token begrenzt zusätzlich
Dateityp und Größe. Verifiziert über eine Matrix: anonym, eigenes Notebook,
fremdes Notebook, nicht existierendes Notebook, ungültige Id. Nur der eigene
Fall bekommt einen Token.

**Blob-Store privat, Lesen serverseitig.** Verworfen: `access: "public"`, womit
die erste Fassung gebaut war. Grund: Der Store ist bewusst privat konfiguriert,
und der Fehler wäre erst in Produktion aufgefallen, weil lokal nie eine echte
Datei hochgeladen wurde. Ein öffentlicher Abruf der Blob-URL liefert jetzt 403,
die Ingestion liest die Bytes serverseitig über `get()` mit dem
Store-Zugangsdatum. Das ist die Grundlage für Sicherheitspunkt 3: ein
hochgeladenes Dokument ist ohne diese Anwendung nicht erreichbar.

**Die Ingestion nimmt eine Pfadangabe, keine URL vom Client.** Verworfen: die
vom Upload zurückgegebene URL entgegennehmen und abrufen. Grund: Eine URL aus
dem Request wäre eine Aufforderung, den Server auf beliebige Adressen zeigen zu
lassen. Der Pfad wird gegen die Datenbankzeile aufgelöst, die ohnehin nur über
die Zugriffsschicht erreichbar ist.

**Harte Obergrenzen statt Warteschlange.** Verworfen: ein Queue-System für
große Dateien. Grund: Das Briefing schließt es aus, und der synchrone Lauf muss
in eine Function-Invocation passen. 200.000 Zeichen und zwölf Quellen je
Notebook sind die Grenzen; darüber wird die Datei mit einer verständlichen
Meldung abgelehnt, statt auf halbem Weg zu scheitern.

**Zeichenpositionen als getestete Invariante.** Verworfen: darauf vertrauen,
dass die Offsets stimmen. Grund: Die Hervorhebung beim Zitatsprung zeigt
`text.slice(charStart, charEnd)`. Ein Off-by-one wäre im Video sichtbar. Der
Test prüft für jeden Chunk, dass der Ausschnitt exakt den Inhalt ergibt, dass
die Chunks das Dokument lückenlos abdecken und dass aufeinanderfolgende Chunks
sich überlappen.

**Operator-Präzedenz in der Ähnlichkeitsberechnung.** Kein Entwurf, ein Fehler:
`1 - ${distance}` erzeugt `1 - a <=> b`, und Postgres bindet `-` stärker als die
pgvector-Operatoren, parst also `(1 - a) <=> b` und bricht mit
`operator does not exist: integer - vector` ab. Aufgefallen beim ersten echten
Suchlauf, behoben durch Klammern. Notiert, weil es genau die Sorte Fehler ist,
die ein Typsystem nicht abfängt.

## Phase 3, Chat

**Ähnlichkeitsschwelle 0,65, gemessen statt geschätzt.** Verworfen: eine Zahl
aus dem Bauch. Grund: Top-k-Retrieval liefert immer etwas, ohne Untergrenze
würde das System jede Frage aus dem beantworten, was am wenigsten unpassend war.
Gemessen an vierzehn Fragen gegen die Seed-Dokumente: acht Fragen, die die
Quellen klar beantworten, liegen zwischen 0,728 und 0,774. Sechs Fragen, die
sie klar nicht beantworten, darunter zwei aus dem Themenfeld des jeweils anderen
Kontos, liegen zwischen 0,468 und 0,543. Die Lücke ist 0,185 breit. 0,65 liegt
darin, mit 0,107 Abstand über dem stärksten Falschtreffer und 0,078 unter dem
schwächsten echten Treffer. Die Asymmetrie ist Absicht: aus einem schwachen
Treffer zu antworten ist hier der teurere Fehler.

**Verweigerung als Eigenschaft, nicht als Fehlermeldung.** Verworfen: "keine
Treffer gefunden". Grund: Das liest sich wie ein Defekt der Suche. Der Satz
lautet stattdessen, dass die Frage mit den vorliegenden Quellen nicht
beantwortbar ist und das System nicht rät. Intern arbeitet das Modell mit einem
Marker statt mit dem Satz, damit die Verweigerung in den Evals maschinell
erkennbar ist und nicht zwischen Antworten in der Formulierung driftet. Der
Marker wird im Strom zurückgehalten und nie an den Client ausgeliefert.

**Zufallsnonce als Trennmarker statt eines festen Delimiters.** Verworfen:
`<source>` und Ähnliches. Grund: Ein fester Delimiter ist ein gemeinsames
Geheimnis, das in jedem öffentlichen Repository nachlesbar ist. Ein Dokument
kann ihn schließen und danach als vertrauenswürdiger Anweisungstext
weiterlaufen. Der Nonce hat 128 Bit und existierte nicht, als das Dokument
geschrieben wurde. Dazu drei weitere Maßnahmen: die Regel steht positiv und
negativ im System-Prompt, jede Aussage muss eine Quellennummer tragen, die eine
eingebettete Anweisung nicht liefern kann, und eine Kollision des Nonce mit dem
Quelltext wird vor dem Absenden geprüft.

**Bei fehlender Quellendeckung wird das Modell gar nicht erst aufgerufen.**
Verworfen: immer fragen und die Verweigerung dem Modell überlassen. Grund: Das
Ergebnis steht bereits fest, der Aufruf wäre verbrauchtes Kontingent für eine
Antwort, die der Code kennt. Nebeneffekt: die Verweigerung ist in diesem Fall
deterministisch.

**Der Build ruft die konfigurierten Modelle wirklich auf.** Kein Entwurf, eine
Konsequenz: `gemini-2.5-flash-lite` steht weiterhin in der Modellliste der API,
wird für neue Schlüssel aber mit "no longer available to new users" abgelehnt.
Aufgefallen ist das als leerer Antwortstrom, also genau als das stille
Kaputtgehen, gegen das die Buildprüfung existiert. Eine Listenabfrage hätte es
nicht gefunden. Die Prüfung macht jetzt je einen minimalen Chat- und
Embedding-Aufruf; verifiziert, indem das abgeschaltete Modell erneut eingetragen
und der Build damit zum Abbruch gebracht wurde.

**Die Hervorhebung markiert den abgerufenen Chunk, nicht den einzelnen Satz.**
Verworfen: die zitierte Aussage im Chunk zusätzlich zu lokalisieren. Grund:
Zeitbudget, und die gröbere Markierung ist die ehrlichere: hervorgehoben wird
exakt der Text, den das Modell gesehen hat, nicht eine nachträgliche Schätzung,
worauf es sich bezogen haben könnte.

## Phase 4, Härtung und Messung

**Rate Limiting als eine einzige SQL-Anweisung.** Verworfen: Zähler lesen,
prüfen, zurückschreiben. Grund: Zwei gleichzeitige Anfragen würden beide den
alten Wert sehen und beide durchgelassen, also genau der Fall, für den ein Limit
existiert. Der Upsert entscheidet und setzt das Fenster in derselben Anweisung
zurück, ohne Aufräumjob. Demo-Konten bekommen ein engeres Budget als reguläre
Konten, weil ihre Zugangsdaten absichtlich im README stehen.

**Zugriffstests mit festen Vektoren statt echter Embeddings.** Verworfen: die
Testfragen gegen die Modell-API einbetten. Grund: zwei Vorteile auf einmal. Die
Suite braucht keinen API-Schlüssel in der CI, und die zentrale Behauptung wird
schärfer statt schwächer: Konto B bekommt nicht einen semantisch ähnlichen
Vektor, sondern exakt denjenigen, mit dem der Chunk von Konto A gespeichert
wurde. Das ist die stärkste Anfrage, die ein Angreifer stellen könnte, und sie
liefert null Treffer.

**Signierte URLs mit geprüftem Ablauf.** Verworfen: die Gültigkeit nur zu
konfigurieren. Grund: Eine signierte URL ohne geprüften Ablauf ist nur eine
längere URL. Der Test stellt eine URL mit zwei Sekunden Laufzeit aus, ruft sie
erfolgreich ab, wartet sie ab und prüft, dass der Store sie danach ablehnt. Er
läuft gegen den echten Store, weil den Ablauf der Store durchsetzt und nicht
dieser Code; lokal ausgeführt, in der CI mit lauter Meldung übersprungen, weil
die Workflow-Umgebung bewusst keine Produktions-Secrets hält.

**Der Nonce wird auf Unerratbarkeit getestet, nicht nur auf Unbekanntheit.**
Ergänzung auf Zuruf: Die Tests prüfen, dass 500 Aufrufe 500 verschiedene Nonces
liefern, dass alle 16 Hexziffern vorkommen (ein Generator, der auf einem
konstanten Wert klemmt, fällt hier auf statt still durchzulaufen), dass ein aus
einer früheren Anfrage abgegriffener Marker den nächsten Zaun nicht schließt,
und dass ein Dokument voller Kandidatenmarker den echten nicht trifft.

**Der Build prüft das Client-Bundle auf Secrets.** Verworfen: sich darauf
verlassen, dass kein Client-Komponentenpfad die Anbietermodule importiert. Grund:
Das stimmt derzeit durch Konstruktion, und genau solche Eigenschaften hören
während eines Refactorings auf zu stimmen, ohne dass es jemand merkt. Geprüft
werden die literalen Werte der bekannten Secrets und zusätzlich Muster für
Zugangsdaten, deren Wert lokal nicht vorliegt. Verifiziert, indem ein
Blob-Token-artiger String ins Bundle geschrieben und der Check damit zum
Fehlschlag gebracht wurde.

**Das Eval-Skript teilt sich Retrieval und Schwelle mit dem Chat-Endpunkt.**
Verworfen: die Pipeline im Eval nachbauen. Grund: Ein Eval, das eine Kopie
ausführt, misst die Kopie.

**Der Eval-Lauf ist getaktet.** Kein Entwurf, ein Fund: Ein ungetakteter zweiter
Lauf lieferte drei leere Antworten, die zunächst wie ein Prompt-Problem
aussahen. Es war das Anfragelimit des Free Tiers. Das Skript macht
Anbieterfehler und leere Antworten jetzt als solche sichtbar, statt sie als
inhaltliches Versagen zu zählen, und wartet zwischen den Fällen.

## Phase 5, Abschluss

**Der dritte Nutzer aus dem GitHub-Test bleibt in der Produktionsdatenbank.**
Verworfen: ihn vor der Abgabe entfernen. Grund: Er belegt, dass der OAuth-Weg
produktiv durchläuft und nicht nur konfiguriert ist. Ein Konto mit einer
E-Mail-Adresse und ohne Notebooks ist ein vertretbarer Preis dafür, im README
benannt.

**Der Secret-Scan filtert die lokale Container-Kennung heraus.** Verworfen: jede
Fundstelle melden. Grund: Der erste Lauf meldete drei Treffer, alle
`postgres:postgres@localhost` aus `.env.example` und der CI-Konfiguration, also
absichtlich eingecheckte Wegwerf-Zugangsdaten für eine flüchtige Datenbank ohne
Inhalt. Ein Scanner, dessen Rauschen einen echten Fund verdeckt, ist wertlos.
Alles andere, was wie eine Verbindungszeichenfolge aussieht, meldet weiterhin.
Im selben Zug prüft der Scan jetzt auch die Werte aus `.env.production.local`,
die im ersten Lauf gar nicht betrachtet wurden, obwohl sie die einzigen sind,
die wirklich zählen.

**Der eine fehlgeschlagene Eval-Fall bleibt stehen.** Verworfen: den Prompt
weiter umschreiben oder die Prüfung aufweichen. Grund: Das Modell antwortet bei
einer Frage inhaltlich richtig, lässt aber die Quellennummer weg. Eine
Verschärfung der Regel im System-Prompt hat es nicht behoben. Eine bessere Zahl
durch eine schwächere Prüfung wäre das schlechtere Ergebnis, und der Fall ist
der Beleg dafür, dass das Golden Set tatsächlich etwas misst.

## Offene Punkte, Stand Abschluss

Abgearbeitet:

- Dritter Nutzer aus dem GitHub-Test: bleibt, im README benannt.
- Verwaiste Blobs beim Notebook-Löschen: im README unter "Bewusst nicht
  umgesetzt" benannt, kein Aufräumlauf gebaut.
- Secret-Scan über die gesamte Historie: `npm run scan:secrets`, läuft gegen
  Musterliste und gegen die literalen Werte aus beiden Env-Dateien.
- Eval-Ergebnistabelle im README.

Offen bis unmittelbar vor der Abgabe:

- Die Session-Transkripte unter `docs/ai-sessions/` fehlen noch. Nach dem Export
  muss der Secret-Scan erneut laufen, weil Transkripte Werkzeugausgaben
  enthalten, die nie zeilenweise gelesen wurden. Bekannt ist bereits ein Fall:
  in einem Testlauf wurde ein lokales Session-JWT ausgegeben. Es gilt nur für
  `localhost` und ist mit dem lokalen `AUTH_SECRET` signiert, also gegen
  Produktion wertlos, gehört aber trotzdem aus dem Export entfernt.
- Das Repository ist bis dahin privat.
