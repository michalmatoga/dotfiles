{ config, pkgs, unstable, ... }:

let
  unstablePackages = with unstable; [
    pulumi
    pulumiPackages.pulumi-language-nodejs
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

  home.file.".config/lazydocker/config.yml" = {
    source = ../../.config/lazydocker/config.yml;
  };

  home.file.".config/k9s/skins/catppuccin-frappe.yaml" = {
    source = ../../.config/k9s/skins/catppuccin-frappe.yaml;
  };

  home.file.".markdownlintrc" = {
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
    corepack_20
    direnv
    eslint_d
    eza # A modern replacement for ‘ls’
    ffmpeg_7-full
    file
    fd
    flyctl
    gawk
    gcc
    gh
    ghq
    git-crypt
    gnumake
    gnupg
    gnused
    gnutar
    jq # A lightweight and flexible command-line JSON processor
    kubectl
    lazydocker
    linode-cli
    lua-language-server
    mariadb
    markdownlint-cli
    mkcert
    mongodb-tools
    neofetch
    nmap # A utility for network discovery and security auditing
    nodejs_22 # nodejs & npm
    openssl
    opentofu
    pgadmin4
    php
    postgresql_17
    prettierd
    python3
    restic
    ripgrep # recursively searches directories for a regex pattern
    rustc
    tmux
    unzip
    vault
    wsl-open # WSL-specific
    xdg-utils
    yq-go # yaml processor https://github.com/mikefarah/yq
    zig
    zip
    zstd
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
      cplc = "history | tail -n 1 | cut -d' ' -f4- | clip.exe";
      cpwd = "pwd | tr -d '\n' | clip.exe";
      copy = "clip.exe";
      paste = "powershell.exe get-clipboard";
      sync-repos = "node ~/ghq/github.com/michalmatoga/dotfiles/scripts/sync-repos.mjs";
      update = "sudo nixos-rebuild switch && ~/ghq/github.com/michalmatoga/dotfiles/scripts/post-update.sh";
      tf = "tofu";
      dffmpeg = "bash /home/nixos/ghq/github.schibsted.io/svp/node-ffmpeg/ffmpeg.sh";
      pulumi = "bash ~/ghq/github.com/michalmatoga/dotfiles/scripts/pulumi.sh";
      pi = "pulumi";
      nag = "bash ~/ghq/github.com/michalmatoga/dotfiles/scripts/nag.sh";
      pomo = "npx tsx ~/ghq/github.com/michalmatoga/dotfiles/scripts/pomo.ts";
    };
    # setup some environment variables
    initExtra = ''
      export BROWSER="wsl-open"
      export GH_USER="michalmatoga"

      export NIX_LD=$(nix eval --impure --raw --expr 'let pkgs = import <nixpkgs> {}; NIX_LD = pkgs.lib.fileContents "${pkgs.stdenv.cc}/nix-support/dynamic-linker"; in NIX_LD')
      export PATH="$HOME/.cache/npm/global/bin:$PATH"
      source ~/ghq/github.com/michalmatoga/dotfiles/.env
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
      set-option -g default-terminal "xterm-256color"
      set -ag terminal-overrides ",xterm-256color:RGB"
      set -g @catppuccin_flavour "frappe"
      set -g base-index 1
      setw -g pane-base-index 1
      setw -g mouse on

      unbind C-b
      set-option -g prefix C-f

      bind-key -Tcopy-mode-vi 'v' send -X begin-selection
      bind-key r resize-pane -x 70

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

  home.stateVersion = "23.11";
}
