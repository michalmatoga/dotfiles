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
      UserKnownHostsFile=/dev/null
  '';

  # Packages that should be installed to the user profile.
  home.packages = with pkgs; [
    # here is some command line tools I use frequently
    # feel free to add your own or remove some of them

    neofetch
    nnn # terminal file manager

    # archives
    zip

    # utils
    ripgrep # recursively searches directories for a regex pattern
    jq # A lightweight and flexible command-line JSON processor
    yq-go # yaml processor https://github.com/mikefarah/yq
    eza # A modern replacement for ‘ls’
    fzf # A command-line fuzzy finder
		tmux
    xdg-utils
    make
    gcc
    zig

    # networking tools
    nmap # A utility for network discovery and security auditing

    # misc
    file
    which
    tree
    gnused
    gnutar
    gawk
    zstd
    gnupg
    
    bitwarden-cli
    git-crypt
    ghq
    gnupg
    jq
    nodejs-slim_20

    # WSL-specific
    wsl-open
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
      line_break.disabled = true;
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
      cplc="history | tail -n 1 | cut -d' ' -f5- | clip.exe";
      cpwd="pwd | tr -d '\n' | clip.exe";
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
    terminal = "tmux-256color";
    historyLimit = 100000;
    plugins = with pkgs;
      [
        tmuxPlugins.jump
        tmuxPlugins.yank
        tmuxPlugins.tmux-thumbs
      ];
    extraConfig = ''
      set-window-option -g mode-keys vi
      set -g status-right '#(TZ="Europe/Warsaw" date +"%Y-%m-%d %%H:%%M")'

      unbind C-b
      set-option -g prefix C-f

      unbind p
      bind p paste-buffer
      bind-key -Tcopy-mode-vi 'v' send -X begin-selection
      
      set -g @thumbs-command 'echo -n {} | clip.exe && tmux display-message \"Copied {}\"'
      set -g @thumbs-upcase-command 'wsl-open {}'
    '';
  };


  programs.home-manager.enable = true;
  home.stateVersion = "23.11";
}