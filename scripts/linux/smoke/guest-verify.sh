#!/usr/bin/env bash
# Run inside a Linux guest after installing myhomegames-server (.deb or .rpm).
# Exit 0 only if enable/start/stop/HTTP checks pass.
set -euo pipefail

UNIT=myhomegames-server
PORT="${MHG_HTTP_PORT:-4000}"

echo "== unit file =="
systemctl cat "${UNIT}.service" >/dev/null
echo "OK: unit loaded"

echo "== enabled =="
enabled="$(systemctl is-enabled "$UNIT")"
echo "is-enabled=$enabled"
test "$enabled" = "enabled"

echo "== active after install (or start) =="
if ! systemctl is-active --quiet "$UNIT"; then
  sudo systemctl start "$UNIT"
  sleep 3
fi
systemctl is-active --quiet "$UNIT"
echo "OK: active"

echo "== stop =="
sudo systemctl stop "$UNIT"
sleep 1
test "$(systemctl is-active "$UNIT" || true)" = "inactive"
echo "OK: inactive"

echo "== start =="
sudo systemctl start "$UNIT"
sleep 5
systemctl is-active --quiet "$UNIT"
echo "OK: active again"

echo "== HTTP :${PORT} =="
# Server may need a few more seconds for first boot / sidecar downloads.
for _ in 1 2 3 4 5 6; do
  if curl -sS -o /dev/null --max-time 3 "http://127.0.0.1:${PORT}/"; then
    break
  fi
  sleep 3
done
code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT}/" || true)"
echo "HTTP $code"
case "$code" in
  200|301|302|401|403|404) ;;
  *)
    echo "FAIL: unexpected HTTP status (is the server listening?)"
    journalctl -u "$UNIT" -n 40 --no-pager || true
    exit 1
    ;;
esac

echo "== status =="
systemctl status "$UNIT" --no-pager -l || true
echo "ALL CHECKS PASSED"
