# Sourced by install-fish4-release.sh and require-fish4.sh: the oldest fish `shell contracts` accepts.
#
# Why 4.3 and not 4.0: DECSET 2031 arming (#9993) and the OSC 11 re-query (#13892) arrived with
# fish 4.3's color-theme-aware themes. Ubuntu 26.04 ships 4.2.1, which does neither, so the
# live fish tests there had nothing to guard and failed their own vacuity checks (ORCA-1280).
readonly FISH_FLOOR_MAJOR=4
readonly FISH_FLOOR_MINOR=3
readonly FISH_FLOOR="${FISH_FLOOR_MAJOR}.${FISH_FLOOR_MINOR}"

# True when `fish --version` output ($1) is at least $FISH_FLOOR.
fish_meets_floor() {
  local version="${1##*version }" major minor
  major="${version%%.*}"
  case "$version" in
    *.*) minor="${version#*.}" && minor="${minor%%.*}" ;;
    *) minor=0 ;;
  esac
  case "$major" in '' | *[!0-9]*) return 1 ;; esac
  case "$minor" in '' | *[!0-9]*) minor=0 ;; esac
  [ "$major" -gt "$FISH_FLOOR_MAJOR" ] ||
    { [ "$major" -eq "$FISH_FLOOR_MAJOR" ] && [ "$minor" -ge "$FISH_FLOOR_MINOR" ]; }
}
