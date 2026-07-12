# Use Cases: Finanz-, Cashflow- und XS2A-Erweiterung

> Basierend auf der Architekturanalyse und Roadmap in [`system.md`](./system.md). Jeder Use Case ist einer Roadmap-Phase zugeordnet und referenziert konkrete Komponenten/Dateien des bestehenden MicroRealEstate-Codebase.

---

## UC1 – Bankkonto per XS2A verbinden

**Roadmap-Phase:** Phase 2 (XS2A/Open-Banking-Anbindung)

**Akteur:** Vermieter (Rolle `administrator`/`renter` innerhalb eines `Realm`)

**Ziel:** Der Vermieter verbindet ein reales Bankkonto mit MicroRealEstate, sodass Kontoumsätze künftig automatisch importiert werden, statt Zahlungen manuell zu erfassen.

**Vorbedingungen:**
- Vermieter ist eingeloggt und hat eine Organisation (`Realm`) mit passender Rolle.
- Der neue `banking`-Service (Phase 0) ist an einen lizenzierten XS2A-Aggregator (z. B. finAPI/Tink/GoCardless) angebunden.

**Hauptablauf:**
1. Vermieter öffnet im Landlord-Frontend den neuen Bereich „Bankkonten" (analog zu bestehenden Organisationseinstellungen in `webapps/landlord/src/components/organization/`).
2. Vermieter wählt „Konto verbinden" und sucht seine Bank (Name/BLZ).
3. Das System leitet an den XS2A-Aggregator weiter; der Vermieter authentifiziert sich dort mit seinen Online-Banking-Zugangsdaten und bestätigt per SCA/TAN-Verfahren.
4. Nach erfolgreicher Autorisierung liefert der Aggregator eine Kontenliste zurück; der Vermieter wählt die relevanten Konten aus.
5. Der Vermieter ordnet jedes Konto optional einer oder mehreren Properties/dem gesamten Realm zu.
6. Das System legt für jedes gewählte Konto einen `bankaccount`-Datensatz an (verschlüsselte Ablage des Zugriffstokens via `CIPHER_KEY`/`CIPHER_IV_KEY`), inkl. Consent-Ablaufdatum (typischerweise 90 Tage).
7. Ein initialer Sync-Job importiert die letzten Transaktionen in die `transaction`-Collection.
8. Vermieter erhält eine Bestätigung; das Konto erscheint als „verbunden" im Bankkonten-Bereich.

**Alternativ-/Fehlerfälle:**
- Bank wird vom Aggregator nicht unterstützt → Hinweis, alternativ manuelles Konto mit CSV-Import (Phase 1) anzulegen.
- SCA/TAN schlägt fehl oder wird abgebrochen → keine Verbindung, keine Daten gespeichert, verständliche Fehlermeldung.
- Consent läuft nach 90 Tagen ab → System erkennt den Status beim nächsten Sync-Versuch, Konto wird als „Re-Autorisierung erforderlich" markiert (siehe UC-Folgeaktion in Phase 2: Erinnerungsmail via `emailer`-Service).

**Ergebnis/Nachbedingung:** Ein oder mehrere Bankkonten sind aktiv mit dem Realm verbunden; ab sofort werden Umsätze automatisch synchronisiert, ohne dass der Vermieter sie manuell eintragen muss.

**Betroffene Komponenten:** neuer `services/banking`, neue Collections `bankaccount`/`transaction` (`services/common/src/collections/`), Gateway-Routing-Erweiterung (`services/gateway/src/index.ts`), neue Frontend-Sektion in `webapps/landlord/src/components/organization/`, Verschlüsselungsinfrastruktur aus `pdfgenerator`/`emailer` (`CIPHER_KEY`/`CIPHER_IV_KEY`).

---

## UC2 – Automatischer Abgleich einer eingehenden Mietzahlung

**Roadmap-Phase:** Phase 3 (Automatischer Zahlungsabgleich)

**Akteur:** Vermieter; System agiert im Hintergrund als Matching-Engine.

**Ziel:** Eine über XS2A importierte Kontobewegung wird automatisch der passenden offenen Mietforderung eines Mieters zugeordnet, ohne dass der Vermieter die Zahlung manuell im „Neue Zahlung"-Dialog erfassen muss.

**Vorbedingungen:**
- Mindestens ein Bankkonto ist verbunden (siehe UC1) und synchronisiert laufend Transaktionen.
- Für den betroffenen Mieter existiert eine offene Mietforderung für die aktuelle Periode (`Tenant.rents`, Status `notpaid`/`partiallypaid`).

