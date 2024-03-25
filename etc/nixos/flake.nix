{
  description = "A very basic flake";
  
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-23.11";
    nixos-wsl.url = "github:nix-community/nixos-wsl";
    home-manager = {
      url = "github:nix-community/home-manager/release-23.11";
      # The `follows` keyword in inputs is used for inheritance.
      # Here, `inputs.nixpkgs` of home-manager is kept consistent with
      # the `inputs.nixpkgs` of the current flake,
      # to avoid problems caused by different versions of nixpkgs.
      inputs.nixpkgs.follows = "nixpkgs";
      shared = import ./shared.nix;
    };
  };

  outputs = { self, nixpkgs, nixos-wsl, home-manager }: {
     nixosConfigurations.nixos = nixpkgs.lib.nixosSystem {
       system = "x86_64-linux";
       modules = [
        ./configuration.nix
        nixos-wsl.nixosModules.wsl
        # make home-manager as a module of nixos
        # so that home-manager configuration will be deployed automatically when executing `nixos-rebuild switch`
        home-manager.nixosModules.home-manager
        {
          home-manager.useGlobalPkgs = true;
          home-manager.useUserPackages = true;
          home-manager.users.${shared.username} = import ./home.nix;

        }
       ];
     };
  };
}