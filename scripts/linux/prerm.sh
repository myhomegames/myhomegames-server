#!/bin/sh
# Debian prerm — stop (and on remove, disable) the systemd service.
set -e

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop myhomegames-server.service >/dev/null 2>&1 || true
  case "$1" in
    remove|purge)
      systemctl disable myhomegames-server.service >/dev/null 2>&1 || true
      ;;
  esac
fi

exit 0
