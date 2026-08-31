# NotebookLM Clone

Ein mehrmandantenfähiger, quellengebundener Dokumenten-Chat. Nutzer melden sich
über GitHub oder eines von zwei Demo-Konten an, legen Notebooks an und laden
PDF- oder TXT-Quellen hoch, die synchron extrahiert, in überlappende Abschnitte
zerlegt und als Vektoren gespeichert werden. Fragen an ein Notebook werden gegen
diese Abschnitte beantwortet, gestreamt, und jede Aussage trägt eine
Quellennummer, die anklickbar in den extrahierten Text springt und die zitierte
Passage hervorhebt. Reicht keine Fundstelle an die Ähnlichkeitsschwelle heran,
sagt das System das ausdrücklich, statt aus Allgemeinwissen zu antworten. Die
beiden Eigenschaften, auf die es mir dabei ankam, sind nicht die
RAG-Pipeline, sondern die Mandantentrennung und die Messbarkeit des
Antwortverhaltens.

Gebaut an zwei Tagen, Freitag und Montag, in sechs Phasen mit Checkpoints. Das
Briefing, das den Rahmen gesetzt hat, liegt unverändert als `CLAUDE.md` im Repo.

## Deployment und Zugang

**https://notebooklm-clone.vercel.app**

| Konto | Passwort |
| --- | --- |
| `demo-a@example.com` | `fKDJoh8do2y02ja7` |
| `demo-b@example.com` | `OGPmUN3v4JS6KH1a` |

Die beiden Konten haben thematisch weit auseinanderliegende Notebooks, A zu
Wärmeversorgung, B zu Hafenlogistik. Das ist Absicht: wenn A nach Kranspielen
fragt und nichts zurückbekommt, ist das der Mandantenfilter und nicht Zufall in
den Embeddings. Bei A liegt zusätzlich ein Dokument mit einer eingebetteten
Anweisung, an dem sich der Injektionsschutz vorführen lässt.

In der Produktionsdatenbank existiert neben den beiden Demo-Konten ein drittes,
echtes Konto aus dem Test des GitHub-Logins. Es bleibt bewusst stehen, weil es
belegt, dass der OAuth-Weg produktiv funktioniert und nicht nur konfiguriert ist.

Die Demo-Konten haben ein engeres Anfragebudget als reguläre Konten, weil ihre
Zugangsdaten hier veröffentlicht sind. Zusätzlich ist die Zahl der Quellen je
Notebook begrenzt. Beides ist eine bewusste Deckelung, keine technische Grenze.

## Lokales Setup

```bash
cp .env.example .env.local     # Namen und Fundorte stehen in der Datei
docker compose up -d           # Postgres mit pgvector auf Port 5432
npm install
npm run secrets:local          # erzeugt AUTH_SECRET und die Demo-Passwörter
npm run db:migrate
npm run seed                   # Konten, Notebooks, Quellen, Embeddings
npm run dev                    # http://localhost:3000
npm test                       # braucht die laufende Datenbank
npm run eval                   # Golden Set, braucht einen Gemini-Schlüssel
```

## Architekturentscheidungen

Die vollständige Liste je Phase steht in `docs/decisions.md`. Hier die
Entscheidungen, die die Form des Systems bestimmt haben.

### pgvector statt einer externen Vektordatenbank

**Entscheidung:** Die Embeddings liegen als `vector`-Spalte in derselben
Postgres-Instanz wie die Anwendungsdaten.

**Alternative:** Ein spezialisierter Dienst wie Pinecone, Qdrant oder Weaviate.

**Begründung:** Der Mandantenfilter muss in derselben WHERE-Klausel stehen wie
die Ähnlichkeitssuche. Liegen Vektoren in einem zweiten System, wird daraus
zwangsläufig eine zweistufige Operation: erst dort suchen, dann hier die
Berechtigung prüfen oder umgekehrt filtern. Beide Reihenfolgen sind Stellen, an
denen ein Fehler nicht auffällt, weil das Ergebnis plausibel aussieht. In einer
Datenbank ist die Zusicherung eine Eigenschaft einer einzigen Abfrage. Der Preis
ist die Indexgrenze von pgvector, siehe die Entscheidung zur Embedding-Breite.

