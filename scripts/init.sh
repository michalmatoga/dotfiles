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
eval $(ssh-agent)
mkdir ~/.ssh
jq -r '.id_rsa' secrets.json | base64 -d > ~/.ssh/id_rsa
chmod 600 ~/.ssh/id_rsa
ssh-keygen -y -f ~/.ssh/id_rsa > ~/.ssh/id_rsa.pub
node scripts/sync-repos.mjs
cd ~
