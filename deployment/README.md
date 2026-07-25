# Server-Setup – Schritt für Schritt

Diese Anleitung richtet den Zielserver so ein, dass die GitHub-Pipeline
(`.github/workflows/deploy.yml`) per Git-Tag ein Deployment auslösen kann.

## Ablauf, wenn alles steht

```
git tag v1.0.0 && git push origin v1.0.0
        │
        ▼
GitHub Actions: build → Trivy-Scan → cosign-Signatur → Push nach GHCR
        │
        ▼
Tailscale (ephemerer CI-Node, tag:ci)  ──SSH──▶  Server
                                                    │  forced command
                                                    ▼
                                          deployment/deploy.sh v1.0.0
                                          → cosign verify
                                          → docker compose pull / up -d
                                          → Health-Check (Rollback bei Fehler)
```

Der CI-Key kann auf dem Server **nichts anderes** als `deploy.sh` starten, und
`deploy.sh` akzeptiert als einziges Argument ein Semver-Tag. Ein kompromittierter
Runner kann damit maximal ein bereits signiertes Release deployen – keine
beliebigen Befehle ausführen.

## Konventionen in dieser Anleitung

| Platzhalter                       | Beispiel/Bedeutung                       |
| --------------------------------- | ---------------------------------------- |
| `jpfrehe/microrealestate`         | dein GitHub-Repo                         |
| `thinkcentre`                     | Tailscale-MagicDNS-Name des Servers      |
| `mre-deploy`                      | der Deploy-User, den wir anlegen         |
| `/opt/microrealestate`            | Installationsverzeichnis auf dem Server  |

Befehle mit `sudo` laufen als Admin-User, Befehle nach `sudo -iu mre-deploy` als
Deploy-User.

---

# Teil 0 – Vorbereitung (auf deinem Rechner)

`deploy.sh` und das Image-Overlay müssen im Repo auf `master` liegen, sonst
schlagen die `curl`-Aufrufe in Schritt 3 fehl.

```bash
# im lokalen Klon des Repos
git checkout claude/github-pipeline-ssh-auth-s1d3w9
git log --oneline -1        # "Enable secure tag-triggered deployment ..."
```

Branch pushen, PR mergen. Alternativ kannst du die beiden Dateien in Schritt 3
auch direkt per `scp` vom lokalen Klon auf den Server kopieren – dann brauchst du
den Merge erst später.

---

# Teil 1 – Server einrichten

## Schritt 1: Voraussetzungen prüfen

```bash
docker --version
docker compose version
```

Fehlt Docker:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
```

## Schritt 2: Deploy-User anlegen

```bash
sudo useradd -m -s /bin/bash mre-deploy
sudo usermod -aG docker mre-deploy
```

Der User braucht **kein** sudo. Die `docker`-Gruppe ist faktisch root-äquivalent –
deshalb ist der forced command aus Schritt 9 der eigentliche Schutz, nicht die
Unix-Rechte.

## Schritt 3: Verzeichnis und Dateien anlegen

```bash
sudo mkdir -p /opt/microrealestate
sudo chown mre-deploy:mre-deploy /opt/microrealestate

sudo -iu mre-deploy
cd /opt/microrealestate

RAW=https://raw.githubusercontent.com/jpfrehe/microrealestate/master

curl -fsSL -O "$RAW/docker-compose.yml"
curl -fsSL "$RAW/.env.domain" -o .env

