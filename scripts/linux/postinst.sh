#!/bin/sh
# Debian postinst — enable and start the systemd service.
set -e

mkdir -p /var/lib/myhomegames-server

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl enable myhomegames-server.service >/dev/null 2>&1 || true
  if systemctl is-active --quiet myhomegames-server.service 2>/dev/null; then
    systemctl restart myhomegames-server.service >/dev/null 2>&1 || true
  else
    systemctl start myhomegames-server.service >/dev/null 2>&1 || true
  fi
fi

exit 0