**Hauptablauf:**
1. Der geplante Sync-Job im `banking`-Service importiert eine neue Transaktion: Betrag 950,00 €, Verwendungszweck „Miete Juli Musterstraße 12 App. 3B".
2. Die Matching-Engine (neu, Phase 3) vergleicht Betrag, Verwendungszweck-Text und ggf. Zahler-IBAN gegen offene Sollstellungen aller Mieter des Realms.
3. Es wird eine eindeutige Übereinstimmung mit dem Mieter „Musterstraße 12 App. 3B", Periode Juli, offener Betrag 950,00 € gefunden.
4. Das System erzeugt einen Buchungsvorschlag und zeigt ihn im neuen „Buchungsvorschläge"-Bereich (Accounting-Inbox) im Landlord-Frontend an.
5. Vermieter prüft den Vorschlag und bestätigt ihn mit einem Klick.
6. Nach Bestätigung ruft das System intern denselben Mechanismus wie die bisherige manuelle Zahlungserfassung auf (`rentmanager.js` / `PATCH /api/v2/rents/payment/:id/:term`), sodass `settlements.payments` befüllt wird.
7. Der Zahlungsstatus des Mieters wird wie gehabt dynamisch neu berechnet (`frontdata.js`) und springt auf `paid`.

**Alternativ-/Fehlerfälle:**
- **Teilzahlung**: Betrag ist niedriger als die Forderung → Vorschlag mit Status „Teilzahlung", Forderung bleibt anteilig offen.
- **Überzahlung**: Betrag übersteigt die Forderung → Vorschlag inkl. Hinweis auf Guthaben, das mit der nächsten Periode verrechnet werden kann.
- **Keine eindeutige Zuordnung** (z. B. Verwendungszweck fehlt oder mehrdeutig) → Transaktion bleibt im Status „nicht zugeordnet" und wird dem Vermieter zur manuellen Zuordnung vorgelegt statt automatisch gebucht.
- **Mehrfachtreffer** (z. B. zwei Mieter mit identischem Betrag) → System schlägt beide Kandidaten vor, Vermieter entscheidet.

**Ergebnis/Nachbedingung:** Die Mietzahlung ist ohne manuelle Dateneingabe im System erfasst, der Zahlungsstatus ist aktuell, die zugrunde liegende Banktransaktion ist mit dem Buchungsdatensatz verknüpft (Nachvollziehbarkeit für spätere Reports/DATEV-Export).

**Betroffene Komponenten:** neue Matching-Engine im `banking`-Service, neue Review-UI im Landlord-Frontend, bestehende Zahlungslogik (`services/api/src/managers/rentmanager.js`, `services/api/src/businesslogic/tasks/6_payments.js`), bestehende Statusberechnung (`services/api/src/managers/frontdata.js`).

---

## UC3 – Cashflow-Dashboard je Objekt und Portfolio einsehen

**Roadmap-Phase:** Phase 1 (manuelle Grundlage) / Phase 4 (voller Ausbau mit automatisierten Daten)

**Akteur:** Vermieter bzw. professioneller Hausverwalter mit mehreren Objekten.

**Ziel:** Der Vermieter verschafft sich einen schnellen Überblick über Einnahmen, Ausgaben und Netto-Cashflow – pro Objekt und über das gesamte Portfolio hinweg.

**Vorbedingungen:**
- Mindestens eine Property mit zugeordneten Mietern existiert.
- Ausgaben wurden erfasst (Phase 1: manuell; Phase 4: teilweise automatisch aus abgeglichenen Banktransaktionen, siehe UC2).

