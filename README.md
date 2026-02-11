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
export DOTFILES_DIR="$HOME/ghq/github.com/michalmatoga/dotfiles"
sudo nix-channel --update && sudo nixos-rebuild switch && nix-shell -p git --run "git clone https://github.com/michalmatoga/dotfiles.git \"$DOTFILES_DIR\" && \"$DOTFILES_DIR/scripts/init.sh\""
```

`DOTFILES_DIR` must point at the dotfiles checkout for scripts and services.

### Hacks

After first running nvim and installing plugins with Lazy, run:

```sh
ln -s `which lua-language-server` ~/.local/share/nvim/mason/bin/lua-language-server
```

To fix Lua LSP. To edit alacritty config:

```sh
./.config/alacritty.toml
```

## Komorebi windows tiling manager

- [CLI reference - Komorebi](https://lgug2z.github.io/komorebi/cli/quickstart.html)

```powershell
komorebic start --whkd
komorebic stop --whkd
```

```sh

# komorebi config
./.config/komorebi.json

# hotkeys config
./.config/whkdrc

```

## Updating NixOS

```sh
# 1. Check the latest stable channel at https://status.nixos.org/
sudo nix-channel --add https://channels.nixos.org/nixos-24.11 nixos
sudo nixos-rebuild switch --upgrade
```

Reference: <https://superuser.com/questions/1604694/how-to-update-every-package-on-nixos>.

## Populating `.env` file

To persist `.env` file in `secrets.json`, run the following command:

```sh
jq --arg env "$(base64 -w 0 < .env)" '. + {".env": $env}' secrets.json > secrets.tmp && mv secrets.tmp secrets.json
```

To populate `.env` file from `secrets.json`, run the following command:

```sh
jq -r '.[".env"] | @base64d' secrets.json > .env

```
