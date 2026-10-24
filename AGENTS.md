# BruvTab Agent Guide

## Overview
BruvTab is a CLI tool for managing browser tabs (Firefox, Chrome/Chromium). It consists of a Python CLI, a native messaging mediator, and browser extensions.

## Core Architecture
- **CLI (`bruvtab/`)**: Primary user interface. `bruvtab/main.py` is the entry point.
- **Mediator (`bruvtab/mediator/`)**: A native messaging host that bridges the CLI and browser extensions. It communicates via JSON over stdin/stdout with the browser and provides an HTTP API for the CLI.
- **Extensions (`bruvtab/extension/`)**: Browser-side code (JS) that interacts with the `tabs` API.

## Native Messaging
- **Manifests**: Native messaging manifests are JSON files that tell the browser where the mediator executable is.
- **Installation**: `bruvtab install` creates these manifests in the appropriate browser-specific locations.
- **Communication**: The browser starts the mediator process and communicates with it using a length-prefixed JSON format over stdin/stdout.

## Development
- **Task Runner**: Use `just`. Run `just` to list available commands.
- **Python Environment**: Managed via `uv`. Use `uv sync --all-extras` to set up the development environment.
- **Testing**:
  - Unit tests: `pytest bruvtab/tests` (or `just unit-test`).
  - Smoke tests: `just smoke-test` (runs locally with mocked mediators).
  - Integration tests: `just integration-test` (runs in Docker via `bruvtab/tests/integration/Dockerfile`). Use `just integration-build` to build the image.

## Standards & Conventions
- **Python**: Follow `.pylintrc`. Use `uv` for dependency and environment management.
- **Version Management**: Version is defined in `bruvtab/__version__.py`.
- **Commits**: Follow existing style (concise, focus on "why").
- **Browser IDs**:
  - Chrome: `edpgjheobdplebiikjgjgpmonakingef` (debug/test ID).

## Critical Files
- `justfile`: Defines all major dev workflows.
- `pyproject.toml`: Project metadata and entry points.
- `bruvtab/mediator/bruvtab_mediator.py`: Core logic for browser communication.
- `bruvtab/tests/test_integration.py`: End-to-end validation logic.

## Releases

Before every release, try to land the open dependency PRs (Renovate,
Dependabot): `gh pr list`, merge those whose checks are green (Renovate
rebases the ones that conflict; wait for it), and let CI finish on the
resulting `main` before tagging. Leave out PRs with failing checks or major
bumps that need real work, and say which.

Tag the release (`git tag -s X.Y.Z`); the release workflow signs and publishes
the browser extensions, then `pin-release-assets` commits their hashes to
`browser/packages/metadata.json` on `main`.
