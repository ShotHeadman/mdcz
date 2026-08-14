#!/bin/sh
set -eu

fail() {
  echo "mdcz: $*" >&2
  exit 1
}

validate_id() {
  name="$1"
  value="$2"

  case "$value" in
    ''|*[!0-9]*) fail "$name must be a positive numeric ID (received '$value')" ;;
  esac
  [ "$value" -ne 0 ] 2>/dev/null \
    || fail "$name must be greater than 0 (received '$value')"
  [ "$value" -le 2147483647 ] 2>/dev/null \
    || fail "$name is outside the supported Linux ID range (received '$value')"
}

validate_umask() {
  case "$UMASK" in
    ''|*[!0-7]*|?????*)
      fail "UMASK must be an octal value between 0000 and 0777 (received '$UMASK')"
      ;;
    ????)
      case "$UMASK" in
        0???) ;;
        *) fail "UMASK must be an octal value between 0000 and 0777 (received '$UMASK')" ;;
      esac
      ;;
  esac
}

configure_supplementary_groups() {
  # gosu rebuilds the group list from /etc/group. Materialize numeric groups
  # injected by Docker --group-add so they survive the privilege drop.
  for gid in $(id -G); do
    [ "$gid" -eq 0 ] && continue
    [ "$gid" -eq "$PGID" ] && continue

    group="$(getent group "$gid" | cut -d: -f1 || true)"
    if [ -z "$group" ]; then
      group="mdcz-$gid"
      groupadd --gid "$gid" "$group" \
        || fail "could not create supplementary group for GID $gid"
    fi
    usermod --append --groups "$group" node \
      || fail "could not add node to supplementary GID $gid"
  done
}

PUID="${PUID-1000}"
PGID="${PGID-1000}"
UMASK="${UMASK-022}"

validate_id PUID "$PUID"
validate_id PGID "$PGID"
validate_umask

[ "$(id -u)" -eq 0 ] \
  || fail "the container entrypoint must start as root so it can apply PUID and PGID"

configure_supplementary_groups

uid_owner="$(getent passwd "$PUID" | cut -d: -f1 || true)"
if [ -n "$uid_owner" ] && [ "$uid_owner" != node ]; then
  fail "PUID $PUID is already used by user '$uid_owner'"
fi

if ! getent group "$PGID" >/dev/null; then
  groupmod --gid "$PGID" node \
    || fail "could not assign PGID $PGID to the node group"
fi
if [ "$(id -u node)" -ne "$PUID" ] || [ "$(id -g node)" -ne "$PGID" ]; then
  usermod --uid "$PUID" --gid "$PGID" node \
    || fail "could not configure the node user with PUID $PUID and PGID $PGID"
fi

# Existing user data and media trees are never traversed. Avoiding a redundant
# chown also permits an already-correct /data mount to be read-only.
if [ "$(stat -c '%u:%g' /data)" != "$PUID:$PGID" ]; then
  chown "$PUID:$PGID" /data \
    || fail "could not set ownership of /data to $PUID:$PGID"
fi

umask "$UMASK"
exec gosu node "$@"
