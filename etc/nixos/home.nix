{ config, pkgs, ... }:

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

  home.file.".config/nvim" = {
    recursive = true;
    source = ../../.config/nvim;
  };

  home.file.".config/tmuxinator" = {
    recursive = true;
    source = ../../.config/tmuxinator;
  };

  home.file.".markdownlintrc" = {
    source = ../../.config/markdownlintrc.json;
  };

  # Packages that should be installed to the user profile.
  home.packages = with pkgs; [
    bitwarden-cli
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
    lua-language-server
    markdownlint-cli
    neofetch
    nmap # A utility for network discovery and security auditing
    nnn # terminal file manager
    nodejs_20 # nodejs & npm
    prettierd
    python3
    ripgrep # recursively searches directories for a regex pattern
    rustc
    tmux
    tmuxinator
    tree
    unzip
    which
    wsl-open # WSL-specific
    xdg-utils
    yq-go # yaml processor https://github.com/mikefarah/yq
    zig
    zip
    zstd
  ];

  # basic configuration of git, please change to your own
  programs.git = {
    enable = true;
    userName = "Michał Matoga";
    userEmail = "michalmatoga@gmail.com";
  };

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
      ];
    };
    shellAliases = {
      sync-repos = "node ~/ghq/github.com/michalmatoga/dotfiles/scripts/sync-repos.js";
      update = "sudo nixos-rebuild switch";
      cplc = "history | tail -n 1 | cut -d' ' -f5- | clip.exe";
      cpwd = "pwd | tr -d '\n' | clip.exe";
      mux = "tmuxinator start";
    };
    # setup some environment variables
    initExtra = '' 
      export BROWSER="wsl-open"
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
    terminal = "tmux-256color";
    historyLimit = 100000;
    plugins = with pkgs;
      [
        tmuxPlugins.jump
        tmuxPlugins.yank
        tmuxPlugins.tmux-thumbs
        tmuxPlugins.tmux-fzf
        tmuxPlugins.vim-tmux-navigator
        tmuxPlugins.catppuccin
      ];
    extraConfig = ''
      set-window-option -g mode-keys vi
      set-option -sg escape-time 10
      set -ag terminal-overrides ",xterm-256color:RGB"
      set -g @catppuccin_flavour "frappe"


      unbind C-b
      set-option -g prefix C-f

      bind-key -Tcopy-mode-vi 'v' send -X begin-selection

      set -g @thumbs-command 'echo -n {} | clip.exe && tmux display-message \"Copied {}\"'
      set -g @thumbs-upcase-command 'wsl-open {}'
    '';
  };


  programs.home-manager.enable = true;
  home.stateVersion = "23.11";
}
