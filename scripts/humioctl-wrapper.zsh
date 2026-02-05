#!/usr/bin/env zsh

# shellcheck disable=SC2142
humioctl() {
  if [[ "$1" == "search" ]]; then
    shift
    if [[ -n ${HUMIO_DEFAULT_REPO:-} ]]; then
      local -a flags positional

      while [[ $# -gt 0 ]]; do
        case "$1" in
          --)
            flags+=("$1")
            shift
            positional+=("$@")
            break
            ;;
          -*)
            flags+=("$1")
            shift
            if [[ $# -gt 0 && ${1#-} == "$1" ]]; then
              flags+=("$1")
              shift
            fi
            ;;
          *)
            positional+=("$1")
            shift
            ;;
        esac
      done

      if (( ${#positional[@]} == 0 )); then
        positional=("$HUMIO_DEFAULT_REPO")
      elif (( ${#positional[@]} == 1 )); then
        positional=("$HUMIO_DEFAULT_REPO" "${positional[1]}")
      fi

      command humioctl search "${flags[@]}" "${positional[@]}"
      return
    fi
  fi

  command humioctl "$@"
}
