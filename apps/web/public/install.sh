#!/usr/bin/env bash
# holo installer — clones the repo, generates a .env with random secrets,
# and boots the local docker compose stack.
#
# Usage:
#   curl -fsSL https://holobase.dev/install.sh | bash
#
# Env overrides:
#   HOLO_REPO    git remote          (default: https://github.com/maakle/holo.git)
#   HOLO_DIR     target directory    (default: holo)
#   HOLO_BRANCH  branch / ref        (default: main)
set -euo pipefail

HOLO_REPO="${HOLO_REPO:-https://github.com/maakle/holo.git}"
HOLO_DIR="${HOLO_DIR:-holo}"
HOLO_BRANCH="${HOLO_BRANCH:-main}"

c_bold=$'\033[1m'; c_dim=$'\033[2m'; c_red=$'\033[1;31m'; c_grn=$'\033[1;32m'; c_rst=$'\033[0m'
step() { printf "%s→%s %s\n" "$c_bold" "$c_rst" "$*"; }
ok()   { printf "%s✓%s %s\n" "$c_grn" "$c_rst" "$*"; }
die()  { printf "%sError:%s %s\n" "$c_red" "$c_rst" "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing prerequisite: $1"; }

step "Checking prerequisites"
need git
need docker
need openssl
docker compose version >/dev/null 2>&1 || die "docker compose v2 is required (install Docker Desktop or the compose plugin)"

if [ -d "$HOLO_DIR/.git" ]; then
  step "Found existing checkout at ./$HOLO_DIR — pulling latest"
  git -C "$HOLO_DIR" pull --ff-only
else
  step "Cloning holo into ./$HOLO_DIR"
  git clone --depth 1 --branch "$HOLO_BRANCH" "$HOLO_REPO" "$HOLO_DIR"
fi

cd "$HOLO_DIR"

sed_inplace() {
  if sed --version >/dev/null 2>&1; then sed -i "$@"; else sed -i '' "$@"; fi
}

if [ ! -f .env ]; then
  step "Generating .env with random secrets"
  cp .env.example .env
  pg_pass="$(openssl rand -hex 16)"
  token_key="$(openssl rand -base64 32)"
  auth_secret="$(openssl rand -base64 32)"
  sed_inplace "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${pg_pass}|" .env
  sed_inplace "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://holo:${pg_pass}@localhost:5436/holo|" .env
  sed_inplace "s|^HOLO_TOKEN_ENCRYPTION_KEY=.*|HOLO_TOKEN_ENCRYPTION_KEY=${token_key}|" .env
  sed_inplace "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=${auth_secret}|" .env
  ok ".env created (edit it to add ANTHROPIC_API_KEY and OAuth credentials)"
else
  step "Using existing .env"
fi

step "Booting holo (docker compose up -d) — first run pulls images and may take a minute"
docker compose up -d

printf "\n"
ok "holo is starting"
printf "\n"
printf "  %sWeb%s        http://localhost:3000\n" "$c_bold" "$c_rst"
printf "  %sMCP%s        http://localhost:8080\n" "$c_bold" "$c_rst"
printf "\n"
printf "  %sLogs%s       docker compose -f %s/docker-compose.yml logs -f\n" "$c_dim" "$c_rst" "$(pwd)"
printf "  %sStop%s       docker compose -f %s/docker-compose.yml down\n" "$c_dim" "$c_rst" "$(pwd)"
printf "\n"
printf "  %sNext:%s set ANTHROPIC_API_KEY in %s/.env to enable the agent.\n" "$c_bold" "$c_rst" "$(pwd)"
