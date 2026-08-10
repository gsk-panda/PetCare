#!/usr/bin/env bash
# Deploy the current master onto the Lightsail instance. Run over SSH, either
# by hand or from CI:
#
#   ssh ubuntu@<host> 'bash -s' < deploy/remote-deploy.sh
#
# Idempotent: safe to run when nothing has changed.
set -euo pipefail

APP_DIR=/opt/petcare
HEALTH_URL=http://127.0.0.1:3001/health

cd "$APP_DIR"
before=$(git rev-parse HEAD)
git fetch --quiet origin master
git reset --quiet --hard origin/master
after=$(git rev-parse HEAD)
echo "deploying ${after:0:7} (was ${before:0:7})"

# Built on the instance rather than pulled from a registry: one moving part
# fewer while this is a staging box. Move to a registry when build time on a
# 2 GB instance starts to hurt.
sudo docker build --quiet -t petcare:latest "$APP_DIR" > /dev/null

sudo systemctl restart petcare

# A restart that comes back unhealthy is a failed deploy, not a finished one.
for i in $(seq 1 30); do
  if curl -fsS --max-time 3 "$HEALTH_URL" > /dev/null 2>&1; then
    echo "healthy after ${i}s"
    sudo docker image prune -f > /dev/null
    exit 0
  fi
  sleep 1
done

echo "health check never passed; recent logs:" >&2
sudo journalctl -u petcare -n 40 --no-pager >&2
exit 1
