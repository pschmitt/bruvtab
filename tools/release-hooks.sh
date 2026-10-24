# Project specifics for tools/release.sh: bruvtab's version lives in
# bruvtab/__version__.py and in the two extension manifests.

current_version() {
  sed -n "s/^__version__ = ['\"]\(.*\)['\"]$/\1/p" "$(repo_root)/bruvtab/__version__.py"
}

bump_version() {
  local version="$1" root
  root="$(repo_root)"
  sed -i "s/^__version__ = .*$/__version__ = '$version'/" "$root/bruvtab/__version__.py"
  sed -i "s/^\(  \"version\": \)\".*\"/\1\"$version\"/" \
    "$root/bruvtab/extension/chrome/manifest.json" "$root/bruvtab/extension/firefox/manifest.json"
}

release_files() {
  printf '%s\n' bruvtab/__version__.py bruvtab/extension/chrome/manifest.json bruvtab/extension/firefox/manifest.json
}
