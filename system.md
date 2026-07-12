# MicroRealEstate – System- und Architekturanalyse

> Stand: 2026-07-12. Diese Analyse bildet die Grundlage für die Roadmap (siehe `roadmap` weiter unten in diesem Dokument) und die Use Cases in [`useCases.md`](./useCases.md), mit besonderem Fokus auf Finanzen, Cashflow und eine zukünftige XS2A/Open-Banking-Anbindung.

## 1. Überblick

MicroRealEstate (MRE) ist eine quelloffene (MIT-lizenziert) Property-Management-Anwendung für Vermieter, bestehend aus einem Node.js-Microservices-Backend und zwei getrennten Next.js-Frontends (Vermieter- und Mieter-Portal). Der funktionale Kern liegt heute auf **Objekt-/Mieterverwaltung, Mietvertragserstellung, manueller Mietzahlungsverfolgung sowie PDF-/E-Mail-Kommunikation** (Mietaufforderungen, Quittungen, Mahnungen). Es gibt **keine Buchhaltungs-, Cashflow- oder Banking-Integration** im heutigen Funktionsumfang – dies ist der zentrale Erweiterungsraum für diese Analyse.

## 2. Gesamtarchitektur (Microservices)

MRE ist ein Yarn-Workspaces-Monorepo (`workspaces: ["cli","e2e","services/*","webapps/*","types"]`, Node 20). Alle Services sind ES-Module und teilen sich das Paket `@microrealestate/common` (Mongoose-Schemas, Middlewares, Bootstrap-Framework `Service`).

| Service | Pfad | Zweck |
|---|---|---|
| **gateway** | `services/gateway/src/index.ts` | Reiner Reverse-Proxy (Express + `http-proxy-middleware`), einziger extern erreichbarer Port (8080), routet auf alle übrigen Services, aggregierter `/health`-Endpoint |
| **authenticator** | `services/authenticator/src` | JWT-Auth: Passwort-Login für Vermieter (`routes/landlord.js`), passwortloser OTP-Login für Mieter (`routes/tenant.js`), Refresh-Tokens in Redis, M2M-App-Credentials |
| **api** | `services/api/src` | Kern-Backend für das Vermieter-Portal: Realms/Organisationen, Leases, Tenants, Properties, Mietberechnung, Zahlungen, Accounting/CSV-Export |
| **tenantapi** | `services/tenantapi/src` | Schlanke, read-lastige API für das Mieter-Portal (aggregierte Vertrags-/Saldodaten) |
| **emailer** | `services/emailer/src` | Versand von Mietaufforderungen, Mahnungen, Rechnungen, OTP-Mails via Gmail/Mailgun/SMTP (pro Realm konfigurierbar) |
| **pdfgenerator** | `services/pdfgenerator/src` | PDF-Erzeugung (Puppeteer/Headless-Chrome) für Quittungen, Mahnungen, Verträge; verwaltet Datei-Uploads (optional S3/B2) |
| **resetservice** | `services/resetservice/src` | Dev-/Demo-Hilfsservice zum DB-Reset, in Produktion nicht exponiert |
| **common** | `services/common/src` | Shared Library: Mongoose-Schemas (`collections/`), Auth-Middlewares, Mongo-/Redis-Clients, Logger, Crypto-Utils |

**Kommunikation:** Ausschließlich synchrones REST/HTTP via `axios`, kein Message-Queue-/Event-System. Redis dient nur als Session-/Token-Store, nicht als Bus. MongoDB ist der einzige persistente Datenspeicher und wird von mehreren Services direkt gelesen/geschrieben – keine strikte "ein Service = eine Datenbank"-Kapselung. Interne Service-zu-Service-Aufrufe sind über kurzlebige JWTs (`Service.createServiceToken`) abgesichert.

## 3. Datenmodell (MongoDB / Mongoose)

Zentrale Collections liegen in `services/common/src/collections/*.ts`:

