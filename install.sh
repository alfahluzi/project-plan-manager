#!/usr/bin/env bash
# install.sh - install project-plan-manager skill and link the `ppm` CLI
#
# Usage:
#   ./install.sh [--client opencode|claude|codex|all] [--mode copy|link]
#   ./install.sh --uninstall [--client opencode|claude|codex|all]
#
# Modes:
#   copy - copy skill files into the agent's skills directory (default, frozen install)
#   link - symlink the source repo into the agent's skills directory (development)
#
# Always runs `npm link` so `ppm` is exposed on PATH for the chosen client(s).
# Requires Node.js >=18 and npm on PATH. Runs on POSIX shells; on Windows use WSL or Git Bash.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_NAME="project-plan-manager"
PACKAGE_NAME="project-plan-manager-agent-skill"

CLIENT="opencode"
MODE="copy"
ACTION="install"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--client) CLIENT="$2"; shift 2 ;;
		--mode) MODE="$2"; shift 2 ;;
		--uninstall) ACTION="uninstall"; shift ;;
		-h|--help)
			sed -n '2,14p' "$0"
			exit 0
			;;
		*) echo "unknown argument: $1" >&2; exit 2 ;;
	esac
done

log()  { printf '\033[1;36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m⚠\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }

client_dir() {
	case "$1" in
		opencode) echo "$HOME/.config/opencode/skills" ;;
		claude) echo "$HOME/.claude/skills" ;;
		codex) echo "$HOME/.agents/skills" ;;
		*) fail "unknown client: $1" ;;
	esac
}

clients() {
	case "$1" in
		opencode) echo "opencode" ;;
		claude) echo "claude" ;;
		codex) echo "codex" ;;
		all) echo "opencode claude codex" ;;
		*) fail "unknown --client: $1 (expected opencode|claude|codex|all)" ;;
	esac
}

copy_tree() {
	local dest="$1"
	mkdir -p "$dest"
	rm -rf "$dest/$SKILL_NAME"
	if [[ "$MODE" == "link" ]]; then
		ln -s "$REPO_ROOT" "$dest/$SKILL_NAME"
	else
		mkdir -p "$dest/$SKILL_NAME"
		cp -R "$REPO_ROOT/." "$dest/$SKILL_NAME/"
		rm -rf "$dest/$SKILL_NAME/.git" "$dest/$SKILL_NAME/node_modules" "$dest/$SKILL_NAME/install.sh"
	fi
}

link_bin() {
	local pkg_dir="$1"
	[[ -d "$pkg_dir" ]] || return 0
	( cd "$pkg_dir" && npm link --no-audit --no-fund >/dev/null ) || fail "npm link failed in $pkg_dir"
}

unlink_bin() {
	local pkg_dir="$1"
	if [[ -d "$pkg_dir" ]]; then
		( cd "$pkg_dir" && npm unlink --no-audit --no-fund >/dev/null 2>&1 ) || true
	fi
	npm uninstall -g "$PACKAGE_NAME" --no-audit --no-fund >/dev/null 2>&1 || true
}

remove_skill() {
	local dir="$1"
	rm -rf "$dir/$SKILL_NAME"
}

command -v node >/dev/null || fail "node not found in PATH"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 18 ]] || fail "node >=18 required (found $NODE_MAJOR)"
command -v npm >/dev/null || fail "npm not found in PATH"

if [[ "$ACTION" == "uninstall" ]]; then
	log "uninstalling $SKILL_NAME"
	for c in $(clients "$CLIENT"); do
		d="$(client_dir "$c")"
		unlink_bin "$d/$SKILL_NAME"
		remove_skill "$d"
		ok "removed skill from $d/$SKILL_NAME"
	done
	ok "uninstall complete"
	exit 0
fi

log "installing $SKILL_NAME"
log "  source : $REPO_ROOT"
log "  client : $CLIENT"
log "  mode   : $MODE"

for c in $(clients "$CLIENT"); do
	d="$(client_dir "$c")"
	copy_tree "$d"
	link_bin "$d/$SKILL_NAME"
	if [[ "$MODE" == "link" ]]; then
		ok "linked skill for $c -> $d/$SKILL_NAME"
	else
		ok "copied skill for $c -> $d/$SKILL_NAME"
	fi
done

if command -v ppm >/dev/null 2>&1; then
	ok "ppm available at $(command -v ppm)"
	ok "install complete"
	exit 0
fi

NPM_GLOBAL_BIN="$(npm prefix -g 2>/dev/null)/bin"
warn "ppm is not on PATH"
echo "Add this to your shell profile (~/.bashrc, ~/.zshrc, etc.) and reload:"
echo "    export PATH=\"$NPM_GLOBAL_BIN:\$PATH\""
echo "Then verify: command -v ppm && ppm"
exit 1
