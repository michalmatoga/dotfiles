# dotfiles

## WSL2

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
nix-shell -p bitwarden-cli git git-crypt ghq gnupg jq nodejs-slim_20
bw login
export BW_SESSION=$(bw unlock --raw)
export PAT=$(bw get item 9d72d740-f444-4c8a-9559-ad37009bc2d3 | jq -r '.fields[] | select(.name=="PAT [GENERAL]") | .value')
git clone https://$PAT@github.com/michalmatoga/dotfiles.git ~/tmp/dotfiles
bw get item 6672d1f6-cde1-4582-be66-b13e00a82547 | jq -r .notes | gpg --import
cd ~/tmp/dotfiles
git-crypt unlock
mkdir ~/.ssh
jq -r '.id_rsa' secrets.json | base64 -d > ~/.ssh/id_rsa
chmod 600 ~/.ssh/id_rsa
ssh-keygen -y -f ~/.ssh/id_rsa > ~/.ssh/id_rsa.pub
node scripts/clone-all.js
cd ~
sudo mv /etc/nixos /etc/nixos.bak
sudo ln -s ~/ghq/github.com/michalmatoga/dotfiles/etc/nixos/ /etc/nixos
sudo nixos-rebuild switch
rm -rf /etc/nixos.bak ~/tmp
```
