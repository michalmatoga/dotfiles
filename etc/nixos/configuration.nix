# Edit this configuration file to define what should be installed on
# your system. Help is available in the configuration.nix(5) man page, on
# https://search.nixos.org/options and in the NixOS manual (`nixos-help`).

# NixOS-WSL specific options are documented on the NixOS-WSL repository:
# https://github.com/nix-community/NixOS-WSL

{ config, lib, pkgs, ... }:

let
  my-kubernetes-helm = with pkgs; wrapHelm kubernetes-helm {
    plugins = with pkgs.kubernetes-helmPlugins; [
      helm-secrets
      helm-diff
      helm-s3
      helm-git
    ];
  };

  my-helmfile = pkgs.helmfile-wrapped.override {
    inherit (my-kubernetes-helm) pluginsDir;
  };
in
{
  wsl.enable = true;
  wsl.defaultUser = "nixos";
  nix.settings.experimental-features = [ "nix-command" "flakes" ];


  nixpkgs.config.allowUnfreePredicate = pkg:
    builtins.elem (lib.getName pkg) [
      # Add additional package names here
      "vault"
  ];

  environment.systemPackages = with pkgs; [
    docker
    git
    neovim
    curl
    icu
    wget
    (import ./win32yank.nix {inherit pkgs;})
    my-kubernetes-helm
    my-helmfile
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


  networking.extraHosts =
  ''
    23.50.55.26 svp-api-stage.akamaized.net
  '';


  virtualisation.docker.enable = true;

  time.timeZone = lib.mkDefault "Europe/Warsaw";

  security.pki.certificates = [ "/home/nixos/.local/share/mkcert/rootCA.pem" ];

  system.stateVersion = "23.11";
}
