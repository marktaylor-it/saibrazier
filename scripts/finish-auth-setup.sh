#!/usr/bin/env bash
# Finishes the admin login setup once Email/Password has been enabled in the
# Firebase console. Safe to re-run.
#
#   ./scripts/finish-auth-setup.sh
#
# It does NOT create accounts or set passwords — those are credentials and
# belong to you and Sai, not to a script.
set -uo pipefail

PROJECT="saibrazier"
KEY="AIzaSyBkOn06OcIbVZEYDUO9HccghFBLb9FKIp0"
DOMAINS=("saibrazier.com" "www.saibrazier.com")

say() { printf "%s\n" "$*"; }

# --- 1. is auth initialised yet? -------------------------------------------
state=$(curl -s -X POST \
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"probe@example.invalid","password":"x","returnSecureToken":true}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('error',{}).get('message','OK'))")

case "$state" in
  CONFIGURATION_NOT_FOUND*)
    say "✗ Firebase Auth is not initialised yet."
    say ""
    say "  Do this first (about 30 seconds):"
    say "  1. https://console.firebase.google.com/project/$PROJECT/authentication"
    say "     -> Get started -> Email/Password -> Enable -> Save"
    say "  2. Users -> Add user -> sai@saibrazier.com + a temporary password"
    say ""
    say "  Then run this script again."
    exit 1 ;;
  OPERATION_NOT_ALLOWED*)
    say "✗ Auth exists but the Email/Password provider is switched off."
    say "  Turn it on: https://console.firebase.google.com/project/$PROJECT/authentication/providers"
    exit 1 ;;
  *)
    say "✓ Email/Password sign-in is live." ;;
esac

TOKEN=$(gcloud auth print-access-token 2>/dev/null)
if [ -z "$TOKEN" ]; then say "✗ Run: gcloud auth login"; exit 1; fi
API="https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT/config"
HDR=(-H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" -H "Content-Type: application/json")

# --- 2. authorised domains --------------------------------------------------
# Firebase ships only localhost and <project>.firebaseapp.com. Without the real
# domain, signing in from saibrazier.com fails with auth/unauthorized-domain.
current=$(curl -s "${HDR[@]}" "$API" | python3 -c "import json,sys;print(json.dumps(json.load(sys.stdin).get('authorizedDomains',[])))")
say "  authorised domains now: $current"

merged=$(python3 - "$current" "${DOMAINS[@]}" <<'PY'
import json,sys
have=json.loads(sys.argv[1]); want=sys.argv[2:]
for d in want:
    if d not in have: have.append(d)
print(json.dumps({"authorizedDomains":have}))
PY
)
curl -s -X PATCH "${HDR[@]}" "$API?updateMask=authorizedDomains" -d "$merged" \
 | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  ✗', d['error']['message'][:120]) if 'error' in d else print('  ✓ authorised domains:', d.get('authorizedDomains'))"

# --- 3. who can edit --------------------------------------------------------
say ""
say "  Accounts that exist:"
firebase auth:export /tmp/sb-users.json --project "$PROJECT" >/dev/null 2>&1
python3 - <<'PY'
import json
try:
    us=json.load(open('/tmp/sb-users.json')).get('users',[])
    if not us: print('   (none yet — add sai@saibrazier.com in the console)')
    for u in us:
        print(f"   - {u.get('email')}  uid={u.get('localId')}")
except Exception:
    print('   (could not read)')
PY
rm -f /tmp/sb-users.json
say ""
say "  Sai signs in at https://saibrazier.com/admin/"
say "  He should use 'Forgot password' there to set a password only he knows."