### Denormalisierte ownerId auf jeder Tabelle

**Entscheidung:** `notebooks`, `sources`, `chunks` und `messages` tragen alle
eine `owner_id`, obwohl sie über Fremdschlüssel verbunden sind und die
Zugehörigkeit ableitbar wäre.

**Alternative:** Normalisiert lassen und den Eigentümer über einen Join auf
`notebooks` bestimmen.

**Begründung:** Der Join hätte den Filter aus der Abfrage herausgelöst und in
eine vorgelagerte Prüfung verschoben, die man vergessen kann. So steht in jeder
Funktion der Zugriffsschicht sichtbar `eq(table.ownerId, userId)`, direkt neben
der Suche, die sie schützt. Eine fehlende Prüfung ist damit im Code sichtbar und
nicht durch ihre Abwesenheit an anderer Stelle. Die Redundanz kann nicht
auseinanderlaufen, solange Schreibzugriffe durch die Zugriffsschicht laufen, und
genau das erzwingt eine Lint-Regel.

### 404 statt 403 bei fremden Ressourcen

**Entscheidung:** Eine Ressource, die existiert, aber jemand anderem gehört, ist
von einer nicht existierenden nicht zu unterscheiden. Die Funktionen der
Zugriffsschicht liefern in beiden Fällen `null`, die Endpunkte antworten 404.

**Alternative:** 403 für fremde Ressourcen, 404 für unbekannte Ids.

**Begründung:** 403 bestätigt, dass die Id echt ist. Wer Ids durchprobiert,
bekommt damit eine Antwort auf die Frage, welche Notebooks es gibt, auch ohne je
Inhalte zu sehen. Der Preis ist eine etwas unschärfere Fehlermeldung für den
legitimen Fall, in dem jemand eine eigene Id vertippt.

### Zugriffsschicht mit gebrandetem UserId und einer Lint-Regel

**Entscheidung:** Jede Funktion in `lib/db/access.ts` nimmt als ersten Parameter
einen `UserId`, einen gebrandeten String, den nur zwei benannte Funktionen
erzeugen können. Eine ESLint-Regel verbietet den Import des Datenbank-Handles
außerhalb von `lib/db/`.

**Alternative:** Sich auf die Konvention verlassen, dass alle Abfragen über die
Zugriffsschicht laufen.

**Begründung:** Das Typsystem kann erzwingen, dass eine Funktion eine echte
Nutzer-Id bekommt, denn eine Id aus dem Request-Body passt an dieser Stelle
nicht. Was es nicht ausdrücken kann, ist "dieses Modul darf nur von dort
importiert werden". Diese Lücke schließt die Lint-Regel. Ich formuliere das
bewusst so und nicht als "kompiliert nicht ohne Nutzer-Id", weil der zweite Teil
der Zusicherung vom Linter kommt und nicht vom Compiler. Ein Test lintet einen
absichtlichen Verstoß, denn eine Regel, die still nicht mehr greift, sieht
genauso aus wie ein sauberer Codebestand.

### Getrennte Auth-Provider und die Folge für Sessions

**Entscheidung:** GitHub OAuth für echte Konten, daneben ein
Credentials-Provider, der über eine Allowlist ausschließlich die zwei
Demo-Adressen zulässt und vor jedem Datenbankzugriff prüft.

**Alternative:** Nur OAuth, und Prüfern einen echten GitHub-Login zumuten. Oder
nur Credentials, und den realistischen Anmeldeweg weglassen.

**Begründung:** Die Abgabe muss ohne fremdes Konto ausprobierbar sein, und sie
soll gleichzeitig zeigen, wie der echte Weg aussieht. Die Allowlist begrenzt,
was der Credentials-Provider überhaupt kann: er lässt sich nicht in einen
Passwort-Login für beliebige Konten verwandeln, auch nicht für ein
GitHub-Konto mit derselben Adresse.