- **Realm** (`realm.ts`) – Vermieter-Organisation: `members[]` (Rollen), `applications[]` (M2M-Keys), `addresses[]`, **`bankInfo: {name, iban}`** (reines Anzeigefeld, siehe Abschnitt 4), `companyInfo`, `thirdParties` (E-Mail-Provider-Konfiguration + S3/B2), `locale`, `currency`.
- **Account** – Vermieter-Benutzerkonto (Login-Daten, gehashtes Passwort).
- **Lease** (`lease.ts`) – Mietvertrags-Vorlage (`numberOfTerms`, `timeRange`).
- **Tenant** (`tenant.ts`, Mongo-Modellname `Occupant`) – zentrale Mieter-Entity: Firmen-/Personendaten, `properties[]` (inkl. `rent`, `expenses[]`, Ein-/Auszugsdatum), USt-Felder, sowie das zentrale, dynamisch befüllte Feld **`rents: {}`** (berechnete Mietperioden, siehe Abschnitt 4).
- **Property** (`property.ts`) – Objekt-Stammdaten (`type`, `surface`, `address`, `price`).
- **Document** (`document.ts`) – generische Dokument-Entity (Text oder Datei-Upload).
- **Template** (`template.ts`) – Dokumentvorlagen für Vertragsgenerierung.

Beziehungen laufen per String-IDs mit `ref` (z. B. `Tenant.realmId → Realm`, `Tenant.leaseId → Lease`, `Document.tenantId/leaseId/templateId`).

**Wichtige Lücke für Finanzthemen:** Es existieren keine Entities für Bankkonten (über das reine Anzeigefeld hinaus), Banktransaktionen, Ausgaben/Kosten (außerhalb tenantbezogener `expenses[]`), Rücklagen oder Nebenkostenabrechnungen.

## 4. Finanz- und Cashflow-relevante Bereiche (Ist-Zustand)

Dies ist der für die Roadmap entscheidende Abschnitt.

- **Mietberechnung**: `services/api/src/businesslogic/` berechnet pro Mietperiode ("term", Format `YYYYMMDDHH`) über eine 7-stufige Task-Pipeline (`1_base.js` … `7_total.js`) ein `rent`-Objekt mit Basisbetrag, offenen Forderungen, Rabatten, USt, Saldovortrag, Zahlungen und Summen.
- **Zahlungserfassung**: Zahlungen werden in `6_payments.js` unverändert aus `settlements.payments` übernommen – **rein manuelle Eingabe** durch den Vermieter im Frontend (`webapps/landlord/src/components/payment/NewPaymentDialog.js`, MobX-Store `webapps/landlord/src/store/Rent.js`, Route `PATCH /api/v2/rents/payment/:id/:term` in `services/api/src/routes.js`, Logik in `services/api/src/managers/rentmanager.js`).
- **Zahlungsstatus**: Wird nicht persistiert, sondern dynamisch aus `payment - grandTotal` berechnet (`services/api/src/managers/frontdata.js`, dupliziert in `services/tenantapi/src/controllers/tenants.ts`) → Status `paid`/`partiallypaid`/`notpaid`.
- **Rechnungen/Quittungen**: PDF-Templates (`invoice.ejs`, `rentcall*.ejs`) in `services/pdfgenerator/templates/`. Die IBAN aus `Realm.bankInfo` wird laut `services/pdfgenerator/data/invoice/index.js` (`landlord.hasBankInfo`) **nur zur Anzeige** auf der Rechnung verwendet – keine Verknüpfung zu tatsächlichen Kontobewegungen.
- **Accounting-Modul**: `services/api/src/managers/accountingmanager.js` bietet einen Jahresabschluss-Report (Mongo-Aggregation über `Tenant.rents`) mit `incomingTenants`/`outgoingTenants`/`settlements` sowie CSV-Export (`GET /api/v2/accounting/:year` und Unterrouten). Im Frontend dazu passend: `webapps/landlord/src/components/accounting/{IncomingTenants,OutgoingTenants,TenantSettlements}.js` – Fokus liegt hier auf Kautions-/Ein-Auszugs-Abrechnung, **nicht** auf allgemeiner Buchhaltung oder Cashflow.
- **Banking/Zahlungsabgleich**: **Nicht vorhanden.** Es gibt keinen Kontoauszugsimport, keine Transaktions-Entity, keinen automatischen Abgleich, kein SEPA-/PSD2-/XS2A-Modul und keinen DATEV- oder sonstigen Steuerberater-Export. Das Feld `Realm.bankInfo.iban` ist ausschließlich ein statisches Anzeigefeld.
- **Ausgabenseite**: Es gibt kein allgemeines Ausgaben-/Kosten-Tracking (Instandhaltung, Versicherung, Verwaltungskosten etc.) auf Objekt- oder Portfolioebene – nur tenantbezogene `expenses[]` (z. B. Nebenkostenvorauszahlungen als Teil der Mietforderung).
- **Dashboard**: `webapps/landlord/src/components/dashboard/` und Store `Dashboard.js` existieren, zeigen aber nach aktuellem Stand primär Kennzahlen zu Mietständen/Belegung, kein Cashflow- oder Finanz-Dashboard im Sinne von Einnahmen/Ausgaben/Rendite.

