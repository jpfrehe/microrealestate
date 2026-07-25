#!/usr/bin/env bash
###############################################################################
# MicroRealEstate – Deployment-Skript für den Zielserver
#
# Wird ausschließlich über den SSH forced command des Deploy-Users gestartet:
#
#   command="/opt/microrealestate/deployment/deploy.sh",restrict ssh-ed25519 AAAA... ci@github
#
# Die GitHub-Action übergibt dabei nur das Release-Tag (z.B. "v1.4.0"), das in
# $SSH_ORIGINAL_COMMAND landet. Ein anderer Befehl kann über diesen Key nicht
# ausgeführt werden – der Key ist damit auf "deploye genau ein Tag" beschränkt.
#
# Konfiguration: /etc/microrealestate/deploy.conf (siehe deployment/README.md)
###############################################################################
set -euo pipefail

CONFIG_FILE="${MRE_DEPLOY_CONFIG:-/etc/microrealestate/deploy.conf}"

# --- Defaults, per deploy.conf überschreibbar --------------------------------
APP_DIR="/opt/microrealestate"
# Leerzeichen-getrennte Liste; das Overlay biegt die Images auf IMAGE_NAMESPACE um
COMPOSE_FILES="docker-compose.yml deployment/docker-compose.images.yml"
IMAGE_NAMESPACE=""
GITHUB_REPOSITORY=""
VERIFY_SIGNATURES="true"
HEALTHCHECK_URL="http://localhost:8080/health"
HEALTHCHECK_RETRIES="30"
HEALTHCHECK_DELAY="5"
GHCR_USER=""
GHCR_TOKEN=""
PRUNE_IMAGES="true"

# shellcheck source=/dev/null
[ -r "$CONFIG_FILE" ] && . "$CONFIG_FILE"

LOCK_FILE="${MRE_DEPLOY_LOCK:-/tmp/mre-deploy.lock}"
VERSION_FILE="$APP_DIR/.deployed-version"

log() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

###############################################################################
# 1. Eingabe validieren
#
# Der Tag ist der einzige von außen steuerbare Wert. Er wird strikt gegen ein
# Semver-Muster geprüft, bevor er in Docker-/Compose-Aufrufe fließt.
###############################################################################
REQUESTED_TAG="${SSH_ORIGINAL_COMMAND:-${1:-}}"
REQUESTED_TAG="${REQUESTED_TAG//[$'\t\r\n']/ }"
REQUESTED_TAG="$(printf '%s' "$REQUESTED_TAG" | tr -s ' ' | sed -e 's/^ *//' -e 's/ *$//')"

[ -n "$REQUESTED_TAG" ] || fail "kein Tag übergeben (SSH_ORIGINAL_COMMAND ist leer)"