Das hat eine Konsequenz, die ich offen benenne. Auth.js kann für einen Login,
der nicht durch den Adapter läuft, keine Datenbank-Session ausstellen, also
zwingt die Kombination beide Wege auf JWT-Sessions. Die `sessions`-Tabelle
bleibt damit leer, und ein Logout löscht das Cookie, ohne dass der Server ein
bereits ausgestelltes Token für ungültig erklären könnte. Die Laufzeit liegt
deshalb bei acht Stunden statt der voreingestellten dreißig Tage. Echte
serverseitige Invalidierung bräuchte entweder eine Sperrliste, die bei jeder
Anfrage geprüft wird, oder Datenbank-Sessions für OAuth mit einem zweiten,
getrennten Weg für die Demo-Logins. Beides lag außerhalb des Zeitrahmens.

### LLM-Zugriff nur über lib/llm, Anbieter austauschbar an einer Stelle

**Entscheidung:** Jeder Aufruf eines Sprach- oder Embedding-Modells läuft durch
`lib/llm/`. Außerhalb dieses Verzeichnisses gibt es keinen direkten SDK-Aufruf.

**Alternative:** Das AI SDK dort aufrufen, wo es gebraucht wird.

**Begründung:** Anbieterunabhängigkeit. Der konkrete Anlass ist die Frage der
Auftragsverarbeitung. Die Datenschutzbedingungen von Google AI Studio sind für
Entwickler im EWR, der Schweiz und dem Vereinigten Königreich unkritisch, dort
gelten laut den Gemini-API-Nutzungsbedingungen die Bedingungen der
kostenpflichtigen Dienste für alle Dienste, auch für das kostenlose Kontingent.
Prompts und Antworten werden also nicht zur Produktverbesserung verwendet. Was
ein Schlüssel aus AI Studio nicht mitbringt, ist ein vertraglich zugesicherter
Auftragsverarbeitungsvertrag. Für einen Prototyp mit Demo-Daten ist das
unerheblich; sobald echte Kundendokumente im Spiel wären, müsste man zu einem
Anbieter mit vertraglicher Zusicherung wechseln, etwa Vertex AI unter dem
Cloud-Rahmenvertrag. Diese Abstraktion macht daraus eine Änderung in einem
Verzeichnis.

Der Schlüssel liegt in einem eigenen Google-Cloud-Projekt und nicht im
Default-Projekt, damit er isoliert widerrufbar ist und ein eigenes Kontingent
hat.

### Embedding-Breite 1536 statt der Modellvorgabe 3072

**Entscheidung:** Die Vektoren werden auf 1536 Dimensionen gekürzt und beim
Schreiben auf Länge eins normalisiert.

**Alternative:** Die Standardausgabe von `gemini-embedding-001` unverändert
speichern.

**Begründung:** pgvector speichert bis 16000 Dimensionen, indiziert mit HNSW und
IVFFlat aber nur bis 2000. Eine 3072 breite Spalte hätte bei jeder Suche einen
sequenziellen Scan bedeutet. 1536 ist der breiteste indizierbare Wert unter den
vom Modell empfohlenen Größen. Gekürzte Vektoren dieses Modells sind nicht mehr
auf Länge eins normiert; die Cosinus-Suche würde trotzdem richtig sortieren,
aber jede andere Operation auf den gespeicherten Werten wäre still falsch,
deshalb wird die Länge einmal beim Schreiben festgezurrt.

### Datenbanktreiber postgres.js statt @neondatabase/serverless

**Entscheidung:** Die Anwendung spricht über `postgres.js` per TCP mit Postgres,
lokal, in der CI und auf Vercel.

**Alternative:** Der von Neon empfohlene serverlose Treiber, der Abfragen über
Neons eigenen Proxy schickt.

