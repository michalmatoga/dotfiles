{ config, pkgs, ... }:

let
  unstable = import <nixos-unstable> { config = { allowUnfree = true; }; };
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
    source = ../../.config/nvim;
  };

  home.file.".config/tmuxinator" = {
    recursive = true;
    source = ../../.config/tmuxinator;
  };

  home.file.".config/lazydocker/config.yml" = {
    recursive = true;
    source = ../../.config/lazydocker/config.yml;
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

  # nixpkgs.config.packageOverrides = pkgs: {
  #   unstable = import <nixos-unstable> {
  #     config = config.nixpkgs.config;
  #   };
  # };

  # Packages that should be installed to the user profile.
  home.packages = with pkgs; [
    bitwarden-cli
    direnv
    eslint_d
    eza # A modern replacement for ‘ls’
    file
    fzf # A command-line fuzzy finder
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
    unstable.k9s
    kubectl
    lazydocker
    lua-language-server
    markdownlint-cli
    neofetch
    nmap # A utility for network discovery and security auditing
    nnn # terminal file manager
    nodejs_20 # nodejs & npm
    opentofu
    prettierd
    python3
    ripgrep # recursively searches directories for a regex pattern
    rustc
    tmux
    tmuxinator
    unzip
    vault
    which
    wsl-open # WSL-specific
    xdg-utils
    yq-go # yaml processor https://github.com/mikefarah/yq
    zig
    zip
    zstd
  ];

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
    shellAliases = {
      clip = "clip.exe";
      cplc = "history | tail -n 1 | cut -d' ' -f5- | clip.exe";
      cpwd = "pwd | tr -d '\n' | clip.exe";
      paste = "powershell.exe get-clipboard";
      pro = "tmuxinator start $(tmuxinator list --newline | fzf)";
      sync-repos = "node ~/ghq/github.com/michalmatoga/dotfiles/scripts/sync-repos.mjs";
      update = "sudo nixos-rebuild switch";
      tf = "tofu";
    };
    # setup some environment variables
    initExtra = ''
      export BROWSER="wsl-open"
      export GH_USER="michalmatoga"

      export NIX_LD=$(nix eval --impure --raw --expr 'let pkgs = import <nixpkgs> {}; NIX_LD = pkgs.lib.fileContents "${pkgs.stdenv.cc}/nix-support/dynamic-linker"; in NIX_LD')
      export PATH="$HOME/.cache/npm/global/bin:$PATH"
      export TERM=xterm-256color
    '';
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
      set -ag terminal-overrides ",xterm-256color:RGB"
      set -g @catppuccin_flavour "frappe"
      set -g base-index 1
      setw -g pane-base-index 1
      setw -g mouse on

      unbind C-b
      set-option -g prefix C-f

      bind-key -Tcopy-mode-vi 'v' send -X begin-selection

      set -g @thumbs-command 'echo -n {} | clip.exe && tmux display-message \"Copied {}\"'
      set -g @thumbs-upcase-command 'wsl-open {}'

      set -g @continuum-restore 'on'
      set -g @continuum-save-interval '10'
      set -g @resurrect-capture-pane-contents 'on'
      set -g @resurrect-strategy-nvim 'session'
    '';
  };


  programs.home-manager.enable = true;
  home.stateVersion = "23.11";
}