if ! [[ "$REQUESTED_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  fail "ungültiges Tag '$REQUESTED_TAG' (erwartet: vX.Y.Z bzw. vX.Y.Z-suffix)"
fi

TAG="$REQUESTED_TAG"

[ -n "$IMAGE_NAMESPACE" ] || fail "IMAGE_NAMESPACE ist nicht gesetzt (siehe $CONFIG_FILE)"
[ -d "$APP_DIR" ] || fail "APP_DIR '$APP_DIR' existiert nicht"
[ -r "$APP_DIR/.env" ] || fail "'$APP_DIR/.env' nicht lesbar"

# Compose-Dateien in -f Argumente übersetzen
COMPOSE_ARGS=()
for file in $COMPOSE_FILES; do
  [ -r "$APP_DIR/$file" ] || fail "Compose-Datei '$APP_DIR/$file' nicht lesbar"
  COMPOSE_ARGS+=(-f "$file")
done

# Der Namespace muss auch für docker compose selbst sichtbar sein
export MRE_IMAGE_NAMESPACE="$IMAGE_NAMESPACE"

###############################################################################
# 2. Nur ein Deployment gleichzeitig
###############################################################################
exec 9>"$LOCK_FILE"
flock -n 9 || fail "ein anderes Deployment läuft bereits"

cd "$APP_DIR"

log "Deployment von $TAG gestartet"

PREVIOUS_VERSION="$(grep -E '^MRE_VERSION=' .env | head -n1 | cut -d= -f2- | tr -d '"' | awk '{print $1}' || true)"
[ -n "$PREVIOUS_VERSION" ] || PREVIOUS_VERSION="latest"
log "aktuell deployte Version: $PREVIOUS_VERSION"

###############################################################################
# 3. Registry-Login (nur nötig, wenn die Packages privat sind)
###############################################################################
if [ -n "$GHCR_TOKEN" ]; then
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
  log "an ghcr.io angemeldet als $GHCR_USER"
fi

###############################################################################
# 4. MRE_VERSION in .env setzen (atomar, Rechte bleiben erhalten)
###############################################################################
set_version() {
  local version="$1" tmp
  tmp="$(mktemp "$APP_DIR/.env.XXXXXX")"
  chmod --reference=.env "$tmp"
  if grep -qE '^MRE_VERSION=' .env; then
    sed -E "s|^MRE_VERSION=.*|MRE_VERSION=${version}|" .env > "$tmp"
  else
    cat .env > "$tmp"
    printf 'MRE_VERSION=%s\n' "$version" >> "$tmp"
  fi
  mv -f "$tmp" .env
}

set_version "$TAG"

###############################################################################
# 5. Images ziehen
###############################################################################
log "ziehe Images für $TAG"
if ! docker compose "${COMPOSE_ARGS[@]}" pull --quiet; then
  set_version "$PREVIOUS_VERSION"
  fail "docker compose pull fehlgeschlagen – .env auf $PREVIOUS_VERSION zurückgesetzt"
fi

###############################################################################
# 6. Signaturen prüfen (cosign keyless / OIDC)
#
# Die Images werden in der Pipeline mit cosign signiert. Hier wird geprüft, dass
# jedes Image tatsächlich aus dem erwarteten Workflow dieses Repos stammt –
# ohne diesen Schritt würde der Server jedes Image akzeptieren, das unter dem
# Tag in der Registry liegt.
###############################################################################
if [ "$VERIFY_SIGNATURES" = "true" ]; then
  command -v cosign >/dev/null || fail "cosign nicht installiert (oder VERIFY_SIGNATURES=false setzen)"
  [ -n "$GITHUB_REPOSITORY" ] || fail "GITHUB_REPOSITORY muss für die Signaturprüfung gesetzt sein"

  IDENTITY="^https://github.com/${GITHUB_REPOSITORY}/\\.github/workflows/deploy\\.yml@refs/tags/${TAG}$"

  while read -r image; do
    [ -n "$image" ] || continue
    log "prüfe Signatur: $image"
    if ! cosign verify \
      --certificate-identity-regexp "$IDENTITY" \
      --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
      "$image" >/dev/null 2>&1; then
      set_version "$PREVIOUS_VERSION"
      fail "Signaturprüfung für $image fehlgeschlagen – Deployment abgebrochen"
    fi
  done < <(docker compose "${COMPOSE_ARGS[@]}" config --images | grep -F "$IMAGE_NAMESPACE/" | sort -u)

  log "alle Signaturen gültig"
fi

###############################################################################
# 7. Container neu starten
###############################################################################
rollback() {
  log "Rollback auf $PREVIOUS_VERSION"
  set_version "$PREVIOUS_VERSION"
  docker compose "${COMPOSE_ARGS[@]}" up -d --remove-orphans || true
}

log "starte Container neu"
if ! docker compose "${COMPOSE_ARGS[@]}" up -d --remove-orphans; then
  rollback
  fail "docker compose up fehlgeschlagen – Rollback ausgeführt"
fi

###############################################################################
# 8. Health-Check – schlägt er fehl, wird zurückgerollt
###############################################################################
log "warte auf Health-Check ($HEALTHCHECK_URL)"
healthy="false"
for attempt in $(seq 1 "$HEALTHCHECK_RETRIES"); do
  if curl -fsS --max-time 10 "$HEALTHCHECK_URL" >/dev/null 2>&1; then
    healthy="true"
    log "Anwendung ist gesund (Versuch $attempt)"
    break
  fi
  sleep "$HEALTHCHECK_DELAY"
done

if [ "$healthy" != "true" ]; then
  rollback
  fail "Health-Check nach $((HEALTHCHECK_RETRIES * HEALTHCHECK_DELAY))s fehlgeschlagen – Rollback ausgeführt"
fi

###############################################################################
# 9. Aufräumen
###############################################################################
printf '%s\n' "$TAG" > "$VERSION_FILE"

if [ "$PRUNE_IMAGES" = "true" ]; then
  docker image prune -f >/dev/null 2>&1 || true
fi

log "Deployment von $TAG erfolgreich abgeschlossen"