**Fazit:** MRE deckt den Mietforderungs- und Kommunikationsprozess ab, aber nicht die eigentliche Objektbuchhaltung. Das ist exakt die Lücke, die immocloud mit Bankanbindung, automatischem Zahlungsabgleich, Cashflow-Dashboard und DATEV-Export schließt (siehe Abschnitt "Roadmap").

## 5. Frontend-Architektur

- **webapps/landlord** (`@microrealestate/landlord`): Next.js 14 (Pages Router, `src/pages/[organization]/...`), React 18, State-Management via **MobX** (`src/store/{Rent,Tenant,Property,Organization,Lease,Document,Accounting,Dashboard,Template,User}.js`) plus `@tanstack/react-query` für Server-State. UI: Tailwind CSS + Radix UI (shadcn-artig), Formulare via Formik/Yup, Rich-Text via Tiptap. Komponentenordner u. a. `accounting`, `dashboard`, `payment`, `properties`, `rents`, `tenants`, `organization`.
- **webapps/tenant** (`@microrealestate/tenant`): Next.js 14 **App Router** (`src/app/[lang]/...`), TypeScript, React Hook Form + Zod, kein MobX (serverseitiger Datenabruf).
- **webapps/commonui**: geteiltes, älteres Material-UI-/Utility-Paket, nur vom Landlord-Frontend genutzt.

Beide Frontends sprechen ausschließlich über das Gateway mit den Backend-Services.

## 6. API-Gateway & Authentifizierung

Das Gateway ist zustandslos und mappt Pfade auf interne Service-URLs (z. B. `/api/v2/authenticator` → authenticator, `/api/v2` → api, `/tenantapi` → tenantapi). Auth ist rein JWT-basiert:

- Vermieter-Login: Passwort + `bcrypt`, kurzlebiges Access-Token (Refresh via httpOnly-Cookie, Refresh-Token in Redis gespeichert).
- Mieter-Login: passwortlos per E-Mail-OTP, Access-Token als `sessionToken`-Cookie.
- M2M-Zugriff: `clientId`/`clientSecret`, JWT signiert mit `APPCREDZ_TOKEN_SECRET`.
- Zentrale Middleware (`services/common/src/utils/middlewares.ts`): `needAccessToken`, `checkOrganization` (bindet Request an ein `Realm` – Multi-Tenancy, ein Account kann mehreren Realms/Organisationen angehören), `onlyRoles`/`notRoles`.

Diese Multi-Tenancy- und Rollenstruktur (Realm-Mitgliedschaft mit Rolle) ist die natürliche Stelle, um künftig granularere Berechtigungen für Finanzdaten (z. B. Rolle „Buchhaltung“ mit Lesezugriff auf Bankdaten, aber ohne Vertragsänderungsrechte) einzuhängen.

## 7. PDF-Generierung & Dokumente

`services/pdfgenerator` rendert serverseitig via Puppeteer aus EJS-/Handlebars-Templates: Mietquittungen/Rechnungen (`invoice.ejs`), Mahnstufen (`rentcall*.ejs`), individuelle Verträge/Dokumente (generische `Document`/`Template`-Collections). Verwaltet zusätzlich Datei-Uploads inkl. optionalem S3-kompatiblem Objektspeicher (Backblaze B2, konfiguriert über `Realm.thirdParties.b2`).

## 8. Infrastruktur & Deployment

