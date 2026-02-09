{ config, pkgs, unstable, ... }:

let
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

    Host schibsted.ghe.com
      IdentityFile ~/.ssh/id_rsa
      IdentitiesOnly yes
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

  home.file.".config/opencode/config.json" = {
    source = ../../.config/opencode/config.json;
  };

  home.file.".config/k9s/skins/catppuccin-frappe.yaml" = {
    source = ../../.config/k9s/skins/catppuccin-frappe.yaml;
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
      cq = "npx tsx /home/nixos/ghq/github.com/michalmatoga/dotfiles/scripts/cq.ts";
      dffmpeg = "bash /home/nixos/ghq/github.schibsted.io/svp/node-ffmpeg/ffmpeg.sh";
      dk = "docker";
      gr = "bash /home/nixos/ghq/github.com/michalmatoga/dotfiles/scripts/gr.sh";
      gtm-clean-all = "npx tsx /home/nixos/ghq/github.com/michalmatoga/dotfiles/scripts/gtm-clean-all.ts";
      hg = "npx tsx /home/nixos/ghq/github.com/michalmatoga/dotfiles/scripts/hg/hg.ts";
      hgs = "npx tsx /home/nixos/ghq/github.com/michalmatoga/dotfiles/scripts/hg/hgs.ts";
      ldk = "lazydocker";
      meetings = "bash /home/nixos/ghq/github.com/michalmatoga/dotfiles/scripts/meetings.sh";
      nag = "bash ~/ghq/github.com/michalmatoga/dotfiles/scripts/nag.sh";
      oc = "opencode --port";
      ody = "npx tsx /home/nixos/ghq/github.com/michalmatoga/dotfiles/scripts/hg/ody.ts";
      odyr = "pkill -f ody.ts && tmux send-keys -t ody:1 'ody' C-m";
      paste = "powershell.exe get-clipboard";
      pi = "pulumi";
      pulumi = "bash ~/ghq/github.com/michalmatoga/dotfiles/scripts/pulumi.sh";
      shutdown-ritual = "npx tsx ~/ghq/github.com/michalmatoga/dotfiles/scripts/shutdown.ts";
      startup-ritual = "npx tsx ~/ghq/github.com/michalmatoga/dotfiles/scripts/startup.ts";
      sync-ghec = "npx tsx ~/ghq/github.com/michalmatoga/dotfiles/scripts/sync-ghec.ts";
      sync-repos = "node ~/ghq/github.com/michalmatoga/dotfiles/scripts/sync-repos.mjs";
      tf = "tofu";
      update = "sudo nixos-rebuild switch && ~/ghq/github.com/michalmatoga/dotfiles/scripts/post-update.sh";
      update-npm-deps = "npx tsx /home/nixos/ghq/github.com/michalmatoga/dotfiles/scripts/update-npm-deps.ts";
    };
    # setup some environment variables
    initContent = ''
      export BROWSER="wsl-open"
      export GH_USER="michalmatoga"
      export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=true
      export HOST_IP="$(ip route | awk '/default/ {print $3; exit}')"

      export NIX_LD=$(nix eval --impure --raw --expr 'let pkgs = import <nixpkgs> {}; NIX_LD = pkgs.lib.fileContents "${pkgs.stdenv.cc}/nix-support/dynamic-linker"; in NIX_LD')
      export PATH="$HOME/.cache/npm/global/bin:$PATH"
      source ~/ghq/github.com/michalmatoga/dotfiles/.env

      if [ -f ~/ghq/github.com/michalmatoga/dotfiles/secrets.json ]; then
        humio_address=$(jq -r '.humio.address // empty' ~/ghq/github.com/michalmatoga/dotfiles/secrets.json)
        humio_token=$(jq -r '.humio.token // empty' ~/ghq/github.com/michalmatoga/dotfiles/secrets.json)
        humio_default_repo=$(jq -r '.humio.default_repo // empty' ~/ghq/github.com/michalmatoga/dotfiles/secrets.json)
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

      if [ -f ~/ghq/github.com/michalmatoga/dotfiles/scripts/humioctl-wrapper.zsh ]; then
        source ~/ghq/github.com/michalmatoga/dotfiles/scripts/humioctl-wrapper.zsh
      fi

      alias PWD='pwd' # necessary for compatibility with sourced script below
      source ~/ghq/github.com/michalmatoga/dotfiles/dist/gtm-terminal-plugin/gtm-plugin.sh

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
          skin = "catppuccin-frappe";
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
        tmuxPlugins.catppuccin
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
      set -g @catppuccin_flavour "frappe"
      set -g base-index 1
      setw -g pane-base-index 1
      setw -g mouse on

      unbind C-b
      set-option -g prefix C-f

      bind-key -Tcopy-mode-vi 'v' send -X begin-selection
      bind-key -r o run-shell "tmux neww ~/ghq/github.com/michalmatoga/dotfiles/scripts/tmux-sessionizer.sh"

      set -g @thumbs-command 'echo -n {} | clip.exe && tmux display-message \"Copied {}\"'
      set -g @thumbs-upcase-command 'wsl-open {}'

      set -g @continuum-restore 'on'
      set -g @continuum-save-interval '10'
      set -g @resurrect-capture-pane-contents 'on'
      set -g @resurrect-strategy-nvim 'session'
    '';
  };

  programs.home-manager = {
    enable = true;
  };

  systemd.user.services.review-requests-to-trello = {
    Unit = {
      Description = "Sync GitHub review requests to Trello";
    };
    Service = {
      Type = "oneshot";
      WorkingDirectory = "%h/ghq/github.com/michalmatoga/dotfiles";
      ExecStart = "${pkgs.nodejs_24}/bin/npx --yes tsx %h/ghq/github.com/michalmatoga/dotfiles/scripts/wf/main.ts";
    };
  };

  systemd.user.timers.review-requests-to-trello = {
    Unit = {
      Description = "Hourly GitHub review requests to Trello";
    };
    Timer = {
      OnCalendar = "hourly";
      Persistent = true;
    };
    Install = {
      WantedBy = [ "timers.target" ];
    };
  };

  home.stateVersion = "23.11";
}
