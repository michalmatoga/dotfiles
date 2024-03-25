# dotfiles

## WSL

Assuming WSL2 is already configured. In powershell:

```powershell
# Check for new releases at https://github.com/nix-community/NixOS-WSL/releases
Invoke-WebRequest -Uri "https://github.com/nix-community/NixOS-WSL/releases/download/2311.5.3/nixos-wsl.tar.gz" -OutFile "nixos-wsl.tar.gz"
wsl --import NixOS $env:USERPROFILE\NixOS\ nixos-wsl.tar.gz
wsl -d NixOS
```

In NixOS shell:

```sh
sudo nix-channel --update && sudo nixos-rebuild switch
nix-shell -p git
mkdir ~/.ssh
# Grab your SSH private key to clipboard, then:
# cat ~/.ssh/id_rsa | clip.exe
powershell.exe -command 'Get-Clipboard' > ~/.ssh/id_rsa
chmod 600 ~/.ssh/id_rsa
ssh-keygen -y -f ~/.ssh/id_rsa > ~/.ssh/id_rsa.pub
git clone git@github.com:michalmatoga/dotfiles.git ./c/github.com/michalmatoga/dotfiles
sudo mv /etc/nixos /etc/nixos.bak
sudo ln -s ~/dotfiles/etc/nixos/ /etc/nixos
sudo nixos-rebuild switch
rm -rf /etc/nixos.bak
```
