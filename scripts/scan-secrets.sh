#!/usr/bin/env bash
#
# Scans the entire git history and the working tree for credentials.
#
# Runs before the repository is made public, and again after the session
# transcripts are added under docs/ai-sessions, because those transcripts
# contain tool output that was never reviewed line by line.
#
# Two passes. The first looks for credential shapes, which catches secrets this
# machine has never seen. The second compares against the literal values in
# .env.local, which catches anything whose shape is not distinctive. Neither pass
# ever prints a secret: findings report the file, the commit and the variable
# name only.
set -uo pipefail

RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
findings=0

# The throwaway credential of the local docker container and the CI service
# container. It is committed on purpose, in .env.example and in the workflow, and
# it grants access to an ephemeral database that holds nothing. Filtering it here
# keeps a real finding from being buried in known noise; anything else that looks
# like a connection string still reports.
LOCAL_DB_CREDENTIAL='postgres:postgres@localhost'

# Two values that were invented to break things on purpose. They appear in the
# session transcripts under docs/ai-sessions, where the negative tests that
# proved the build check and the bundle check actually fire are recorded.
# Excluding them by name keeps the scan's signal clean; excluding them by pattern
# would blunt the very checks they demonstrate.
FAKE_GEMINI_KEY='AQ.thisisnotarealkeyatallbutlooksplausible'
FAKE_BLOB_TOKEN='vercel_blob_rw_fake_token_value_here_1234'

echo "== Pass 1: credential shapes in history and working tree =="

# Deliberately broad. False positives are cheap to dismiss, a missed key is not.
patterns=(
  'ghp_[A-Za-z0-9]{20,}'
  'gho_[A-Za-z0-9]{20,}'
  'github_pat_[A-Za-z0-9_]{20,}'
  'sk-[A-Za-z0-9]{20,}'
  'AIza[A-Za-z0-9_-]{30,}'
  'AQ\.[A-Za-z0-9_-]{30,}'
  'vercel_blob_rw_[A-Za-z0-9_]{20,}'
  'postgres(ql)?://[^[:space:]"'"'"']+:[^[:space:]"'"'"']+@'
  'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.'
)

for pattern in "${patterns[@]}"; do
  # -I skips binaries; the pathspec keeps lockfiles and build output out.
  hits=$(git grep -I -n -E "$pattern" $(git rev-list --all) -- \
          ':!package-lock.json' ':!*.map' 2>/dev/null \
          | grep -vF "$LOCAL_DB_CREDENTIAL" \
          | grep -vF "$FAKE_GEMINI_KEY" \
          | grep -vF "$FAKE_BLOB_TOKEN" | head -5)
  if [ -n "$hits" ]; then
    echo "${RED}  FOUND${RESET} pattern /$pattern/"
    # Only the location is printed, never the matching text.
    echo "$hits" | sed -E 's/:[0-9]+:.*$//' | sort -u | sed 's/^/    /'
    findings=$((findings + 1))
  else
    echo "${GREEN}  clean${RESET} /$pattern/"
  fi
done

echo
echo "== Pass 2: literal values from .env.local =="

# Both files: .env.local holds development values, .env.production.local holds
# the production database credentials pulled for seeding. The second is the one
# that would actually matter.
for envfile in .env.local .env.production.local; do
  if [ ! -f "$envfile" ]; then
    echo "  $envfile not present, skipping"
    continue
  fi
  echo "  -- $envfile --"
  while IFS='=' read -r name value; do
    case "$name" in ''|\#*) continue ;; esac
    value="${value%\"}"; value="${value#\"}"
    [ ${#value} -ge 12 ] || continue
    case "$value" in *"$LOCAL_DB_CREDENTIAL"*) echo "${GREEN}  skipped${RESET} $name (throwaway local container credential)"; continue ;; esac
    hits=$(git grep -I -l -F "$value" $(git rev-list --all) 2>/dev/null | head -3)
    if [ -n "$hits" ]; then
      echo "${RED}  FOUND${RESET} value of $name in history:"
      echo "$hits" | sed 's/^/    /'
      findings=$((findings + 1))
    else
      echo "${GREEN}  clean${RESET} $name"
    fi
  done < "$envfile"
done

echo
if [ "$findings" -gt 0 ]; then
  echo "${RED}$findings finding(s). Do not make the repository public.${RESET}"
  exit 1
fi
echo "${GREEN}No credentials found in history or working tree.${RESET}"
