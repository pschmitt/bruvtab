#!/usr/bin/env bash
# Release a project and its browser extension under one version.
#
#   prepare VERSION  bump the version files, date the CHANGELOG, commit, push
#   tag              require green CI for HEAD, then push a signed vVERSION tag
#
# The release workflow (on v* tags) signs the browser extension, publishes it
# with the build artifacts and pins the signed packages' hashes in
# browser/packages/metadata.json on main.
#
# This file is shared: the canonical copy lives in pschmitt/ci-workflows
# (scripts/release.sh) and is copied verbatim to tools/release.sh in each
# repository. Project specifics go into tools/release-hooks.sh, which may define
#   current_version       print the current version
#   bump_version VERSION  write VERSION into the version files
#   release_files         print the files the release commit contains
# The defaults handle a Cargo package (Cargo.toml and Cargo.lock).

usage() {
  cat <<EOF
Usage: $(basename "$0") prepare VERSION | tag

  prepare VERSION  Bump to VERSION (X.Y.Z), date the changelog, commit and push.
  tag              Push the GPG-signed vVERSION tag once CI (build, lint, test and
                   docker, where the repository has them) and nixbot are green
                   for HEAD. Nixbot is required when nixbot.toml is present.
                   Cancelled jobs matching \$RELEASE_OPTIONAL_JOBS (an extended
                   regex, default "macos") do not count as failures.
                   The release workflow then signs and publishes.
EOF
}

die() {
  printf '%s\n' "$*" >&2
  return 1
}

repo_root() {
  git rev-parse --show-toplevel
}

project_name() {
  basename "$(repo_root)" .git
}

# Defaults for a Cargo package.
current_version() {
  sed -n 's/^version = "\(.*\)"$/\1/p' "$(repo_root)/Cargo.toml" | head -n 1
}

bump_version() {
  local version="$1" root crate
  root="$(repo_root)"
  crate="$(sed -n 's/^name = "\(.*\)"$/\1/p' "$root/Cargo.toml" | head -n 1)"
  sed -i "0,/^version = \".*\"$/s//version = \"$version\"/" "$root/Cargo.toml"
  # Only the package's own entry, which directly follows its name line.
  sed -i "/^name = \"$crate\"$/{n;s/^version = \".*\"$/version = \"$version\"/}" "$root/Cargo.lock"
}

release_files() {
  printf '%s\n' Cargo.toml Cargo.lock
}

load_hooks() {
  local hooks
  hooks="$(repo_root)/tools/release-hooks.sh"
  if [[ -f "$hooks" ]]
  then
    # shellcheck source=/dev/null
    source "$hooks"
  fi
}

# Jobs whose cancellation does not block a release (an extended regex over job
# names). macOS runners are scarce: their jobs get cancelled before a runner
# picks them up, which says nothing about the code. Failures still block.
RELEASE_OPTIONAL_JOBS="${RELEASE_OPTIONAL_JOBS:-macos}"

# Whether a finished, non-successful run only "failed" because optional jobs
# (RELEASE_OPTIONAL_JOBS) were cancelled while every other job succeeded or was
# skipped. Prints the tolerated jobs.
run_only_lost_optional_jobs() {
  local run_id="$1" jobs
  jobs="$(gh run view "$run_id" --json jobs \
    -q '.jobs[] | [.name, (.conclusion // "")] | @tsv' 2>/dev/null)" || return 1
  [[ -n "$jobs" ]] || return 1
  local name conclusion tolerated=()
  while IFS=$'\t' read -r name conclusion
  do
    case "$conclusion" in
      success|skipped|neutral) ;;
      cancelled)
        if [[ "$name" =~ $RELEASE_OPTIONAL_JOBS ]]
        then
          tolerated+=("$name")
        else
          return 1
        fi
        ;;
      *) return 1 ;;
    esac
  done <<< "$jobs"
  printf '%s\n' "${tolerated[@]}"
}

