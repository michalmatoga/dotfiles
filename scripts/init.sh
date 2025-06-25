#!/usr/bin/env bash

CHECKOUT_PATH=~/ghq/github.com/michalmatoga/dotfiles

sudo rm -rf /etc/nixos
sudo ln -s "$CHECKOUT_PATH/etc/nixos/" /etc/nixos
sudo nix-channel --update && sudo nixos-rebuild switch

cd $CHECKOUT_PATH
bw login
export BW_SESSION=$(bw unlock --raw)
bw get item 6672d1f6-cde1-4582-be66-b13e00a82547 | jq -r .notes | gpg --import
git-crypt unlock
cat secrets.json | jq -r '.gpg_work' | base64 -d | gpg --import
eval $(ssh-agent)
mkdir ~/.ssh
jq -r '.id_rsa' secrets.json | base64 -d >~/.ssh/id_rsa
chmod 600 ~/.ssh/id_rsa
ssh-keygen -y -f ~/.ssh/id_rsa >~/.ssh/id_rsa.pub
node scripts/sync-repos.mjs
cd ~

# OUT="${XDG_CONFIG_HOME:-$HOME/.config}/k9s/skins"
# mkdir -p "$OUT"
# curl -L https://github.com/catppuccin/k9s/archive/main.tar.gz | tar xz -C "$OUT" --strip-components=2 k9s-main/dist

mkdir -p ~/.kube
cat secrets.json | jq -r '.kubeconfig_work' | base64 -d >~/.kube/config
mkdir -p ~/.cache/npm/global

# Install git-time-metric
curl -L https://github.com/git-time-metric/gtm/releases/download/v1.3.5/gtm.v1.3.5.linux.tar.gz | tar xz && sudo mv gtm /usr/bin/ # TODO: remove after gitm is present in nixos packages
