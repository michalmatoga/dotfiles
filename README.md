# dotfiles

## WSL2

In powershell:

```powershell
wsl --install # if not already installed
# Check for new releases at https://github.com/nix-community/NixOS-WSL/releases
Invoke-WebRequest -Uri "https://github.com/nix-community/NixOS-WSL/releases/download/2311.5.3/nixos-wsl.tar.gz" -OutFile "nixos-wsl.tar.gz"
wsl --import NixOS $env:USERPROFILE\NixOS\ nixos-wsl.tar.gz
wsl -d NixOS
```

In NixOS shell:

```sh
sudo nix-channel --update && sudo nixos-rebuild switch
nix-shell -p git --run "git clone https://github.com/michalmatoga/dotfiles.git ~/ghq/github.com/michalmatoga/dotfiles"
./ghq/github.com/michalmatoga/dotfiles/scripts/init.sh
# curl -s https://gist.githubusercontent.com/michalmatoga/16b0c49f48a4115d0bdfd959451164e1/raw | bash
```
