#!/bin/bash
# Mint REAL Keycloak access tokens from the local dev realm (Phase 8a) and
# dump their realm roles — proof the login path works end to end.
#
# Usage: bash docker/keycloak/verify-login.sh [staff|regular]
set -uo pipefail
BASE="http://127.0.0.1:8080/realms/asv-portal/protocol/openid-connect/token"
CLIENT="asv-portal"
SECRET="${KEYCLOAK_CLIENT_SECRET:-dev-asv-client-secret-change-me}"
WHO="${1:-staff}"

if [ "$WHO" = "staff" ]; then
  USER="staff-user"; PASS="staff123"
else
  USER="regular-user"; PASS="user123"
fi

TOKEN=$(curl -fsS -X POST "$BASE" \
  -d "grant_type=password" -d "client_id=$CLIENT" \
  -d "client_secret=$SECRET" -d "username=$USER" -d "password=$PASS" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "== $USER login OK; token claims =="
python3 - "$TOKEN" <<'PY'
import base64, json, sys
t = sys.argv[1].split(".")[1]
t += "=" * (-len(t) % 4)
claims = json.loads(base64.urlsafe_b64decode(t))
print("sub:", claims.get("sub"))
print("email:", claims.get("email"))
print("realm roles:", claims.get("realm_access", {}).get("roles"))
PY
echo "$TOKEN"