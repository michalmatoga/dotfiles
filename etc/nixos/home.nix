{ config, pkgs, unstable, ... }:

let
  gwq = pkgs.buildGoModule {
    pname = "gwq";
    version = "0.0.13";
    src = pkgs.fetchFromGitHub {
      owner = "d-kuro";
      repo = "gwq";
      rev = "v0.0.13";
      hash = "sha256-10An8tKs7z2NNnI+KU+tjL7ZUS97m4gxglQ3Z5WiyeQ=";
    };
    patches = [ ./patches/gwq-ssh-url.patch ];
    vendorHash = "sha256-XoI6tu4Giy9IMDql4VmSP74FXaVD3nizOedmfPwIRCA=";
    subPackages = ["cmd/gwq"];
  };
  unstablePackages = with unstable; [
    pulumi
    pulumiPackages.pulumi-nodejs
    postgresql_18
  ];
in
{
  imports =
    [
      ./aliases/git.nix
    ];

  home.file."repositories.json" = {
    source = ../../repositories.json;
  };

  home.file.".ssh/config".text = ''
    Host *
      StrictHostKeyChecking no
  '';

  home.file.".config/git" = {
    recursive = true;
    source = ../../.config/git;
  };

  home.file.".config/nvim" = {
    recursive = true;
    # source = ../../.config/nvim;
    source = ../../.config/lazyvim;
  };

  home.file.".config/lazyvim" = {
    recursive = true;
    source = ../../.config/lazyvim;
  };

  home.file.".config/lazydocker/config.yml" = {
    source = ../../.config/lazydocker/config.yml;
  };

  home.file.".config/agent-of-empires" = {
    recursive = true;
    source = ../../.config/agent-of-empires;
  };

  home.file.".config/opencode/config.json" = {
    source = ../../.config/opencode/config.json;
  };

  home.file.".config/opencode/themes" = {
    recursive = true;
    source = ../../.config/opencode/themes;
  };

  home.file.".config/k9s/skins/catppuccin-latte.yaml" = {
    source = ../../.config/k9s/skins/catppuccin-latte.yaml;
  };

  home.file.".markdownlint.json" = {
    source = ../../.config/markdownlintrc.json;
  };

  home.file.".editorconfig" = {
    source = ../../.config/.editorconfig;
  };

  home.file.".npmrc" = {
    source = ../../.config/.npmrc;
  };

  home.file.".config/direnv" = {
    recursive = true;
    source = ../../.config/direnv;
  };

  home.file.".config/gwq" = {
    recursive = true;
    source = ../../.config/gwq;
  };

  home.packages = with pkgs; [
    # fzf # A command-line fuzzy finder
    awscli2
    bitwarden-cli
    corepack_24
    csvkit
    direnv
    eslint_d
    eza # A modern replacement for ‘ls’
    fd
    ffmpeg_7-full
    file
    flyctl
    gawk
    gcalcli
    gcc
    gh
    ghq
    gwq
    git-crypt
    gnumake
    gnupg
    gnused
    gnutar
    humioctl
    hunspellDicts.pl_PL
    jq
    kubectl
    kubectl-node-shell
    lazydocker
    lazygit
    linode-cli
    lsof
    lua-language-server
    lua51Packages.luarocks
    mariadb
    markdownlint-cli2
    marksman
    mkcert
    mongodb-tools
    neofetch
    nmap # A utility for network discovery and security auditing
    nodejs_24 # nodejs & npm
    openssl
    opentofu
    pgadmin4
    php
    prettierd
    prisma-engines
    python3
    restic
    ripgrep # recursively searches directories for a regex pattern
    rustc
    tmux
    tree-sitter
    unzip
    vault
    wsl-open # WSL-specific
    xdg-utils
    yq-go # yaml processor https://github.com/mikefarah/yq
    zig
    zip
    zstd
    agent-of-empires
    gogcli
  ] ++ unstablePackages;

  # starship - an customizable prompt for any shell
  programs.starship = {
    enable = true;
    # custom settings
    settings = {
      add_newline = false;
      aws.disabled = true;
      gcloud.disabled = true;
      line_break.disabled = false;
    };
  };

  home.sessionVariables = {
    PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING = "1";
    PRISMA_SCHEMA_ENGINE_BINARY = "${pkgs.prisma-engines}/bin/schema-engine";
    PRISMA_QUERY_ENGINE_BINARY = "${pkgs.prisma-engines}/bin/query-engine";
    PRISMA_QUERY_ENGINE_LIBRARY = "${pkgs.prisma-engines}/lib/libquery_engine.node";
    PRISMA_INTROSPECTION_ENGINE_BINARY = "${pkgs.prisma-engines}/bin/introspection-engine";
    PRISMA_FMT_BINARY = "${pkgs.prisma-engines}/bin/prisma-fmt";
  };

  programs.gh = {
    enable = true;
    settings = {
      aliases = {
        recent-open-issues = ''!d=$(date -d "7 days ago" +%Y-%m-%d); wsl-open "https://schibsted.ghe.com/issues?q=(org%3Asvp%20OR%20org%3Avgtv)%20is%3Aissue%20is%3Aopen%20created%3A%3E%3D''${d}"'';
      };
    };
  };

  programs.zsh = {
    enable = true;
    enableCompletion = true;
    syntaxHighlighting.enable = true;
    history.size = 10000;
    zplug = {
      enable = true;
      plugins = [
        { name = "zsh-users/zsh-autosuggestions"; }
        { name = "joshskidmore/zsh-fzf-history-search"; }
        { name = "unixorn/fzf-zsh-plugin"; }
        { name = "ptavares/zsh-direnv"; }
      ];
    };
    shellAliases = let
      pulumiCwd = builtins.getEnv "PULUMI_CWD";
    in {
      copy = "clip.exe";
      cplc = "fc -ln -1 | clip.exe";
      cpwd = "pwd | tr -d '\n' | clip.exe";
      cq = "dotfiles_require; npx tsx \"$DOTFILES_DIR/scripts/cq.ts\"";
      dffmpeg = "bash /home/nixos/ghq/github.schibsted.io/svp/node-ffmpeg/ffmpeg.sh";
      dk = "docker";
      gr = "dotfiles_require; bash \"$DOTFILES_DIR/scripts/gr.sh\"";
      gtm-clean-all = "dotfiles_require; npx tsx \"$DOTFILES_DIR/scripts/gtm-clean-all.ts\"";
      hg = "dotfiles_require; npx tsx \"$DOTFILES_DIR/scripts/hg/hg.ts\"";
      hgs = "dotfiles_require; npx tsx \"$DOTFILES_DIR/scripts/hg/hgs.ts\"";
      ldk = "lazydocker";
      meetings = "dotfiles_require; bash \"$DOTFILES_DIR/scripts/meetings.sh\"";
      nag = "dotfiles_require; bash \"$DOTFILES_DIR/scripts/nag.sh\"";
      oc = "opencode --port";
      aoe-work = "aoe -p work";
      aoe-personal = "aoe -p personal";
      ody = "dotfiles_require; npx tsx \"$DOTFILES_DIR/scripts/hg/ody.ts\"";
      odyr = "pkill -f ody.ts && tmux send-keys -t ody:1 'ody' C-m";
      paste = "powershell.exe get-clipboard";
      pi = "pulumi";
      pulumi = "dotfiles_require; bash \"$DOTFILES_DIR/scripts/pulumi.sh\"";
      shutdown-ritual = "dotfiles_require; npx tsx \"$DOTFILES_DIR/scripts/shutdown.ts\"";
      startup-ritual = "dotfiles_require; npx tsx \"$DOTFILES_DIR/scripts/startup.ts\"";
      sync-ghec = "dotfiles_require; npx tsx \"$DOTFILES_DIR/scripts/sync-ghec.ts\"";
      sync-repos = "dotfiles_require; node \"$DOTFILES_DIR/scripts/sync-repos.mjs\"";
      tf = "tofu";
      update = "dotfiles_require; sudo nixos-rebuild switch && \"$DOTFILES_DIR/scripts/post-update.sh\"";
      update-npm-deps = "dotfiles_require; npx tsx \"$DOTFILES_DIR/scripts/update-npm-deps.ts\"";
    };
    # setup some environment variables
    initContent = ''
      export BROWSER="wsl-open"
      export GH_USER="michalmatoga"
      export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=true
      export HOST_IP="$(ip route | awk '/default/ {print $3; exit}')"

      export NIX_LD=$(nix eval --impure --raw --expr 'let pkgs = import <nixpkgs> {}; NIX_LD = pkgs.lib.fileContents "${pkgs.stdenv.cc}/nix-support/dynamic-linker"; in NIX_LD')
      export PATH="$HOME/.cache/npm/global/bin:$PATH"

      dotfiles_is_repo() {
        git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1
        git remote -v | grep -q "git@github.com:michalmatoga/dotfiles.git"
      }

      dotfiles_set_dir() {
        if [ -n "''${DOTFILES_DIR:-}" ]; then
          return
        fi

        if dotfiles_is_repo; then
          export DOTFILES_DIR="$(git rev-parse --show-toplevel)"
          return
        fi

        if command -v ghq >/dev/null 2>&1; then
          root=$(ghq root)
          candidate="$root/github.com/michalmatoga/dotfiles"
          if [ -d "$candidate/.git" ] && git -C "$candidate" remote -v | grep -q "git@github.com:michalmatoga/dotfiles.git"; then
            export DOTFILES_DIR="$candidate"
          fi
        fi
      }

      dotfiles_require() {
        : "''${DOTFILES_DIR:?DOTFILES_DIR is required}"
        if ! [ -d "''${DOTFILES_DIR}/.git" ]; then
          echo "DOTFILES_DIR is required (not a git repo): ''${DOTFILES_DIR}" >&2
          return 1
        fi
        if ! git -C "''${DOTFILES_DIR}" remote -v | grep -q "git@github.com:michalmatoga/dotfiles.git"; then
          echo "DOTFILES_DIR is required (dotfiles remote not found): ''${DOTFILES_DIR}" >&2
          return 1
        fi
      }

      dotfiles_set_dir
      dotfiles_require

      if [ -f "''${DOTFILES_DIR}/.env" ]; then
        source "''${DOTFILES_DIR}/.env"
      fi

      if [ -f "''${DOTFILES_DIR}/secrets.json" ]; then
        humio_address=$(jq -r '.humio.address // empty' "''${DOTFILES_DIR}/secrets.json")
        humio_token=$(jq -r '.humio.token // empty' "''${DOTFILES_DIR}/secrets.json")
        humio_default_repo=$(jq -r '.humio.default_repo // empty' "''${DOTFILES_DIR}/secrets.json")
        if [ -n "$humio_address" ]; then
          export HUMIO_ADDRESS="$humio_address"
        fi
        if [ -n "$humio_token" ]; then
          export HUMIO_TOKEN="$humio_token"
        fi
        if [ -n "$humio_default_repo" ]; then
          export HUMIO_DEFAULT_REPO="$humio_default_repo"
        fi
      fi

      if [ -f "''${DOTFILES_DIR}/scripts/humioctl-wrapper.zsh" ]; then
        source "''${DOTFILES_DIR}/scripts/humioctl-wrapper.zsh"
      fi

      alias PWD='pwd' # necessary for compatibility with sourced script below
      if [ -f "''${DOTFILES_DIR}/dist/gtm-terminal-plugin/gtm-plugin.sh" ]; then
        source "''${DOTFILES_DIR}/dist/gtm-terminal-plugin/gtm-plugin.sh"
      fi

    '';
  };
  home.sessionVariables = {
    SSL_CERT_FILE="/etc/ssl/certs/ca-certificates.crt"; # fix for local cloudflare wrangler issues https://github.com/cloudflare/workers-sdk/issues/3264#issuecomment-2600760750
  };
  programs.k9s = {
    enable = true;
    settings = {
      k9s = {
        ui = {
          headless = true;
          logoless = true;
          noIcons = true;
          skin = "catppuccin-latte";
        };
      };
    };
  };
  programs.neovim = {
    enable = true;
    defaultEditor = true;
    viAlias = true;
    vimAlias = true;
    vimdiffAlias = true;
  };
  programs.tmux = {
    enable = true;
    plugins = with pkgs;
      [
        {
          plugin = tmuxPlugins.catppuccin;
          extraConfig = ''
            set -g @catppuccin_flavor "latte"
            set -g @catppuccin_window_status_style "rounded"
            set -g @catppuccin_window_number_position "right"
            set -g @catppuccin_window_text " #W"
            set -g @catppuccin_window_current_text " #W"
            set -g @catppuccin_window_flags "icon"
            set -g @catppuccin_status_left_separator "█"
            set -g @catppuccin_status_right_separator "█"
            set -g @catppuccin_date_time_text " %H:%M"
          '';
        }
        tmuxPlugins.continuum
        tmuxPlugins.jump
        tmuxPlugins.resurrect
        tmuxPlugins.tmux-thumbs
        tmuxPlugins.vim-tmux-navigator
        tmuxPlugins.yank
      ];
    extraConfig = ''
      set-window-option -g mode-keys vi
      set-option -s escape-time 0
      set-option -g default-terminal "tmux-256color"
      set-option -g focus-events on
      set -ag terminal-overrides ",xterm-256color:RGB"
      set -sa terminal-features 'xterm-256color:RGB'
      set -g base-index 1
      setw -g pane-base-index 1
      setw -g mouse on

      unbind C-b
      set-option -g prefix C-f

      bind-key -Tcopy-mode-vi 'v' send -X begin-selection
      bind-key -r o run-shell "tmux neww npx --yes tsx $DOTFILES_DIR/scripts/wo/bin/tmux-wo-sessionizer.ts"

      set -g @thumbs-command 'echo -n {} | clip.exe && tmux display-message \"Copied {}\"'
      set -g @thumbs-upcase-command 'wsl-open {}'

      set -g @continuum-restore 'on'
      set -g @continuum-save-interval '10'
      set -g @resurrect-capture-pane-contents 'on'
      set -g @resurrect-strategy-nvim 'session'

      # Status bar configuration using catppuccin modules
      set -g status-left-length 100
      set -g status-right-length 100
      set -g status-left "#{E:@catppuccin_status_session}"
      set -g status-right "#{E:@catppuccin_status_directory}#{E:@catppuccin_status_date_time}"
    '';
  };

  programs.home-manager = {
    enable = true;
  };

  home.file.".local/bin/wf-run" = {
    source = ../../scripts/wf/wf-run.sh;
    executable = true;
  };

  systemd.user.services.review-requests-to-trello = {
    Unit = {
      Description = "Sync GitHub review requests to Trello";
    };
    Service = {
      Type = "oneshot";
      Environment = [
        "PATH=${pkgs.dash}/bin:${pkgs.bash}/bin:${pkgs.nodejs_24}/bin:${pkgs.gh}/bin:/run/current-system/sw/bin"
        "SHELL=${pkgs.bash}/bin/bash"
      ];
      ExecStart = "%h/.local/bin/wf-run";
    };
  };

  systemd.user.timers.review-requests-to-trello = {
    Unit = {
      Description = "GitHub review requests to Trello every 5 minutes";
    };
    Timer = {
      OnCalendar = "*:0/5";
      Persistent = true;
    };
    Install = {
      WantedBy = [ "timers.target" ];
    };
  };

  systemd.user.services.copilot-ghe-refresh = {
    Unit = {
      Description = "Refresh GitHub Copilot GHE session token";
    };
    Service = {
      Type = "oneshot";
      Environment = [
        "PATH=${pkgs.nodejs_24}/bin:/run/current-system/sw/bin"
        "DOTFILES_DIR=%h/ghq/github.com/michalmatoga/dotfiles"
      ];
      ExecStart = "${pkgs.bash}/bin/bash -c '${pkgs.nodejs_24}/bin/npx --yes tsx \"$DOTFILES_DIR/scripts/copilot-ghe-auth.ts\" refresh'";
      StandardOutput = "journal";
      StandardError = "journal";
    };
  };

  systemd.user.timers.copilot-ghe-refresh = {
    Unit = {
      Description = "Refresh Copilot GHE token every 20 minutes";
    };
    Timer = {
      OnCalendar = "*:0/20";
      Persistent = true;
    };
    Install = {
      WantedBy = [ "timers.target" ];
    };
  };

  home.stateVersion = "23.11";
}