mkdir -p deployment backup data
curl -fsSL "$RAW/deployment/deploy.sh" -o deployment/deploy.sh
curl -fsSL "$RAW/deployment/docker-compose.images.yml" -o deployment/docker-compose.images.yml
chmod 755 deployment/deploy.sh
chmod 600 .env
```

Prüfen, dass wirklich Dateien und keine 404-Seiten angekommen sind:

```bash
head -1 deployment/deploy.sh      # -> #!/usr/bin/env bash
head -1 docker-compose.yml        # -> services:
```

> **Warum das Overlay?** `docker-compose.yml` zeigt fest auf die Upstream-Images
> (`ghcr.io/microrealestate/microrealestate/*`). `deployment/docker-compose.images.yml`
> biegt sie auf deinen Fork-Namespace um. `deploy.sh` lädt deshalb immer **beide**
> Compose-Dateien.

## Schritt 4: Secrets erzeugen und `.env` befüllen

Noch als `mre-deploy` in `/opt/microrealestate`:

```bash
for VAR in ACCESS_TOKEN_SECRET REFRESH_TOKEN_SECRET RESET_TOKEN_SECRET \
           APPCREDZ_TOKEN_SECRET CIPHER_KEY CIPHER_IV_KEY REDIS_PASSWORD; do
  VALUE=$(openssl rand -hex 32)
  sed -i "s|^${VAR}=.*|${VAR}=${VALUE}|" .env
done

grep -E '^(ACCESS|REFRESH|RESET|APPCREDZ|CIPHER|REDIS)' .env
```

> **🚨 Diese Werte sofort sichern** (Passwortmanager). Ohne sie kommst du nach
> einem Neuaufsetzen weder an die Logins noch an verschlüsselte Daten in der DB.

Danach `.env` öffnen und den Rest setzen:

```bash
nano .env
```

Mindestens anzupassen:

```ini
MRE_VERSION=latest        # wird ab jetzt von deploy.sh gepflegt
GMAIL_EMAIL=...           # oder MAILGUN_* / SMTP_* – ohne Mailversand kein
GMAIL_APP_PASSWORD=...    # Passwort-Reset und kein Tenant-Login
EMAIL_FROM=...
EMAIL_REPLY_TO=...
```

## Schritt 5: Zugriffsvariante wählen

Genau eine der beiden Varianten – sie unterscheiden sich nur in `.env`.

### Variante A – öffentliche Domain mit HTTPS

Caddy (Service `reverse-proxy`) holt automatisch ein Let's-Encrypt-Zertifikat.
Dafür müssen die DNS-Records auf den Server zeigen und Port 80/443 erreichbar sein.

```ini
APP_PROTOCOL=https
APP_DOMAIN=app.example.com
# APP_PORT=8080          <- auskommentieren!
```

`APP_PORT` **muss leer bleiben**, sonst versucht Caddy Port 8080 zu belegen, den
schon das Gateway hält – der Start scheitert mit einem Port-Konflikt.

Danach erreichbar unter `https://app.example.com/landlord` bzw. `/tenant`.

### Variante B – nur intern (Tailnet/LAN, keine Domain)

Reverse-Proxy abschalten, direkt auf das Gateway zugreifen:

```ini
COMPOSE_PROFILES=local
APP_PORT=8080
# APP_DOMAIN und APP_PROTOCOL bleiben auskommentiert
```

Danach erreichbar unter `http://thinkcentre:8080/landlord` bzw. `/tenant`.

Kontrolle – `reverse-proxy` darf bei Variante B **nicht** in der Liste stehen:

```bash
docker compose -f docker-compose.yml -f deployment/docker-compose.images.yml \
  config --services | sort
```

## Schritt 6: cosign installieren

Prüft beim Deployment, dass die Images wirklich aus deinem Workflow stammen.

```bash
exit    # zurück zum Admin-User

sudo curl -fsSL -o /usr/local/bin/cosign \
  https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64
sudo chmod +x /usr/local/bin/cosign
cosign version
```

## Schritt 7: `deploy.conf` anlegen

```bash
sudo mkdir -p /etc/microrealestate
sudo tee /etc/microrealestate/deploy.conf > /dev/null <<'EOF'
APP_DIR=/opt/microrealestate
COMPOSE_FILES="docker-compose.yml deployment/docker-compose.images.yml"
IMAGE_NAMESPACE=ghcr.io/jpfrehe/microrealestate
GITHUB_REPOSITORY=jpfrehe/microrealestate
VERIFY_SIGNATURES=true
HEALTHCHECK_URL=http://localhost:8080/health
HEALTHCHECK_RETRIES=30
HEALTHCHECK_DELAY=5
PRUNE_IMAGES=true
EOF
sudo chmod 644 /etc/microrealestate/deploy.conf
```

`HEALTHCHECK_URL` bleibt in **beiden** Varianten auf `localhost:8080` – das
Gateway veröffentlicht den Port immer direkt, unabhängig vom Reverse-Proxy.
`/health` fragt intern alle Services ab und ist damit ein echtes Deployment-Gate.

## Schritt 8: An GHCR anmelden (nur bei privatem Repo)

Personal Access Token (classic) mit **nur** `read:packages` erzeugen:
GitHub → Settings → Developer settings → Personal access tokens.

```bash
sudo -iu mre-deploy
echo "ghp_DEIN_TOKEN" | docker login ghcr.io -u jpfrehe --password-stdin
```

Das Login landet in `~mre-deploy/.docker/config.json` und bleibt bestehen. Bei
einem öffentlichen Repo ist dieser Schritt nicht nötig.

## Schritt 9: SSH-Key mit forced command hinterlegen

Schlüsselpaar **auf deinem Rechner** erzeugen, nicht auf dem Server:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ./mre_deploy_key -N ""
cat ./mre_deploy_key.pub
```

Auf dem Server eintragen – die Optionen **vor** dem Key sind der entscheidende Teil:

```bash
sudo -iu mre-deploy
mkdir -p ~/.ssh && chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys
```

Eine Zeile, alles zusammenhängend:

```
command="/opt/microrealestate/deployment/deploy.sh",restrict ssh-ed25519 AAAA...DEIN_PUBLIC_KEY... github-actions-deploy
```

```bash
chmod 600 ~/.ssh/authorized_keys
```

`command=` erzwingt `deploy.sh`, egal was der Client sendet – das Tag landet nur
in `$SSH_ORIGINAL_COMMAND`. `restrict` schaltet Port-, Agent- und X11-Forwarding
sowie PTY-Zuweisung ab.

Von deinem Rechner testen:

```bash
ssh -i ./mre_deploy_key mre-deploy@thinkcentre "whoami"
# erwartet: ERROR: ungültiges Tag 'whoami' ...   <- genau so soll es sein
```

## Schritt 10: Erster Start von Hand

Bevor die Pipeline ins Spiel kommt: einmal ein Tag bauen lassen und manuell
deployen. So trennst du Server-Probleme sauber von Pipeline-Problemen.

Auf deinem Rechner:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Warten, bis der `build`-Job in GitHub Actions grün ist (der `deploy`-Job schlägt
noch fehl – die Secrets kommen erst in Teil 2).

Auf dem Server:

```bash
sudo -iu mre-deploy
MRE_DEPLOY_CONFIG=/etc/microrealestate/deploy.conf \
  /opt/microrealestate/deployment/deploy.sh v0.1.0
```

Erwartete Ausgabe (gekürzt):

```
2026-01-01T12:00:00Z  Deployment von v0.1.0 gestartet
2026-01-01T12:00:00Z  aktuell deployte Version: latest
2026-01-01T12:00:05Z  ziehe Images für v0.1.0
2026-01-01T12:01:10Z  prüfe Signatur: ghcr.io/jpfrehe/microrealestate/api:v0.1.0
...
2026-01-01T12:01:40Z  alle Signaturen gültig
2026-01-01T12:01:41Z  starte Container neu
2026-01-01T12:02:15Z  Anwendung ist gesund (Versuch 7)
2026-01-01T12:02:16Z  Deployment von v0.1.0 erfolgreich abgeschlossen
```

Gegenprüfen:

```bash
docker compose -f /opt/microrealestate/docker-compose.yml \
  -f /opt/microrealestate/deployment/docker-compose.images.yml ps
curl -s http://localhost:8080/health
cat /opt/microrealestate/.deployed-version
```

Läuft das nicht, siehe [Troubleshooting](#troubleshooting) – erst weitermachen,
wenn dieser Schritt sauber durchläuft.

## Schritt 11: Host-Key auslesen

Direkt auf dem Server, damit kein Man-in-the-Middle den Wert liefern kann:

```bash
ssh-keyscan -t ed25519 localhost 2>/dev/null | sed 's|^localhost|thinkcentre|'
```

Die komplette Ausgabezeile (`thinkcentre ssh-ed25519 AAAA...`) kopieren – sie
wird in Teil 2 als `DEPLOY_SSH_HOST_KEY` hinterlegt. Der Name am Zeilenanfang muss
exakt dem `DEPLOY_HOST` aus der Pipeline entsprechen.

## Schritt 12: Tailscale

Server ins Tailnet, mit Tag:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --advertise-tags=tag:server
tailscale status
```

In der Tailscale-Admin-Konsole (Access Controls) nur SSH von `tag:ci` erlauben:

```jsonc
{
  "tagOwners": {
    "tag:ci": ["autogroup:admin"],
    "tag:server": ["autogroup:admin"]
  },
  "acls": [
    { "action": "accept", "src": ["tag:ci"], "dst": ["tag:server:22"] }
  ]
}
```

SSH sollte danach **nicht** mehr aus dem Internet erreichbar sein:

```bash
sudo ufw allow in on tailscale0 to any port 22 proto tcp
sudo ufw deny 22/tcp
# Variante A zusätzlich:
sudo ufw allow 80,443/tcp
sudo ufw enable
```

OAuth-Client für die Action anlegen: Tailscale-Konsole → Settings → OAuth clients,
Scope `auth_keys` (schreibend), Tag `tag:ci`. Client-ID und Secret notieren.

---

# Teil 2 – GitHub konfigurieren

## Schritt 13: Environment-Secrets

**Settings → Environments → New environment → `Deploy`**, dort unter
*Environment secrets*:

| Secret                | Wert                                                                  |
| --------------------- | --------------------------------------------------------------------- |
| `TS_OAUTH_CLIENT_ID`  | Tailscale OAuth-Client-ID                                             |
| `TS_OAUTH_SECRET`     | zugehöriges Secret                                                    |
| `DEPLOY_SSH_KEY`      | **kompletter** Inhalt von `mre_deploy_key` (privat, inkl. BEGIN/END)   |
| `DEPLOY_SSH_HOST_KEY` | die Zeile aus Schritt 11                                              |

Der private Key muss vollständig hinein, inklusive der Zeilen
`-----BEGIN OPENSSH PRIVATE KEY-----` und `-----END OPENSSH PRIVATE KEY-----`:

```bash
cat ./mre_deploy_key       # Ausgabe komplett kopieren
```

> Diese Secrets gehören ins **Environment**, nicht unter *Repository secrets* –
> der Deploy-Job läuft mit `environment: Deploy` und sieht sonst leere Werte.

## Schritt 14: Variables

**Settings → Secrets and variables → Actions → Variables:**

| Variable      | Wert         |
| ------------- | ------------ |
| `DEPLOY_HOST` | `thinkcentre` |
| `DEPLOY_USER` | `mre-deploy` |

Ohne diese Variables gelten die Defaults `thinkcentre` / `jp`.

## Schritt 15: Freigabe erzwingen (empfohlen)

Im Environment `Deploy` unter *Deployment protection rules* → *Required reviewers*
dich selbst eintragen. Die Pipeline baut und signiert dann durch, pausiert aber
vor dem Deploy-Job und wartet auf deine Freigabe.

---

# Teil 3 – Testen

```bash
git tag v0.2.0
git push origin v0.2.0
```

In GitHub Actions verfolgen: `build` (9 Services parallel) → ggf. Freigabe →
`deploy`. Auf dem Server gegenprüfen:

```bash
cat /opt/microrealestate/.deployed-version    # -> v0.2.0
curl -s http://localhost:8080/health
```

Ab jetzt ist jedes `git push origin vX.Y.Z` ein Deployment.

---

# Betrieb

**Logs ansehen**

```bash
sudo -iu mre-deploy
cd /opt/microrealestate
docker compose -f docker-compose.yml -f deployment/docker-compose.images.yml logs -f gateway api
```

**Manuelles Rollback** auf eine ältere Version:

```bash
MRE_DEPLOY_CONFIG=/etc/microrealestate/deploy.conf \
  /opt/microrealestate/deployment/deploy.sh v0.1.0
```

**Datenbank sichern**

```bash
cd /opt/microrealestate
docker compose run --rm mongo /usr/bin/mongodump \
  --uri=mongodb://mongo/mredb --gzip \
  --archive=./backup/mredb-$(date +%F_%H%M%S).dump
```

**`deploy.sh` aktualisieren** (nach Änderungen im Repo):

```bash
sudo -iu mre-deploy
cd /opt/microrealestate
curl -fsSL https://raw.githubusercontent.com/jpfrehe/microrealestate/master/deployment/deploy.sh \
  -o deployment/deploy.sh
chmod 755 deployment/deploy.sh
```

---

# Troubleshooting

| Fehler                                                | Ursache / Abhilfe                                                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `can't connect without a private SSH key or password` | Das SSH-Secret ist leer – meist, weil es als Repository-Secret statt als Environment-Secret hinterlegt ist (Schritt 13)      |
| `Load key ...: invalid format`                        | Der private Key wurde unvollständig kopiert (BEGIN-/END-Zeile fehlt)                                                        |
| `Host key verification failed`                        | `DEPLOY_SSH_HOST_KEY` passt nicht zum Namen in `DEPLOY_HOST` – Schritt 11 wiederholen                                       |
| `Permission denied (publickey)`                       | Public-Key steht nicht in `~mre-deploy/.ssh/authorized_keys`, oder die Rechte sind zu offen (`700` auf `.ssh`, `600` auf der Datei) |
| `ungültiges Tag 'xyz'`                                | Es wurde etwas anderes als `vX.Y.Z` gesendet – bei einem manuellen Test ist das das erwartete Verhalten                      |
| `Signaturprüfung für ... fehlgeschlagen`              | Image stammt nicht aus dem `deploy.yml`-Workflow dieses Repos, oder das Tag wurde nachträglich verschoben                    |
| `manifest unknown` / `denied` beim Pull               | `IMAGE_NAMESPACE` falsch, Images für dieses Tag nie gebaut, oder `docker login` fehlt (Schritt 8)                            |
| `port is already allocated` beim Start                | Variante A mit gesetztem `APP_PORT` – Caddy und Gateway kollidieren auf 8080 (Schritt 5)                                     |
| Health-Check läuft in den Rollback                    | `docker compose logs` ansehen; meist fehlende/fehlerhafte Werte in `.env`                                                    |
| `ein anderes Deployment läuft bereits`                | Paralleler Lauf – oder eine abgebrochene Session hält `/tmp/mre-deploy.lock`                                                 |