# Wait until every run of WORKFLOW for COMMIT has finished; succeed only if all
# passed, or lost nothing but cancelled optional jobs.
wait_for_workflow() {
  local commit="$1" workflow="$2" pending runs
  while true
  do
    pending="$(gh run list --commit "$commit" --workflow "$workflow" --json status \
      -q '[.[] | select(.status != "completed")] | length' 2>/dev/null)"
    runs="$(gh run list --commit "$commit" --workflow "$workflow" --json databaseId,conclusion \
      -q '.[] | [.databaseId, .conclusion] | @tsv' 2>/dev/null)"
    if [[ "$pending" == 0 && -n "$runs" ]]
    then
      break
    fi
    printf 'Waiting for %s on %s…\n' "$workflow" "${commit:0:7}" >&2
    sleep 30
  done
  local run_id conclusion tolerated
  while IFS=$'\t' read -r run_id conclusion
  do
    [[ "$conclusion" == success ]] && continue
    if tolerated="$(run_only_lost_optional_jobs "$run_id")" && [[ -n "$tolerated" ]]
    then
      printf 'Workflow %s for %s: ignoring cancelled optional job(s): %s\n' \
        "$workflow" "${commit:0:7}" "$(paste -sd, <<< "$tolerated")" >&2
      continue
    fi
    die "Workflow $workflow did not succeed for ${commit:0:7}: run $run_id $conclusion"
    return 1
  done <<< "$runs"
}

# Require both nixbot phase summaries, including when no check exists yet.
wait_for_nixbot() {
  local commit="$1" checks name status conclusion pending seen_eval seen_build
  while true
  do
    if ! checks="$(gh api --paginate "repos/{owner}/{repo}/commits/$commit/check-runs?per_page=100" \
      --jq '.check_runs[] | select(.name == "nixbot/nix-eval" or .name == "nixbot/nix-build") | [.name, .status, (.conclusion // "")] | @tsv')"
    then
      die "Could not read nixbot checks for ${commit:0:7}"
      return 1
    fi
    pending=0
    seen_eval=
    seen_build=
    while IFS=$'\t' read -r name status conclusion
    do
      [[ -n "$name" ]] || continue
      case "$name" in
        nixbot/nix-eval)
          seen_eval=1
          ;;
        nixbot/nix-build)
          seen_build=1
          ;;
      esac
      if [[ "$status" != completed ]]
      then
        pending=1
      elif [[ "$conclusion" != success ]]
      then
        die "$name did not succeed for ${commit:0:7}: ${conclusion:-missing conclusion}"
        return 1
      fi
    done <<< "$checks"
    if [[ -n "$seen_eval" && -n "$seen_build" && "$pending" == 0 ]]
    then
      return 0
    fi
    printf 'Waiting for nixbot evaluation and build on %s…\n' "${commit:0:7}" >&2
    sleep 30
  done
}

prepare() {
  local version="$1" root today file
  local -a files=()
  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
  then
    # Firefox only accepts numeric versions, so no pre-release suffixes.
    die "VERSION must be X.Y.Z (numeric), got: ${version:-<empty>}"
    return 2
  fi
  root="$(repo_root)"
  today="$(date +%F)"
  if ! grep -qx '## \[Unreleased\]' "$root/CHANGELOG.md"
  then
    die "CHANGELOG.md has no '## [Unreleased]' section"
    return 1
  fi
  bump_version "$version" || return 1
  sed -i "s/^## \[Unreleased\]$/## [Unreleased]\n\n## [$version] - $today/" "$root/CHANGELOG.md"
  while IFS= read -r file
  do
    files+=("$file")
  done < <(release_files)
  git -C "$root" commit -m "Release $(project_name) $version" -- "${files[@]}" CHANGELOG.md || return 1
  git -C "$root" push origin HEAD:main
}

tag() {
  local root commit version workflow
  root="$(repo_root)"
  commit="$(git -C "$root" rev-parse HEAD)"
  version="$(current_version)"
  if ! git -C "$root" merge-base --is-ancestor "$commit" origin/main
  then
    die "HEAD ${commit:0:7} is not on origin/main; push it first"
    return 1
  fi
  for workflow in build lint test docker
  do
    if [[ -f "$root/.github/workflows/$workflow.yaml" ]]
    then
      wait_for_workflow "$commit" "$workflow" || return 1
    fi
  done
  if [[ -f "$root/nixbot.toml" ]]
  then
    wait_for_nixbot "$commit" || return 1
  fi
  git -C "$root" tag -s "v$version" -m "Release $version" "$commit" || return 1
  git -C "$root" push origin "v$version"
}

main() {
  load_hooks
  case "${1:-}" in
    -h|--help)
      usage
      return 0
      ;;
    prepare)
      prepare "${2:-}"
      ;;
    tag)
      tag
      ;;
    *)
      usage >&2
      return 2
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]
then
  main "$@"
  exit "$?"
fi

# vim: set ft=sh et ts=2 sw=2 :
