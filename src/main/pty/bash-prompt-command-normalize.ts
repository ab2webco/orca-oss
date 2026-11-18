/**
 * Bash function every shell-ready wrapper (local, daemon, relay) runs before adding its own
 * PROMPT_COMMAND hooks: it leaves PROMPT_COMMAND a plain string with no trailing separator.
 */
export const BASH_NORMALIZE_PROMPT_COMMAND_FUNCTION = `__orca_normalize_prompt_command() {
  local __orca_joined="" __orca_prompt_part
  if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
    for __orca_prompt_part in "\${PROMPT_COMMAND[@]}"; do
      while [[ "$__orca_prompt_part" == *[[:space:]\\;] ]]; do
        __orca_prompt_part="\${__orca_prompt_part%?}"
      done
      [[ -n "$__orca_prompt_part" ]] || continue
      __orca_joined="\${__orca_joined:+$__orca_joined;}$__orca_prompt_part"
    done
    # Why: a string assigned to an array replaces only [0]. systemd's /etc/profile.d OSC 3008
    # hook (Ubuntu 26.04, Fedora) is a later element, so it would run after Orca's last hook
    # and its DEBUG trap would emit a command-start C at every idle prompt.
    unset PROMPT_COMMAND
    PROMPT_COMMAND="$__orca_joined"
  fi
  # Why: RHEL-family /etc/bashrc can leave PROMPT_COMMAND ending in a ";"/whitespace
  # separator; trim it so Orca's prepend/append never form ";;".
  while [[ "\${PROMPT_COMMAND:-}" == *[[:space:]\\;] ]]; do
    PROMPT_COMMAND="\${PROMPT_COMMAND%?}"
  done
}`
