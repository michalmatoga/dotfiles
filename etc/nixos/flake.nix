{
  # description = "A very basic flake";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-23.11";
    nixpkgs-unstable.url = "github:nixos/nixpkgs/nixos-unstable";
    nixos-wsl.url = "github:nix-community/nixos-wsl";
    home-manager = {
      url = "github:nix-community/home-manager/release-23.11";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, nixpkgs-unstable, nixos-wsl, home-manager }:
  let
    pkgs = import nixpkgs {inherit system;};
    unstable = import nixpkgs-unstable {inherit system;};
  in
  {
   nixosConfigurations.nixos = nixpkgs.lib.nixosSystem {
     system = "x86_64-linux";
     # unstable = import nixpkgs-unstable { inherit system };
     # specialArgs = { inherit unstable; };
     modules = [
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
  };
};

