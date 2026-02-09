{
  # description = "A very basic flake";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.05";
    nixpkgs-unstable.url = "github:nixos/nixpkgs/nixos-unstable";
    nixos-wsl.url = "github:nix-community/nixos-wsl";
    home-manager = {
      url = "github:nix-community/home-manager/release-25.05";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, nixpkgs-unstable, nixos-wsl, home-manager }:
  let
    system = "x86_64-linux";
    unstableBase = import nixpkgs-unstable { inherit system; };
    overlays = [
      (final: prev: {
        agent-of-empires = prev.callPackage ./agent-of-empires.nix { };
        gogcli = prev.callPackage ./gogcli.nix { unstableGo = unstableBase.go_1_25; };
        python3Packages = prev.python3Packages // {
          pynvim = unstableBase.python3Packages.pynvim;
        };
      })
    ];
    pkgs = import nixpkgs { inherit system overlays; };
    unstable = import nixpkgs-unstable { inherit system overlays; };
  in
  {
   nixosConfigurations.nixos = nixpkgs.lib.nixosSystem {
     system = "x86_64-linux";
     modules = [
      { nixpkgs.overlays = overlays; }
      ./configuration.nix
      nixos-wsl.nixosModules.wsl
      # make home-manager as a module of nixos
      # so that home-manager configuration will be deployed automatically when executing `nixos-rebuild switch`
      home-manager.nixosModules.home-manager
      {
        home-manager.useGlobalPkgs = true;
        home-manager.useUserPackages = true;
        home-manager.users.nixos = import ./home.nix;
        home-manager.extraSpecialArgs = { inherit unstable; };
      }
     ];
   };

   packages.${system} = {
     agent-of-empires = pkgs.agent-of-empires;
     gogcli = pkgs.gogcli;
   };
  };
}