- Mehrere Docker-Compose-Varianten im Root: `docker-compose.yml` (Standard-Self-Hosting mit vorgebauten Images), `docker-compose.microservices.{base,dev,prod,test}.yml` (Entwicklung/Test einzelner Services), `docker-compose.monitoring.yml`.
- `mongo:7` und `redis:7.4` als Infrastruktur-Container, `caddy` als Reverse-Proxy mit automatischem TLS.
- Env-Handling über `base.env`/`.env.domain` → `.env`, Secrets (Token-Secrets, `CIPHER_KEY`/`CIPHER_IV_KEY`, `REDIS_PASSWORD`) per Compose-Variablen injiziert. Die vorhandene `CIPHER_KEY`/`CIPHER_IV_KEY`-Infrastruktur (aktuell für Dokumente/E-Mail-Zugangsdaten genutzt) ist eine sinnvolle Grundlage, um künftig auch Banking-Zugangs-Tokens verschlüsselt abzulegen.
- Backup/Restore über `mongodump`/`mongorestore`, Daten unter `./data/mongodb`, `./data/redis`.
- Orchestrierung primär über das CLI-Tool, kein Makefile.

## 9. CLI-Tool (`cli/`)

`@microrealestate/cli` kapselt Docker-Compose-Befehle (`build`, `start`, `stop`, `dev`, `ci`) für Entwickler/Selbsthoster, inkl. Health-Checks und Verzeichnis-Initialisierung. Als eigenständiges Executable via `pkg` baubar.

## 10. Shared Types Package (`types/`)

`@microrealestate/types` enthält ausschließlich TypeScript-Typdefinitionen ohne Laufzeitlogik (Collection-Typen, Service-/Middleware-Typen, API-Verträge für die Tenant-API). Wird von `common`, `gateway`, `resetservice`, `tenantapi` und dem Tenant-Frontend referenziert.

## 11. Monorepo-Tooling

Yarn Workspaces (Berry, `.yarnrc.yml`), kein Turborepo/Nx. Node 20. ESLint/Prettier + Husky/lint-staged. CI via GitHub Actions.

## 12. Zusammenfassung für die Erweiterungsplanung

**Stärken für eine Erweiterung:**
- Sauber getrennte Microservices mit etabliertem Bootstrap-Framework (`Service`-Klasse) – ein neuer „Banking“-Service lässt sich nach demselben Muster ergänzen (eigener Port, eigenes Gateway-Routing, Zugriff auf gemeinsame Mongo-DB via `@microrealestate/common`).
- Vorhandene Verschlüsselungs-Infrastruktur (`CIPHER_KEY`/`CIPHER_IV_KEY`) für sensible Zugangsdaten.
- Multi-Tenancy/Rollenmodell (Realm + Mitgliederrollen) als Basis für Finanz-spezifische Berechtigungen.
- Bereits vorhandenes, wenn auch rudimentäres Accounting-Modul (`accountingmanager.js`) als Andockpunkt für Exporte (z. B. DATEV).

**Zentrale Lücken (= Ansatzpunkte der Roadmap):**
1. Keine Bankkonto-/Transaktions-Entities.
2. Keine XS2A/Open-Banking-Anbindung, kein automatischer Kontoauszugsimport.
3. Keine automatische Zahlungszuordnung/Reconciliation – Zahlungsstatus hängt vollständig von manueller Erfassung ab.
4. Kein Cashflow-/P&L-Dashboard auf Objekt- oder Portfolioebene.
5. Kein Ausgaben-/Kosten-Tracking jenseits tenantbezogener Nebenkosten.
6. Kein Steuerberater-/DATEV-Export.
7. Keine Nebenkostenabrechnung mit Verteilerschlüsseln.

Diese Lücken bilden die Grundlage der nachfolgenden Roadmap.

---

# Roadmap: Finanz-, Cashflow- und XS2A-Erweiterung

Ziel ist es, MicroRealEstate schrittweise um die Finanzfunktionen von immocloud zu erweitern (siehe Recherche-Quellen unten), mit klarem Fokus auf Bankanbindung, automatischen Zahlungsabgleich und Cashflow-Transparenz. Die Phasen bauen aufeinander auf: jede Phase liefert für sich nutzbaren Mehrwert, auch falls eine spätere Phase (z. B. echte XS2A-Anbindung) mehr Zeit benötigt.

## Referenz: Relevante immocloud-Funktionen (Recherche-Zusammenfassung)

