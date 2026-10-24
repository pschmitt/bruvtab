set shell := ["bash", "-cu"]

default:
  @just --list

unit-test:
  uv run pytest -v

build:
  rm -rf ./dist
  uv build

smoke-test: build
  uv pip install --force-reinstall dist/*.whl
  uv run python -c 'from bruvtab.tests.test_main import run_mocked_mediators as run; run(count=3, default_port_offset=0, delay=0)' & \
  sleep 3 && \
  uv run bruvtab list && \
  uv run bruvtab windows && \
  uv run bruvtab clients && \
  uv run bruvtab active && \
  uv run bruvtab words && \
  uv run bruvtab text && \
  uv run bruvtab html

integration-build:
  docker build -t bruvtab-integration -f bruvtab/tests/integration/Dockerfile .

integration-test:
  INTEGRATION_TEST=1 uv run pytest -v -k test_integration -s

test-all: unit-test smoke-test integration-test
  @echo "Testing all"

sign-firefox-addon:
  ./scripts/sign-firefox-addon.sh

package-browser-artifacts:
  ./scripts/package-browser-artifacts.sh

package-chrome-crx:
  ./scripts/package-chrome-crx.sh

reset:
  pkill python3 || true
  pkill xvfb-run || true
  pkill node || true
  pkill Xvfb || true
  pkill firefox || true

# Bump the version, date the changelog, commit and push.
release-prepare version:
  tools/release.sh prepare '{{ version }}'

# Tag the release once CI is green for HEAD (needs a GPG-signed tag); the release
# workflow publishes the Python packages and the signed browser extensions.
release-tag:
  tools/release.sh tag
