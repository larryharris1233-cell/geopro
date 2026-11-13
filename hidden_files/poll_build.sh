#!/bin/bash
# usage: poll_build.sh <build-id>
cd /home/hatch/workspace/trucker-app/geopro
TOKEN=$(python3 -c "
import sys; sys.path.insert(0,'/opt/hatch/skills/skill-creator/bin')
import dynamic_credentials as dc
print(dc.dynamic_credential_entry('custom.expo','access_token')['surrogate'])")
export EXPO_TOKEN="$TOKEN" CI=1
for i in $(seq 1 25); do
  OUT=$(npx -y eas-cli@latest build:view "$1" --json 2>/dev/null)
  STATUS=$(echo "$OUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)
  echo "check $i: $STATUS"
  if [ "$STATUS" = "FINISHED" ]; then
    echo "$OUT" | python3 -c "import sys,json; d=json.load(sys.stdin); a=d.get('artifacts') or {}; print('APK:', a.get('buildUrl') or a.get('applicationArchiveUrl'))"
    exit 0
  fi
  if [ "$STATUS" = "ERRORED" ] || [ "$STATUS" = "CANCELED" ]; then echo "BUILD $STATUS"; exit 1; fi
  sleep 120
done
echo "TIMEOUT still not finished"