- **Bankanbindung**: Bankkonten werden per Klick verbunden (Bankauswahl/BLZ, Zugangsdaten + TAN-Verfahren analog klassischem Online-Banking-Login), danach automatische Synchronisierung; Wiederverbindung nach 90 Tagen erforderlich (typisches SCA-Verhalten regulierter PSD2/XS2A-Zugänge). Alternativ manuelles Konto mit Umsatzimport per Vorlage.
- **Automatische Miet-/Umsatzzuordnung**: Abgleich von Betrag, Verwendungszweck und Buchungsmustern gegen offene Sollstellungen, inkl. Behandlung von Teil- und Überzahlungen; Buchungsvorschläge sind einzeln bestätigbar.
- **DATEV-Export**: digitale, vorkontierte Buchungssätze mit Beleglink, Kostenart und Objektbezug.
- **Cashflow-/Finanz-Dashboard**: Überblick über Mieteingänge, Rückstände, offene Posten und Rendite pro Objekt/Portfolio.
- **Nebenkostenabrechnung**: automatisierte Erstellung nach wählbarem Verteilerschlüssel.
- **Berichte-Center**: Reports über Mieteinnahmen, Ausgaben, Transaktionen.
- **Multi-Konten/Objektzuordnung**: korrekte Bankverbindung je Liegenschaft, auch internationale Konten.

(Quellen: immocloud.de – Objektbuchhaltung, Mietverwaltung, Hausverwalter-Lösung; immocloud Helpcenter – Bankkonto verbinden, Automatische Miet- und Umsatzzuordnung.)

## Phase 0 – Fundament (Datenmodell & Service-Grundlage)

Ziel: technische Basis schaffen, ohne die noch keine der Finanzfunktionen sinnvoll baubar ist.

- Neue Collections in `services/common/src/collections/`: `bankaccount.ts` (IBAN, Bank, verknüpfter Realm/Property, Verbindungsstatus, Consent-Ablaufdatum), `transaction.ts` (Betrag, Valuta-/Buchungsdatum, Verwendungszweck, Gegenkonto-IBAN, Rohdaten-Referenz, Zuordnungsstatus).
- Neuer Microservice `services/banking` (nach etabliertem Muster von `tenantapi`/`resetservice`: eigener Port, `Service`-Bootstrap, Gateway-Route `/api/v2/banking`), der als Adapter zu einem lizenzierten XS2A-/Open-Banking-Aggregator (z. B. finAPI, Tink oder GoCardless Bank Account Data) fungiert. **Wichtig:** MRE selbst muss dafür keine eigene BaFin-Lizenz als Kontoinformationsdienst (AISP) erwerben, wenn ein bereits lizenzierter Aggregator als technischer Dienstleister eingebunden wird – das ist eine zentrale Architekturentscheidung, die vor Phase 2 getroffen werden muss.
- Wiederverwendung der bestehenden `CIPHER_KEY`/`CIPHER_IV_KEY`-Infrastruktur zur verschlüsselten Ablage von Zugangs-/Consent-Tokens.
- Erweiterung des Rollenmodells (Realm-Mitgliederrollen) um einen finanz-/buchhaltungsbezogenen Zugriffsbereich.

## Phase 1 – Manuelle Cashflow-Grundlagen (kein Banking-Vorlauf nötig)

Ziel: schneller Mehrwert, unabhängig von der Banking-Anbindung, und Vorbereitung des Datenmodells für spätere Automatisierung.

- Neue Entity/Erfassung für **Ausgaben** auf Objekt-/Portfolioebene (Instandhaltung, Versicherung, Verwaltungskosten) – bisher existiert nur tenantbezogenes `expenses[]`.
- Erstes **Cashflow-Dashboard** (Einnahmen aus Mieten vs. erfasste Ausgaben, pro Objekt und Portfolio) im Landlord-Frontend, aufbauend auf `webapps/landlord/src/components/dashboard/`.
- **Manueller Kontoauszugs-Import** (CSV/MT940-Upload mit Mapping-Vorlage) als Vorstufe zur echten XS2A-Anbindung – liefert sofort Nutzen für Vermieter, die (noch) keine Bank verbinden wollen, und validiert das Transaktions-Datenmodell aus Phase 0.

## Phase 2 – XS2A/Open-Banking-Anbindung

Ziel: automatischer, laufender Kontoauszugsimport.

