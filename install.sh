#!/bin/sh
# Installs the verdin binary from a GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/verdin-cms/verdin/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/verdin-cms/verdin/main/install.sh | sh -s -- --version 0.10.0 --dir /usr/local/bin
#
# It picks the archive for this system (Linux or macOS, x86-64 or ARM64), checks it
# against the release's SHA256SUMS and puts `verdin` in the install directory:
# $VERDIN_INSTALL_DIR, else /usr/local/bin as root, else ~/.local/bin.
# Windows: use winget (`winget install VerdinCMS.Verdin`) or the .zip from the release.
set -eu

REPO="${VERDIN_REPO:-verdin-cms/verdin}"
VERSION="${VERDIN_VERSION:-latest}"
INSTALL_DIR="${VERDIN_INSTALL_DIR:-}"

usage() {
    cat <<EOF
Install verdin from https://github.com/$REPO/releases

Usage: install.sh [--version <X.Y.Z>] [--dir <directory>]

  --version   release to install (default: the latest; also VERDIN_VERSION)
  --dir       where to put the binary (also VERDIN_INSTALL_DIR)
EOF
}

say() { printf 'verdin-install: %s\n' "$*" >&2; }
fail() { say "error: $*"; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --version) [ $# -ge 2 ] || fail "--version needs a value"; VERSION="$2"; shift 2 ;;
        --version=*) VERSION="${1#*=}"; shift ;;
        --dir) [ $# -ge 2 ] || fail "--dir needs a value"; INSTALL_DIR="$2"; shift 2 ;;
        --dir=*) INSTALL_DIR="${1#*=}"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; fail "unknown argument: $1" ;;
    esac
done

# --- download helpers ---------------------------------------------------------------

if command -v curl >/dev/null 2>&1; then
    fetch() { curl --proto '=https' --tlsv1.2 -fsSL "$1" -o "$2"; }
    fetch_stdout() { curl --proto '=https' --tlsv1.2 -fsSL "$1"; }
elif command -v wget >/dev/null 2>&1; then
    fetch() { wget -q -O "$2" "$1"; }
    fetch_stdout() { wget -q -O - "$1"; }
else
    fail "curl or wget is required"
fi

sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d ' ' -f 1
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | cut -d ' ' -f 1
    elif command -v openssl >/dev/null 2>&1; then
        openssl dgst -sha256 -r "$1" | cut -d ' ' -f 1
    else
        fail "sha256sum, shasum or openssl is required to verify the download"
    fi
}

# --- platform -------------------------------------------------------------------------

os="$(uname -s)"
arch="$(uname -m)"
case "$arch" in
    x86_64|amd64) arch="x86_64" ;;
    aarch64|arm64) arch="aarch64" ;;
    *) fail "no prebuilt binary for the $arch architecture; build from source: cargo install --git https://github.com/$REPO verdin" ;;
esac
case "$os" in
    Linux) target="$arch-unknown-linux-musl" ;;
    Darwin)
        # A shell translated by Rosetta reports x86_64 on Apple silicon.
        if [ "$arch" = "x86_64" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
            arch="aarch64"
        fi
        target="$arch-apple-darwin" ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT)
        fail "on Windows, run: winget install VerdinCMS.Verdin (or download the .zip from https://github.com/$REPO/releases)" ;;
    *) fail "no prebuilt binary for $os" ;;
esac

# --- version --------------------------------------------------------------------------

if [ "$VERSION" = "latest" ]; then
    # github.com/<repo>/releases/latest redirects to .../tag/v<version> (no API rate
    # limit); the API is the fallback for wget.
    if command -v curl >/dev/null 2>&1; then
        VERSION="$(curl --proto '=https' --tlsv1.2 -fsSLI -o /dev/null -w '%{url_effective}' \
            "https://github.com/$REPO/releases/latest" | sed -n 's|.*/tag/v\{0,1\}||p')"
    fi
    if [ -z "$VERSION" ] || [ "$VERSION" = "latest" ]; then
        VERSION="$(fetch_stdout "https://api.github.com/repos/$REPO/releases/latest" \
            | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1)"
    fi
    [ -n "$VERSION" ] || fail "could not find the latest release of $REPO (set VERDIN_VERSION)"
fi
VERSION="${VERSION#v}"
tag="v$VERSION"
name="verdin-$tag-$target"
asset="$name.tar.gz"
base="https://github.com/$REPO/releases/download/$tag"

# --- download and verify --------------------------------------------------------------

tmp="$(mktemp -d 2>/dev/null || mktemp -d -t verdin)"
trap 'rm -rf "$tmp"' EXIT INT TERM

say "downloading $asset"
fetch "$base/$asset" "$tmp/$asset" || fail "download failed: $base/$asset"
fetch "$base/SHA256SUMS" "$tmp/SHA256SUMS" || fail "download failed: $base/SHA256SUMS"

expected="$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1 }' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || fail "$asset is not listed in SHA256SUMS"
actual="$(sha256 "$tmp/$asset")"
[ "$expected" = "$actual" ] || fail "checksum mismatch for $asset (expected $expected, got $actual)"
say "checksum ok"

tar xzf "$tmp/$asset" -C "$tmp"
[ -f "$tmp/$name/verdin" ] || fail "the archive does not contain $name/verdin"

# --- install --------------------------------------------------------------------------

if [ -z "$INSTALL_DIR" ]; then
    if [ "$(id -u)" = "0" ]; then INSTALL_DIR="/usr/local/bin"; else INSTALL_DIR="$HOME/.local/bin"; fi
fi
mkdir -p "$INSTALL_DIR" || fail "cannot create $INSTALL_DIR"
[ -w "$INSTALL_DIR" ] || fail "$INSTALL_DIR is not writable: rerun with sudo or pass --dir"

# Copy then rename, so a running verdin is never left with a half-written file.
cp "$tmp/$name/verdin" "$INSTALL_DIR/.verdin.new"
chmod 755 "$INSTALL_DIR/.verdin.new"
mv -f "$INSTALL_DIR/.verdin.new" "$INSTALL_DIR/verdin"

say "installed $("$INSTALL_DIR/verdin" --version 2>/dev/null || echo "verdin $VERSION") to $INSTALL_DIR/verdin"
case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *) say "$INSTALL_DIR is not on your PATH; add it, e.g.: export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
esac
say "next: verdin new my-site && cd my-site && verdin dev"
