#!/bin/sh
set -eu

IMAGE="${MDCZ_DOCKER_TEST_IMAGE:-mdcz:identity-test}"
TEST_ROOT="$(mktemp -d)"
container="mdcz-smoke-$$"
trap 'docker rm -f -v "$container" >/dev/null 2>&1 || true; rm -rf "$TEST_ROOT"' EXIT HUP INT TERM
mkdir "$TEST_ROOT/data" "$TEST_ROOT/media"
media_owner_before="$(stat -c '%u:%g' "$TEST_ROOT/media")"

if [ "${MDCZ_DOCKER_SKIP_BUILD:-0}" != 1 ]; then
  docker build -f apps/server/Dockerfile -t "$IMAGE" .
fi

assert_output() {
  expected="$1"
  command="$2"
  shift 2
  actual="$(docker run --rm "$@" "$IMAGE" sh -c "$command")"
  [ "$actual" = "$expected" ] || {
    echo "expected: $expected" >&2
    echo "actual:   $actual" >&2
    exit 1
  }
}

assert_fails() {
  expected="$1"
  command="$2"
  shift 2
  output="$(docker run --rm "$@" "$IMAGE" sh -c "$command" 2>&1)" && {
    echo "expected command to fail: $command" >&2
    exit 1
  }
  printf '%s\n' "$output" | grep -F "$expected" >/dev/null
}

assert_output '1000:1000 0022' \
  'printf "%s:%s %s" "$(id -u)" "$(id -g)" "$(umask)"'
assert_output '1234:2345 0002' \
  'printf "%s:%s %s" "$(id -u)" "$(id -g)" "$(umask)"' \
  -e PUID=1234 -e PGID=2345 -e UMASK=002
assert_output '664' 'touch /data/created && stat -c %a /data/created' -e UMASK=002
assert_output '3000' 'id -G | tr " " "\n" | grep -x 3000' --group-add 3000
assert_output '1234:2345 0022' \
  'printf "%s:%s %s" "$(id -u)" "$(id -g)" "$(umask)"' --user 1234:2345 --read-only
assert_fails 'PUID/PGID must match --user' true --user 1234:2345 -e PUID=1000
assert_output '1234:2345' \
  'touch /data/bind-created; stat -c "%u:%g" /data/bind-created; rm /data/bind-created' \
  -e PUID=1234 -e PGID=2345 \
  -v "$TEST_ROOT/data:/data" -v "$TEST_ROOT/media:/media"
[ "$(stat -c '%u:%g' "$TEST_ROOT/media")" = "$media_owner_before" ] || {
  echo "/media ownership changed during container startup" >&2
  exit 1
}
assert_fails 'PUID must be a positive numeric ID' true -e PUID=abc
assert_fails 'PUID must be a positive numeric ID' true -e PUID=
assert_fails 'PGID must be greater than 0' true -e PGID=0
assert_fails 'PGID must be a positive numeric ID' true -e PGID=
assert_fails 'UMASK must be an octal value between 0000 and 0777' true -e UMASK=089
assert_fails 'UMASK must be an octal value between 0000 and 0777' true -e UMASK=1000
assert_fails 'UMASK must be an octal value between 0000 and 0777' true -e UMASK=7777
assert_fails 'UMASK must be an octal value between 0000 and 0777' true -e UMASK=

docker run -d --name "$container" -e MDCZ_ADMIN_PASSWORD=smoke-test-password "$IMAGE" >/dev/null
attempt=0
until [ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" = healthy ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 90 ]; then docker logs "$container"; exit 1; fi
  sleep 1
done
docker exec "$container" docker-entrypoint.sh node server.js doctor
docker stop --time 30 "$container" >/dev/null
[ "$(docker inspect --format '{{.State.ExitCode}}' "$container")" = 0 ]
echo "Docker identity, startup, database and shutdown smoke tests passed."
