#!/bin/sh
# Debian postrm — reload systemd after unit file removal.
set -e

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload >/dev/null 2>&1 || true
fi

exit 0
