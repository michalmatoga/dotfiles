# Edit this configuration file to define what should be installed on
# your system. Help is available in the configuration.nix(5) man page, on
# https://search.nixos.org/options and in the NixOS manual (`nixos-help`).

# NixOS-WSL specific options are documented on the NixOS-WSL repository:
# https://github.com/nix-community/NixOS-WSL

{ config, lib, pkgs, ... }:

{
  wsl.enable = true;
  wsl.defaultUser = "nixos";
  nix.settings.experimental-features = [ "nix-command" "flakes" ];
  environment.systemPackages = with pkgs; [
    docker
    git
    neovim
    curl
    wget
    (import ./win32yank.nix {inherit pkgs;})
  ];

  programs.gnupg = {
    agent = {
      enable = true;
    };
  };

  programs.nix-ld.enable = true;

  programs.ssh.startAgent = true;

  programs.zsh.enable = true;

  users.defaultUserShell = pkgs.zsh;
  users.users.nixos.extraGroups = [ "docker" ];

  virtualisation.docker.enable = true;

  time.timeZone = lib.mkDefault "Europe/Warsaw";

  system.stateVersion = "23.11";
}
