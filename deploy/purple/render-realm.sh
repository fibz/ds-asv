#!/usr/bin/env bash
set -euo pipefail

: "${PUBLIC_HOST:?set PUBLIC_HOST, e.g. 74.156.0.13:8443}"
: "${KEYCLOAK_CLIENT_SECRET:?set KEYCLOAK_CLIENT_SECRET}"
: "${STAFF_PASSWORD:?set STAFF_PASSWORD}"
: "${REGULAR_PASSWORD:?set REGULAR_PASSWORD}"

sed \
  -e "s|__PUBLIC_HOST__|${PUBLIC_HOST}|g" \
  -e "s|__KEYCLOAK_CLIENT_SECRET__|${KEYCLOAK_CLIENT_SECRET}|g" \
  -e "s|__STAFF_PASSWORD__|${STAFF_PASSWORD}|g" \
  -e "s|__REGULAR_PASSWORD__|${REGULAR_PASSWORD}|g" \
  realm.template.json > realm.json

chmod 600 realm.json