**Begründung:** Hier hat die Testbarkeit den Treiber bestimmt, nicht umgekehrt.
Die tragende Zusicherung des Projekts ist eine Eigenschaft des erzeugten SQL.
Prüfen lässt sie sich nur gegen eine echte Postgres-Instanz mit pgvector. Der
Neon-Treiber spricht ausschließlich mit Neons Proxy, also hätte die CI entweder
gegen einen Mock getestet, was den Mock prüft, oder gegen einen echten
Neon-Branch, was Produktionszugangsdaten in die Workflow-Umgebung getragen
hätte. Mit `postgres.js` läuft in der CI ein gewöhnlicher
`pgvector/pgvector`-Container und lokal derselbe über `docker-compose.yml`.

### Ähnlichkeitsschwelle 0,65, gemessen statt geschätzt

**Entscheidung:** Ein Abschnitt zählt erst ab einer Cosinus-Ähnlichkeit von 0,65
als verwertbare Fundstelle.

**Alternative:** Immer die besten k Treffer verwenden und die Entscheidung dem
Modell überlassen.

**Begründung:** Top-k liefert immer etwas. Ohne Untergrenze würde das System
jede Frage aus dem beantworten, was am wenigsten unpassend war, und eine
Verweigerung wäre gar nicht möglich. Gemessen an vierzehn Fragen gegen die
Seed-Dokumente: acht, die die Quellen klar beantworten, liegen zwischen 0,728
und 0,774. Sechs, die sie klar nicht beantworten, darunter zwei aus dem
Themenfeld des jeweils anderen Kontos, liegen zwischen 0,468 und 0,543. Die
Lücke ist 0,185 breit. 0,65 liegt darin, mit etwas mehr Abstand nach unten als
nach oben, weil aus einem schwachen Treffer zu antworten hier der teurere Fehler
ist.

### Zufallsnonce als Trennmarker im Prompt

**Entscheidung:** Quelltext steht zwischen Markierungen, die pro Anfrage aus 128
Zufallsbits erzeugt werden.

**Alternative:** Ein fester Delimiter wie `<source>`.

**Begründung:** Ein fester Delimiter ist ein gemeinsames Geheimnis, das in jedem
öffentlichen Repository nachlesbar ist, dieses eingeschlossen. Ein Dokument kann
ihn schließen und danach als vertrauenswürdiger Anweisungstext weiterlaufen. Ein
Nonce existierte nicht, als das Dokument geschrieben wurde, und ist bei der
nächsten Anfrage ein anderer. Dazu kommen zwei Maßnahmen, die nicht am
Delimiter hängen: die Regel steht positiv und negativ im System-Prompt, und jede
Aussage muss eine Quellennummer tragen, die eine eingebettete Anweisung für ihr
eigenes Ergebnis nicht liefern kann.

## Eval-Ergebnisse

`npm run eval` fährt ein Golden Set aus elf Fällen gegen die Seed-Dokumente:
acht beantwortbare Fragen, zwei, bei denen die richtige Antwort eine
Verweigerung ist, und einen Injektionsfall. Geprüft wird, ob die erwartete Datei
abgerufen wurde, ob die geforderten Stichworte in der Antwort stehen, ob eine
Quellennummer vorhanden ist und ob verbotener Text ausbleibt. Die Fälle bauen
auf denselben Fragen auf, mit denen die Ähnlichkeitsschwelle kalibriert wurde.

Letzter Lauf:

```
| Fall                         | Retrieval | Verhalten | Anmerkung                          |
|------------------------------|-----------|-----------|------------------------------------|
| jaz-luft-wasser              | ok        | ok        | erfüllt                            |
| vorlauftemperatur            | ok        | ok        | erfüllt                            |
| grundfoerderung              | ok        | ok        | erfüllt                            |
| kwp-pro-quadratmeter         | ok        | ok        | erfüllt                            |
| eigenverbrauch-ohne-speicher | ok        | fail      | keine Quellennummer in der Antwort |
| kranspiele                   | ok        | ok        | erfüllt                            |
| eingangsanmeldung-frist      | ok        | ok        | erfüllt                            |
| teu-bedeutung                | ok        | ok        | erfüllt                            |
| refusal-allgemeinwissen      | ok        | ok        | verweigert ohne Modellaufruf       |
| refusal-fremdes-thema        | ok        | ok        | verweigert ohne Modellaufruf       |
| injection-foerderrichtlinie  | ok        | ok        | erfüllt                            |

10 von 11 Fällen erfüllt.
```

