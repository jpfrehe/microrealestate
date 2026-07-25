# Deployment auf den eigenen Server

Dieses Verzeichnis enthält alles, was auf dem Zielserver liegen muss, damit die
GitHub-Pipeline (`.github/workflows/deploy.yml`) ein Deployment auslösen kann.

## Ablauf

```
git tag v1.4.0 && git push --tags
        │
        ▼
GitHub Actions: build → Trivy-Scan → cosign-Signatur → Push nach GHCR
        │
        ▼
Tailscale (ephemerer CI-Node, tag:ci)  ──SSH──▶  Server
                                                    │  forced command
                                                    ▼
                                          deployment/deploy.sh v1.4.0
                                          → cosign verify
                                          → docker compose pull / up -d
                                          → Health-Check (Rollback bei Fehler)
```

Der CI-Key kann auf dem Server **nichts anderes** als `deploy.sh` starten, und
`deploy.sh` akzeptiert als einziges Argument ein Semver-Tag. Ein kompromittierter
Runner kann damit maximal ein bereits signiertes Release deployen – keine
beliebigen Befehle ausführen.

---

## 1. Server vorbereiten

### 1.1 Deploy-User und Verzeichnis

```bash
sudo useradd -m -s /bin/bash mre-deploy
sudo usermod -aG docker mre-deploy          # darf docker compose ausführen

sudo mkdir -p /opt/microrealestate
sudo chown -R mre-deploy:mre-deploy /opt/microrealestate
```

Der User `mre-deploy` braucht **kein** sudo. Die Docker-Gruppe ist faktisch
root-äquivalent – deshalb ist die Beschränkung über den forced command (Schritt
1.3) der eigentliche Schutz.

### 1.2 Anwendung einmalig einrichten

```bash
sudo -iu mre-deploy
cd /opt/microrealestate

RAW=https://raw.githubusercontent.com/jpfrehe/microrealestate/master

curl -O "$RAW/docker-compose.yml"
curl "$RAW/.env.domain" > .env

# .env anpassen: Secrets, APP_DOMAIN, MRE_VERSION bleibt auf latest
# (wird ab jetzt von deploy.sh gepflegt)
chmod 600 .env

# deploy.sh und das Image-Overlay aus dem Repo holen
mkdir -p deployment
curl -o deployment/deploy.sh "$RAW/deployment/deploy.sh"
curl -o deployment/docker-compose.images.yml "$RAW/deployment/docker-compose.images.yml"
chmod 755 deployment/deploy.sh
```

> **Wichtig:** `docker-compose.yml` zeigt fest auf die Images des
> Upstream-Projekts (`ghcr.io/microrealestate/microrealestate/*`). Das Overlay
> `deployment/docker-compose.images.yml` biegt sie auf den Namespace aus
> `IMAGE_NAMESPACE` (Schritt 1.3) um – deshalb lädt `deploy.sh` immer beide
> Dateien. Für einen manuellen Start entsprechend:
>
> ```bash
> MRE_IMAGE_NAMESPACE=ghcr.io/jpfrehe/microrealestate \
>   docker compose -f docker-compose.yml -f deployment/docker-compose.images.yml up -d
> ```

Sind die Packages in GHCR privat, einmalig anmelden (Token mit `read:packages`):

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u jpfrehe --password-stdin
```

`cosign` für die Signaturprüfung installieren:

```bash
sudo curl -Lo /usr/local/bin/cosign \
  https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64
sudo chmod +x /usr/local/bin/cosign
```

### 1.3 Konfiguration des Deploy-Skripts

```bash
sudo mkdir -p /etc/microrealestate
sudo tee /etc/microrealestate/deploy.conf > /dev/null <<'EOF'
APP_DIR=/opt/microrealestate
COMPOSE_FILES="docker-compose.yml deployment/docker-compose.images.yml"
IMAGE_NAMESPACE=ghcr.io/jpfrehe/microrealestate
GITHUB_REPOSITORY=jpfrehe/microrealestate
VERIFY_SIGNATURES=true
HEALTHCHECK_URL=http://localhost:8080/health
EOF
sudo chmod 644 /etc/microrealestate/deploy.conf
```

### 1.4 SSH-Key mit forced command

Schlüsselpaar **lokal** (nicht auf dem Server) erzeugen:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ./mre_deploy_key -N ""
```

Public-Key auf dem Server eintragen – die Optionen vor dem Key sind der
entscheidende Teil:

```bash
sudo -iu mre-deploy
mkdir -p ~/.ssh && chmod 700 ~/.ssh
cat >> ~/.ssh/authorized_keys <<'EOF'
command="/opt/microrealestate/deployment/deploy.sh",restrict ssh-ed25519 AAAA...HIER_DER_PUBLIC_KEY... github-actions-deploy
EOF
chmod 600 ~/.ssh/authorized_keys
```