**Hauptablauf:**
1. Vermieter öffnet im Landlord-Frontend den erweiterten Dashboard-Bereich (`webapps/landlord/src/components/dashboard/`).
2. Das Dashboard zeigt für den gewählten Zeitraum (Monat/Quartal/Jahr) je Objekt: Soll-Mieteinnahmen, tatsächlich eingegangene Zahlungen (aus UC1/UC2), erfasste Ausgaben (neue Ausgaben-Entity aus Phase 1), Netto-Cashflow.
3. Eine Portfolio-Ansicht aggregiert alle Objekte des Realms und zeigt Gesamt-Rendite sowie eine Liste der Objekte mit größten Rückständen.
4. Vermieter kann in eine Detailansicht eines einzelnen Objekts wechseln und dort die zugrunde liegenden Transaktionen/Zahlungen einsehen (Verknüpfung zu UC2).
5. Vermieter filtert optional nach offenen Posten („nur Objekte mit Rückständen anzeigen").

**Alternativ-/Fehlerfälle:**
- Noch kein Bankkonto verbunden und keine Ausgaben erfasst → Dashboard zeigt nur die aus der bestehenden Mietberechnung bekannten Soll-/Ist-Werte (Fallback auf heutigen Funktionsumfang), mit Hinweis „Bankkonto verbinden für vollständige Cashflow-Ansicht" (Verweis auf UC1).
- Objekt hat negativen Cashflow (Ausgaben > Einnahmen) → visuelle Hervorhebung, keine Blockade.

**Ergebnis/Nachbedingung:** Der Vermieter hat eine aktuelle, konsolidierte Sicht auf die wirtschaftliche Situation seines Portfolios, ohne Daten manuell aus mehreren Quellen zusammentragen zu müssen.

**Betroffene Komponenten:** `webapps/landlord/src/components/dashboard/`, MobX-Store `webapps/landlord/src/store/Dashboard.js`, neue Ausgaben-Entity, neue/erweiterte Aggregations-Logik in `services/api/src/managers/accountingmanager.js`, Transaktionsdaten aus dem `banking`-Service (sofern vorhanden).

---

## UC4 – Monatlichen DATEV-Export für den Steuerberater erstellen

**Roadmap-Phase:** Phase 4 (Finanzberichte & Exporte)

**Akteur:** Vermieter bzw. dessen Steuerberater (Datenempfänger, kein direkter Systemnutzer).

**Ziel:** Der Vermieter erstellt am Monats- oder Jahresende einen DATEV-kompatiblen Export aller Buchungen für die Übergabe an die Steuerberatung, ohne Buchungssätze manuell zusammenzustellen.

**Vorbedingungen:**
- Für den gewählten Zeitraum liegen abgeglichene Zahlungen (UC2) und erfasste Ausgaben (UC3) vor.
- Belege (Rechnungen, Quittungen) sind als `Document`-Einträge im System vorhanden (bestehende Funktionalität, `services/pdfgenerator`).

**Hauptablauf:**
1. Vermieter öffnet den bestehenden Accounting-Bereich (`webapps/landlord/src/components/accounting/`), erweitert um einen neuen Export-Reiter.
2. Vermieter wählt Zeitraum (z. B. Juni 2026) und Zielformat „DATEV-Export".
3. Das System aggregiert alle im Zeitraum abgeglichenen Transaktionen (Mieteingänge aus UC2, erfasste Ausgaben) über die erweiterte `accountingmanager.js`-Logik.
4. Für jede Buchung wird automatisch ein vorkontierter Buchungssatz erzeugt: Betrag, Buchungsdatum, Kostenart (z. B. „Mieteinnahme", „Instandhaltung"), Objektbezug (Kostenstelle = Property), Link zum hinterlegten Beleg (`Document`-Referenz).
5. Das System erzeugt eine DATEV-konforme Exportdatei (CSV/ASCII-Format) und stellt sie zum Download bereit bzw. optional per E-Mail an eine hinterlegte Steuerberater-Adresse (Wiederverwendung des `emailer`-Service).
6. Vermieter lädt die Datei herunter und übermittelt sie an die Steuerberatung.

**Alternativ-/Fehlerfälle:**
- Für einzelne Transaktionen fehlt eine eindeutige Kostenart-Zuordnung → diese werden im Export als „ungeklärt" markiert und gesondert aufgelistet, statt den Export mit falscher Kontierung zu erzeugen.
- Zeitraum enthält noch nicht abgeglichene Banktransaktionen (offene Buchungsvorschläge aus UC2) → System weist vor Export darauf hin, dass der Export unvollständig sein könnte, und bietet an, zunächst zu den offenen Buchungsvorschlägen zu springen.
- Kein Bankkonto verbunden, nur manuelle Zahlungen erfasst → Export funktioniert weiterhin (nutzt bestehende `settlements.payments`-Daten), jedoch ohne automatische Kostenart-Erkennung aus Verwendungszwecken.

**Ergebnis/Nachbedingung:** Eine vollständige, vorkontierte Buchungsdatei liegt vor und kann ohne manuelle Nacharbeit an die Steuerberatung übergeben werden; der bisher rein CSV-basierte, unstrukturierte Export (`GET /api/v2/accounting/:year/csv/...`) wird um ein steuerlich direkt verwertbares Format ergänzt.

**Betroffene Komponenten:** `services/api/src/managers/accountingmanager.js` (neue Export-Route), `webapps/landlord/src/components/accounting/`, bestehende `Document`-Collection für Belegverknüpfung, `services/emailer` für optionalen Versand.