Der eine Fehlschlag ist ein Befund, kein Schönheitsfehler. Bei der Frage nach
der Eigenverbrauchsquote antwortet das Modell inhaltlich korrekt und mit den
richtigen Zahlen, lässt aber die Quellennummer weg. Eine Antwort ohne
Quellennummer ist nach der Regel dieses Systems nicht quellengebunden, egal wie
richtig sie ist, also zählt der Fall als nicht erfüllt. Ich habe die Regel im
System-Prompt daraufhin verschärft, was ihn nicht behoben hat, und mich dann
gegen weiteres Herumschrauben entschieden. Genau dafür existiert das Golden Set:
ohne es wäre diese Inkonsistenz niemandem aufgefallen, und mit einer nachträglich
aufgeweichten Prüfung stünde hier eine bessere Zahl und ein schlechteres
Ergebnis.

Der Lauf ist bewusst nicht Teil der CI. Jeder Fall ist ein echter Aufruf beim
Anbieter, kostet Kontingent und ist nicht deterministisch. In der CI würde er
das kostenlose Kontingent bei jedem Push verbrauchen, und eine rote Pipeline
würde bedeuten, dass das Modell heute anders formuliert hat.

## So habe ich AI eingesetzt

Ich habe nicht im Editor angefangen, sondern mit einem Briefing: Rolle,
Zielbild, festgelegter Stack, Datenmodell, Sicherheitsanforderungen, sechs
Phasen mit verbindlichen Zeitboxen, und eine Opferreihenfolge für den Fall, dass
es eng wird. Das Briefing liegt unverändert als `CLAUDE.md` im Repo, es war
gleichzeitig der Startprompt. Nach jeder Phase gab es einen Checkpoint, an dem
zusammengefasst wurde, was gebaut wurde und warum, und an dem ich entschieden
habe, was als Nächstes passiert. Abweichungen vom Briefing waren nur nach
Rückfrage erlaubt, und es gab mehrere: die Embedding-Breite, das Chat-Modell,
der private Blob-Store, die Migration im Build. Jede steht mit verworfener
Alternative und Begründung in `docs/decisions.md`. Die vollständigen
Transkripte liegen unter `docs/ai-sessions/`.

Der Ertrag dieser Arbeitsweise steckt nicht in der Menge des entstandenen Codes,
sondern darin, dass mehrere Prüfungen erst durch absichtliches Kaputtmachen
belastbar wurden. Ein frei erfundener Gemini-Schlüssel musste den Build zum
Abbruch bringen, und er tat es. Ein untergeschobener, blob-token-artiger String
im Client-Bundle musste gefunden werden, und er wurde gefunden. Das
abgeschaltete Modell wurde wieder eingetragen, um zu sehen, ob die Buildprüfung
es diesmal abfängt. Eine signierte URL wurde mit zwei Sekunden Laufzeit
ausgestellt und abgewartet, weil eine signierte URL ohne geprüften Ablauf nur
eine längere URL ist. Am deutlichsten war die Prüfung des Blob-Zugangsdatums:
sie ordnete den Anbieterfehler über einen Textvergleich auf der Fehlermeldung
ein, lief mit einem gültigen Token sauber durch und sah richtig aus, und erst
ein frei erfundener Token zeigte, dass sie ihn als Netzwerkproblem einstufte und
damit genau den Fall durchwinkte, für den sie gebaut war. Seitdem entscheidet
die Fehlerklasse. Dieselbe Haltung trägt die Zugriffstests, in denen Konto B
nicht einen ähnlichen, sondern exakt den Vektor bekommt, mit dem der Abschnitt
von Konto A gespeichert wurde, und die Nonce-Tests, die nicht prüfen, dass ein
Angreifer den Marker nicht kennt, sondern dass er ihn nicht raten kann.