- Consent-/Verbindungs-Flow im Landlord-Frontend: Bankauswahl, Weiterleitung zur Bank-SCA (TAN-Verfahren) über den Aggregator, Rückführung und Kontoauswahl.
- Zuordnung verbundener Konten zu Realm bzw. einzelnen Properties (analog immocloud „richtige Bankverbindung je Liegenschaft").
- Geplanter Sync-Job (z. B. täglicher Cron im neuen `banking`-Service) zum Abruf neuer Transaktionen und Ablage in der `transaction`-Collection.
- Consent-Ablauf-Handling: Erinnerung/Benachrichtigung an den Vermieter vor Ablauf der typischen 90-Tage-Zustimmung (per bestehendem `emailer`-Service).

## Phase 3 – Automatischer Zahlungsabgleich (Reconciliation)

Ziel: die eigentliche Kernanforderung – Zahlungsstatus nicht mehr manuell pflegen.

- Matching-Engine: importierte Transaktionen gegen offene Mietforderungen (`Tenant.rents`) abgleichen anhand Betrag, Verwendungszweck/Referenz, Zahler-IBAN und Historie; Behandlung von Teil- und Überzahlungen.
- Review-UI („Buchungsvorschläge"/Accounting-Inbox) im Landlord-Frontend, in der Vorschläge einzeln bestätigt oder korrigiert werden – Integration in bestehende Zahlungs-Erfassung (`rentmanager.js`, `NewPaymentDialog.js`), sodass bestätigte Matches automatisch `settlements.payments` befüllen.
- Erweiterung auf die Ausgabenseite: wiederkehrende Kosten (Versicherung, Kredit, Verwaltung) automatisch erkennen und den in Phase 1 eingeführten Ausgaben zuordnen.

## Phase 4 – Finanzberichte & Exporte

Ziel: Cashflow-Daten nutzbar machen für Steuerberater und Portfolio-Steuerung.

- Erweiterung von `accountingmanager.js` um Cashflow-/GuV-Reports pro Objekt und Portfolio (Einnahmen, Ausgaben, Rendite), aufbauend auf den nun automatisiert befüllten Transaktionsdaten.
- **DATEV-kompatibler Export** (vorkontierte Buchungssätze, Objekt-/Kostenstellenbezug, Beleglink zu vorhandenen `Document`-Einträgen) als neue Route neben den bestehenden CSV-Exporten.
- Portfolio-weiter Rückstands-/Offene-Posten-Bericht.

## Phase 5 – Erweiterte Finanzfunktionen

- **Nebenkostenabrechnung** mit konfigurierbaren Verteilerschlüsseln (Fläche, Personenzahl, Verbrauch), aufsetzend auf den nun vollständigen Transaktions- und Ausgabendaten.
- **Kautionsverwaltung**, verknüpft mit tatsächlichen Bankbewegungen (Eingang/Rückzahlung), statt bisher rein manueller Erfassung in `TenantSettlements.js`.
- Unterstützung mehrerer Bankkonten pro Realm inkl. internationaler IBANs (analog immocloud).

## Priorisierungslogik

Die Reihenfolge folgt dem Prinzip „Datenmodell vor Automatisierung vor Reporting": ohne Phase 0/1 gibt es keine sinnvolle Grundlage für die XS2A-Anbindung (Phase 2); ohne automatisierte Transaktionsdaten (Phase 2) bringt eine Abgleich-Engine (Phase 3) keinen Mehrwert gegenüber der heutigen manuellen Erfassung; Reports und DATEV-Export (Phase 4) sind erst aussagekräftig, wenn die zugrunde liegenden Transaktionsdaten vollständig und automatisiert vorliegen. Phase 5 ist bewusst zuletzt eingeordnet, da diese Funktionen (Nebenkostenabrechnung, Kaution) von den vorherigen Phasen abhängen, aber MRE auch ohne sie bereits einen deutlichen Mehrwert gegenüber dem heutigen Stand bietet.

---

# Anhang: Anbietervergleich XS2A/Open-Banking-API (Architekturentscheidung Phase 0)

Für die in Phase 0 genannte Architekturentscheidung („lizenzierten Aggregator als technischen Dienstleister einbinden statt eigener BaFin-Lizenz") wurden die gängigen XS2A/Open-Banking-Aggregatoren mit Fokus auf **Konditionen bei kleinen Aufrufzahlen** verglichen – relevant, weil MRE als selbst-gehostete Open-Source-Anwendung typischerweise viele kleine, unabhängige Installationen hat (einzelne Vermieter mit wenigen Objekten), nicht eine einzelne Instanz mit hohem zentralem Volumen.

## Wichtiger Befund vorab

Die meisten Anbieter veröffentlichen **keine** Preislisten („sales-gated", nur auf Anfrage: Tink, Salt Edge, Enable Banking, Klarna Kosma, Powens, TrueLayer, Plaid). Belastbare Zahlen für einen echten Kosten-Vergleich bei kleinen Volumina lassen sich daher nur für einen Teil der Anbieter aus öffentlichen Quellen ableiten – für die übrigen ist ein konkretes Angebot einzuholen, bevor die Entscheidung final getroffen wird.

## 1. finAPI (Startpunkt der Recherche)

- **Herkunft/Lizenz:** deutsches Unternehmen (München, Teil der Schufa-Gruppe), **selbst BaFin-lizenziert** als Konto­informationsdienst; bietet zusätzlich „PSD2 License as a Service" an, falls ein Kunde selbst eine Teil-Lizenz benötigt.
- **Bankabdeckung:** nach eigenen Angaben nahezu vollständige Abdeckung in Deutschland/Österreich – für den deutschen Zielmarkt von MRE der stärkste Anbieter.
- **Veröffentlichte Preise** (`finapi.io/en/prices/`):
  - „Access B2X Basic" (Privat- + Geschäftskonten): **Flatrate ab 100 €/Monat für bis zu 200 Nutzer/Konten**, bzw. 200 €/Monat für bis zu 1.000 Konten.
  - „Access B2C Basic" (nur Privatkonten): ab 60 €/Monat für bis zu 200 Konten.
  - Explizite „Personal-Use"-Lizenz: 200 €/Monat für bis zu 10 Konten.
  - Kein Pay-as-you-go unterhalb dieser Flatrates – **auch bei 1 einzigen verbundenen Konto fällt die volle Monats-Flatrate an.**
  - 30 Tage kostenloser Test verfügbar.
- **Einordnung für kleine Aufrufzahlen:** transparent, aber mit **fixen Mindestkosten ab 60–100 €/Monat unabhängig vom tatsächlichen Volumen** – für einen einzelnen Kleinvermieter (Self-Hosting-Szenario) unwirtschaftlich; erst ab mehreren zehn/hundert verbundenen Konten (z. B. bei einer zentral gehosteten MRE-Cloud-Variante) sinnvoll skalierbar.

## 2. GoCardless Bank Account Data (ehem. Nordigen)

- **Bisher bester Kandidat für Kleinvolumen:** echter kostenloser Tarif mit bis zu 50 Bankverbindungen/Monat, keine Fixkosten.
- **Aber – kritischer Ausschlussgrund:** GoCardless nimmt **seit Juli 2025 keine Neuanmeldungen für Bank Account Data mehr an** („new signups disabled"); nur Bestandskunden können den Dienst weiter nutzen. Für ein neues MRE-Feature damit **faktisch nicht verfügbar**.

## 3. Tink (Visa)

- Auf der öffentlichen Preisseite genannte Sätze (ab 0,50 €/Nutzer/Monat für Transaktionsdaten, 0,25 € pro Kontoverifizierung) gelten laut Tink **nur für Bestandskunden mit aktivem Vertrag** – für Neukunden ist ein individuelles Sales-Angebot nötig.
- Zielgruppe laut Marktbeobachtung eher größere Unternehmen/Banken; kein öffentlich zugänglicher Kleinstmengen-Einstieg.

## 4. Salt Edge

- Reines Sales-Gate, „usage-based", aber keine öffentlichen Zahlen, kein Self-Service-Signup mit Preisliste. Ohne Angebot nicht seriös bewertbar.

## 5. Enable Banking

- Preismodell laut eigenen Angaben pro verbundenem Konto/Monat, in Marktbeobachtungen als vergleichsweise **startup-/kleinkunden-freundlich** beschrieben. Keine öffentliche Preisliste – Angebot einholen lohnt sich, gilt als einer der zugänglicheren Anbieter für frühe Projektphasen.

## 6. Klarna Kosma

- Keine öffentliche Preisliste; punktuelle Promo für ausgewählte Start-ups (3 Monate kostenlos, limitiert auf 300 Transaktionen/aktive Nutzer pro Monat) – kein reguläres Kleinvolumen-Modell.

## 7. Powens (ehem. Budget Insight) und Ibanity

- **Powens:** keine öffentliche Preisliste, Sales-gated, guter Fokus Frankreich/EU, aber ohne Angebot nicht bewertbar.
- **Ibanity:** hat laut Marktübersicht einen „free production tier" für einzelne Produkte, Fokus jedoch auf Benelux (Isabel Group) – für den deutschen Zielmarkt (DATEV-Anbindung, deutsche Banken) schwächere Abdeckung als finAPI trotz möglicherweise günstigerem Einstieg.

## Vergleichstabelle (Kurzüberblick)

| Anbieter | DE-Bankabdeckung | Öffentliche Preise? | Kleinstmengen-Modell | Verfügbar für Neukunden |
|---|---|---|---|---|
| **finAPI** | sehr stark | ja | Flatrate ab 60–100 €/Monat (kein Pay-as-you-go) | ja |
| GoCardless Bank Account Data | mittel | ja (Free-Tier) | kostenlos bis 50 Verbindungen/Monat | **nein – seit 07/2025 geschlossen** |
| Tink | stark | nur Bestandskunden | kein öffentlicher Einstieg | ja (nur via Sales) |
| Salt Edge | mittel–stark | nein | unbekannt | ja (nur via Sales) |
| Enable Banking | stark (EU-weit) | nein | vermutlich günstig, aber ungeprüft | ja (nur via Sales) |
| Klarna Kosma | stark | nein | nur befristete Promo | ja (nur via Sales) |
| Powens | mittel (EU-weit) | nein | unbekannt | ja (nur via Sales) |
| Ibanity | schwach (Fokus Benelux) | teilweise Free-Tier | evtl. günstig, aber kaum DE-Banken | ja (nur via Sales) |

## Empfehlung für die Architekturentscheidung

1. **Kein Anbieter bietet aktuell ein echtes, öffentlich zugängliches Pay-as-you-go-Modell für Kleinstvolumen mit guter deutscher Bankabdeckung.** Der einzige Anbieter, der das früher leistete (GoCardless/Nordigen), ist für Neukunden geschlossen.
2. **finAPI** ist trotz Mindest-Flatrate (ab 60–100 €/Monat) die einzige Option mit vollständig transparenten Preisen, eigener BaFin-Lizenz (reduziert Compliance-Aufwand für MRE) und der stärksten Abdeckung deutscher Banken – relevant, da MRE primär im deutschsprachigen Markt mit immocloud konkurriert (DATEV-Export etc.). Für ein zentral betriebenes „MRE-Cloud"-Angebot mit vielen Nutzern ist die Flatrate zudem gut skalierbar (Kosten pro Konto sinken mit Volumen).
3. Für das **Self-Hosting-Szenario** (jeder Betreiber verbindet nur 1–10 eigene Konten) ist eine Fixkosten-Flatrate ab 60 €/Monat pro Installation unwirtschaftlich. Hier sollte vor der finalen Entscheidung ein konkretes Angebot von **Enable Banking** eingeholt werden (in Marktbeobachtungen als kleinkundenfreundlichstes Modell unter den verbliebenen Anbietern genannt) sowie zum Vergleich eines von **Salt Edge** und **Powens**.
4. **Nächster Schritt vor endgültiger Festlegung:** Konkrete Angebote bei finAPI, Enable Banking und Salt Edge einholen (alle drei bieten Sandbox-Zugänge), da die öffentlich verfügbaren Informationen für einen abschließenden Kostenvergleich bei sehr kleinen Volumina nicht ausreichen. Bis dahin sollte der `banking`-Service (Phase 0) so entworfen werden, dass der Aggregator austauschbar ist (eigenes Adapter-Interface statt direkter finAPI-Kopplung), um die Entscheidung nicht vorwegzunehmen.

*(Quellen: finapi.io/en/prices; GoCardless Bank Account Data Status-Seite und Support-Dokumentation zum Neuanmelde-Stopp seit Juli 2025; Tink Pricing-Seite; openbankingtracker.com Aggregator-Vergleich; jeweilige Anbieter-Webseiten von Salt Edge, Enable Banking, Klarna Kosma, Powens, Ibanity.)*
