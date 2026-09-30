#!/bin/sh
# Fills a packaging template (deploy/homebrew/verdin.rb.in, deploy/winget/*.yaml.in) for
# a release. Used by .github/workflows/release.yml:
#
#   deploy/render-template.sh <template> <version> <SHA256SUMS> > <output>
#
# Placeholders: {{VERSION}} (e.g. 0.11.0), {{DATE}} (today, UTC, YYYY-MM-DD) and
# {{SHA256 <target>}}, the checksum of the release archive for that target
# (verdin-v<version>-<target>.tar.gz or .zip) read from SHA256SUMS.
set -eu

[ $# -eq 3 ] || { echo "usage: $0 <template> <version> <SHA256SUMS>" >&2; exit 2; }
template="$1"
version="${2#v}"
sums="$3"

awk -v version="$version" -v date="$(date -u +%Y-%m-%d)" -v sums="$sums" '
BEGIN {
    while ((getline line < sums) > 0) {
        split(line, field, /[ \t]+/)
        file = field[2]
        sub(/^\*/, "", file)
        sha[file] = field[1]
    }
}
{
    gsub(/\{\{VERSION\}\}/, version)
    gsub(/\{\{DATE\}\}/, date)
    while (match($0, /\{\{SHA256 [^}]+\}\}/)) {
        target = substr($0, RSTART + 9, RLENGTH - 11)
        prefix = "verdin-v" version "-" target
        value = ""
        if ((prefix ".tar.gz") in sha) value = sha[prefix ".tar.gz"]
        else if ((prefix ".zip") in sha) value = sha[prefix ".zip"]
        if (value == "") {
            print "render-template: no checksum for " prefix " in " sums > "/dev/stderr"
            exit 1
        }
        $0 = substr($0, 1, RSTART - 1) value substr($0, RSTART + RLENGTH)
    }
    print
}' "$template"
