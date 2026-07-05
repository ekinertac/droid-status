#!/bin/sh
# Installs droid-status as a launchd LaunchAgent — the "production" mode:
# starts at login, auto-restarts on crash, logs to ~/Library/Logs.
# Generates the plist at install time so no absolute paths live in the repo:
# the repo location, node binary, and PATH are all taken from the machine
# running this script. Re-running is safe (it replaces the existing agent).
# A user LaunchAgent (not a system daemon) is deliberate: the limits
# collector reads the Claude OAuth token from the login Keychain, which is
# only unlocked inside a logged-in user session.
# Manage after install:
#   launchctl kickstart -k gui/$(id -u)/com.droid-status   # restart (after edits)
#   launchctl bootout gui/$(id -u)/com.droid-status        # stop (then: npm start for dev)
set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
LABEL="com.droid-status"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/droid-status.log"

[ -n "$NODE" ] || { echo "node not found in PATH" >&2; exit 1; }

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$PATH</string>
    <key>HOME</key>
    <string>$HOME</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL"
echo "  plist: $PLIST"
echo "  logs:  $LOG"