`restrict` schaltet Port-/Agent-/X11-Forwarding und PTY-Zuweisung ab,
`command=` erzwingt `deploy.sh` unabhängig davon, was der Client sendet – das
gesendete Tag landet lediglich in `$SSH_ORIGINAL_COMMAND`.

Testen (der Key darf nichts anderes können):

```bash
ssh -i ./mre_deploy_key mre-deploy@thinkcentre "whoami"   # -> Fehler: ungültiges Tag
ssh -i ./mre_deploy_key mre-deploy@thinkcentre "v1.4.0"   # -> deployt v1.4.0
```

### 1.5 Tailscale

Server im Tailnet, GitHub-Runner tritt als ephemerer Node mit `tag:ci` bei. In
der Tailscale-ACL nur SSH von `tag:ci` auf den Server erlauben:

```jsonc
{
  "tagOwners": {
    "tag:ci": ["autogroup:admin"],
    "tag:server": ["autogroup:admin"]
  },
  "acls": [
    {
      "action": "accept",
      "src": ["tag:ci"],
      "dst": ["tag:server:22"]
    }
  ]
}
```

Der Server sollte den Tag `tag:server` tragen und Port 22 **nicht** im Internet
exponieren – der Zugriff läuft ausschließlich über das Tailnet.

Der OAuth-Client für die Action braucht den Scope `auth_keys` (bzw. `devices`)
und muss `tag:ci` besitzen dürfen.

---

## 2. GitHub konfigurieren

**Settings → Environments → `Deploy` → Secrets** (nicht als Repository-Secret
anlegen – der Deploy-Job läuft im Environment `Deploy`):

| Secret                | Inhalt                                                             |
| --------------------- | ------------------------------------------------------------------ |
| `TS_OAUTH_CLIENT_ID`  | Tailscale OAuth-Client-ID                                          |
| `TS_OAUTH_SECRET`     | zugehöriges Secret                                                 |
| `DEPLOY_SSH_KEY`      | kompletter Inhalt von `mre_deploy_key` (privater Key, inkl. Header) |
| `DEPLOY_SSH_HOST_KEY` | Host-Key-Zeile des Servers (siehe unten)                           |

Host-Key ermitteln – am besten direkt auf dem Server, damit kein
Man-in-the-Middle den Wert liefern kann:

```bash
# auf dem Server:
ssh-keyscan -t ed25519 localhost | sed 's/^localhost/thinkcentre/'
# Ergebnis (eine Zeile: "thinkcentre ssh-ed25519 AAAA...") als DEPLOY_SSH_HOST_KEY hinterlegen
```

**Settings → Variables → Actions** (optional, wenn abweichend von den Defaults
`thinkcentre` / `jp`):

| Variable      | Beispiel     |
| ------------- | ------------ |
| `DEPLOY_HOST` | `thinkcentre` |
| `DEPLOY_USER` | `mre-deploy` |

Empfohlen: im Environment `Deploy` unter *Deployment protection rules* einen
*Required reviewer* eintragen. Dann pausiert die Pipeline vor dem Deploy-Job und
wartet auf eine Freigabe.

---

## 3. Deployment auslösen

```bash
git tag v1.4.0
git push origin v1.4.0
```

Die Pipeline baut, scannt, signiert und pusht die Images und ruft anschließend
`deploy.sh` auf dem Server auf. Schlägt der Health-Check fehl, rollt `deploy.sh`
automatisch auf die vorher deployte Version zurück und beendet sich mit
Exit-Code ≠ 0 – der GitHub-Job wird dadurch rot.

Die zuletzt erfolgreich deployte Version steht in
`/opt/microrealestate/.deployed-version`.

---

## Troubleshooting

| Fehler                                                | Ursache                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `can't connect without a private SSH key or password` | Das SSH-Secret ist leer – meist, weil es als Environment-Secret hinterlegt ist, der Job aber kein `environment:` deklariert |
| `Load key ...: invalid format`                        | Beim Kopieren des privaten Keys fehlt die abschließende Leerzeile                                 |
| `Host key verification failed`                        | `DEPLOY_SSH_HOST_KEY` passt nicht zum Hostnamen in `DEPLOY_HOST`                                  |
| `ungültiges Tag`                                      | Es wurde etwas anderes als `vX.Y.Z` gesendet – oder der forced command greift korrekt              |
| `Signaturprüfung für ... fehlgeschlagen`              | Image stammt nicht aus dem `deploy.yml`-Workflow dieses Repos, oder das Tag wurde neu gesetzt      |
| `manifest unknown` beim Pull                          | `IMAGE_NAMESPACE` in `deploy.conf` zeigt auf den falschen Namespace                                |