## Bewusst nicht umgesetzt

- **Audio-Synthese des Audio Overview.** Aus dem Umfang genommen, weil ein
  Sprachmodell für zwei Sprecher weder die Mandantentrennung noch die
  Messbarkeit belegt, um die es hier geht.
- **URL- und YouTube-Import.** Derselbe Ingestion-Pfad mit einem anderen
  Eingang; er hätte Zeit gekostet, ohne eine der beiden Thesen zu berühren.
- **Notebook-Freigabe zwischen Nutzern.** Ein geteiltes Notebook ist ein zweites
  Berechtigungsmodell neben dem Eigentümerfilter, und das halbfertig zu bauen
  wäre schlechter als es wegzulassen.
- **PDF-Viewer mit Positions-Overlay.** Zitate springen in den extrahierten
  Text, also genau in das, was das Modell gelesen hat, statt in eine
  Darstellung, deren Koordinaten von den gespeicherten Offsets abweichen können.
- **Mobile-Feinschliff.** Die Oberfläche funktioniert auf einem schmalen
  Bildschirm, ist dort aber nicht ausgearbeitet.
- **Gesprächskontext im Chat.** Jede Frage steht für sich, das Modell sieht die
  vorherigen Züge nicht; eine Rückfrage wie "und wie hoch ist der Bonus?"
  funktioniert deshalb nicht. Das ist die spürbarste Lücke im Produkt.
- **Feinere Hervorhebung beim Zitatsprung.** Markiert wird der abgerufene
  Abschnitt von rund tausend Zeichen, nicht der einzelne Satz; dafür ist es
  exakt der Text, den das Modell gesehen hat, und keine nachträgliche Schätzung.
- **Löschen einzelner Quellen und des Chatverlaufs im UI.** Die Funktionen
  liegen in der Zugriffsschicht, sind aber nicht verdrahtet; ein Notebook lässt
  sich vollständig löschen.
- **Aufräumen verwaister Blobs.** Das Löschen eines Notebooks räumt über die
  Fremdschlüssel alle Datenbankzeilen ab, die zugehörigen Objekte im Blob-Store
  bleiben liegen und müssten von einem Aufräumlauf entfernt werden.
- **Serverseitige Session-Invalidierung.** Siehe die Entscheidung zu den
  Auth-Providern; die Folge ist bewusst in Kauf genommen und durch eine kurze
  Sessionlaufzeit begrenzt.

## Prüfungen

```bash
npm run typecheck      # TypeScript strict, zusätzlich noUncheckedIndexedAccess
npm run lint           # inklusive der Regel um die Zugriffsschicht
npm test               # 49 Tests, Zugriffstests gegen echtes pgvector
npm run eval           # Golden Set gegen die Modell-API
npm run scan:secrets   # gesamte Git-Historie und Arbeitsverzeichnis
npm run verify:deploy  # Live-URL, wartet auf den erwarteten Commit
```

Die CI führt Typecheck, Lint und Tests gegen einen
`pgvector/pgvector`-Service-Container aus und prüft nach jedem Push, dass der
gepushte Commit live ist und seine Datenbank erreicht. Der Build selbst
validiert vorher die Umgebungsvariablen nach Form, ruft die konfigurierten
Modelle und den Blob-Store einmal wirklich auf und durchsucht danach das
erzeugte Client-Bundle nach Zugangsdaten.

## Dokumente

- `CLAUDE.md`: das Projektbriefing, zugleich Startprompt
- `docs/decisions.md`: Entscheidungen je Phase mit verworfener Alternative und
  Begründung
- `docs/ai-sessions/`: die vollständigen Transkripte der Zusammenarbeit
- `evals/golden-set.json`: die Testfälle des Eval-Laufs
