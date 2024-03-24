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
    git
    neovim
    curl
  ];
  
  users.users.michmato = {
    isNormalUser = true;
    group = "michmato";
    openssh.authorizedKeys.keys = [
        # Replace with your own public key
        "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7UM9MJ5Nf1Ht7E2QDdSh1wuZcjjYy0BlQv6NIIwEwUZpwMg4YFtMD+QcT+xergDHzaVbNgjXC0jouLnLAF3o3k67mXYguflm4iRHgy4c4EwtDE1gljnpCj6JrDuWFOXib8WRLwgRyc5CiY5QvT/dlJX0jVq5xbSpjd8DAOXTYve1GQTOfvgylVVaCKBbwxH2Y29EuXsmUAVP9fGIsbLjLZ/dacpgxeN3il/SdklKZWAXb3Ec/KodgWC9V/4GdqtvLNu36h7OO17+yiomx2Rx50/NEcqHj4ld8ZNcflE/fZ6Fu6xB4l6G/ANg9Ypu/AmQ8a7OZe6WBNllK7YFrY8Sn"
    ];
  };
	users.groups.michmato = {};



  # This value determines the NixOS release from which the default
  # settings for stateful data, like file locations and database versions
  # on your system were taken. It's perfectly fine and recommended to leave
  # this value at the release version of the first install of this system.
  # Before changing this value read the documentation for this option
  # (e.g. man configuration.nix or on https://nixos.org/nixos/options.html).
  system.stateVersion = "23.11"; # Did you read the comment?
}