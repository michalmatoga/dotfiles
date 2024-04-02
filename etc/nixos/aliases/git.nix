{ config, lib, pkgs, ... }:

{
  programs.zsh.shellAliases = {
		"gcan!"="git commit --verbose --all --no-edit --amend";
		ga="git add";
		gco="git checkout";
		glgg="git log --graph";
		gp="git push";
		gpsup="git push --set-upstream origin $(git_current_branch)";
		grh="git reset";
		grhh="git reset --hard";
		gst="git status";
		grt='cd "$(git rev-parse --show-toplevel || echo .)"';
		# egrep='grep -E --color=auto --exclude-dir={.bzr,CVS,.git,.hg,.svn,.idea,.tox}'
		# fgrep='grep -F --color=auto --exclude-dir={.bzr,CVS,.git,.hg,.svn,.idea,.tox}'
		# g=git
		# gaa='git add --all'
		# gam='git am'
		# gama='git am --abort'
		# gamc='git am --continue'
		# gams='git am --skip'
		# gamscp='git am --show-current-patch'
		# gap='git apply'
		# gapa='git add --patch'
		# gapt='git apply --3way'
		# gau='git add --update'
		# gav='git add --verbose'
		# gb='git branch'
		# gbD='git branch --delete --force'
		# gba='git branch --all'
		# gbd='git branch --delete'
		# gbda='git branch --no-color --merged | command grep -vE "^([+*]|\s*($(git_main_branch)|$(git_develop_branch))\s*$)" | command xargs git branch --delete 2>/dev/null'
		# gbg='git branch -vv | grep ": gone\]"'
		# gbgD='git branch --no-color -vv | grep ": gone\]" | awk '\''{print $1}'\'' | xargs git branch -D'
		# gbgd='git branch --no-color -vv | grep ": gone\]" | awk '\''{print $1}'\'' | xargs git branch -d'
		# gbl='git blame -b -w'
		# gbnm='git branch --no-merged'
		# gbr='git branch --remote'
		# gbs='git bisect'
		# gbsb='git bisect bad'
		# gbsg='git bisect good'
		# gbsr='git bisect reset'
		# gbss='git bisect start'
		# gc='git commit --verbose'
		# 'gc!'='git commit --verbose --amend'
		# gca='git commit --verbose --all'
		# 'gca!'='git commit --verbose --all --amend'
		# gcam='git commit --all --message'
		# 'gcans!'='git commit --verbose --all --signoff --no-edit --amend'
		# gcas='git commit --all --signoff'
		# gcasm='git commit --all --signoff --message'
		# gcb='git checkout -b'
		# gcd='git checkout $(git_develop_branch)'
		# gcf='git config --list'
		# gcl='git clone --recurse-submodules'
		# gclean='git clean --interactive -d'
		# gcm='git checkout $(git_main_branch)'
		# gcmsg='git commit --message'
		# 'gcn!'='git commit --verbose --no-edit --amend'
		# gcor='git checkout --recurse-submodules'
		# gcount='git shortlog --summary --numbered'
		# gcp='git cherry-pick'
		# gcpa='git cherry-pick --abort'
		# gcpc='git cherry-pick --continue'
		# gcs='git commit --gpg-sign'
		# gcsm='git commit --signoff --message'
		# gcss='git commit --gpg-sign --signoff'
		# gcssm='git commit --gpg-sign --signoff --message'
		# gd='git diff'
		# gdca='git diff --cached'
		# gdct='git describe --tags $(git rev-list --tags --max-count=1)'
		# gdcw='git diff --cached --word-diff'
		# gds='git diff --staged'
		# gdt='git diff-tree --no-commit-id --name-only -r'
		# gdup='git diff @{upstream}'
		# gdw='git diff --word-diff'
		# gf='git fetch'
		# gfa='git fetch --all --prune --jobs=10'
		# gfg='git ls-files | grep'
		# gfo='git fetch origin'
		# gg='git gui citool'
		# gga='git gui citool --amend'
		# ggpull='git pull origin "$(git_current_branch)"'
		# ggpush='git push origin "$(git_current_branch)"'
		# ggsup='git branch --set-upstream-to=origin/$(git_current_branch)'
		# ghh='git help'
		# gignore='git update-index --assume-unchanged'
		# gignored='git ls-files -v | grep "^[[:lower:]]"'
		# git-svn-dcommit-push='git svn dcommit && git push github $(git_main_branch):svntrunk'
		# gk='\gitk --all --branches &!'
		# gke='\gitk --all $(git log --walk-reflogs --pretty=%h) &!'
		# gl='git pull'
		# glg='git log --stat'
		# glgga='git log --graph --decorate --all'
		# glgm='git log --graph --max-count=10'
		# glgp='git log --stat --patch'
		# glo='git log --oneline --decorate'
		# glod='git log --graph --pretty='\''%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ad) %C(bold blue)<%an>%Creset'\'
		# glods='git log --graph --pretty='\''%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ad) %C(bold blue)<%an>%Creset'\'' --date=short'
		# glog='git log --oneline --decorate --graph'
		# gloga='git log --oneline --decorate --graph --all'
		# glol='git log --graph --pretty='\''%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ar) %C(bold blue)<%an>%Creset'\'
		# glola='git log --graph --pretty='\''%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ar) %C(bold blue)<%an>%Creset'\'' --all'
		# glols='git log --graph --pretty='\''%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ar) %C(bold blue)<%an>%Creset'\'' --stat'
		# glp=_git_log_prettily
		# gluc='git pull upstream $(git_current_branch)'
		# glum='git pull upstream $(git_main_branch)'
		# gm='git merge'
		# gma='git merge --abort'
		# gmom='git merge origin/$(git_main_branch)'
		# gms='git merge --squash'
		# gmtl='git mergetool --no-prompt'
		# gmtlvim='git mergetool --no-prompt --tool=vimdiff'
		# gmum='git merge upstream/$(git_main_branch)'
		# gpd='git push --dry-run'
		# gpf='git push --force-with-lease --force-if-includes'
		# 'gpf!'='git push --force'
		# gpoat='git push origin --all && git push origin --tags'
		# gpod='git push origin --delete'
		# gpr='git pull --rebase'
		# gpristine='git reset --hard && git clean --force -dfx'
		# gpsupf='git push --set-upstream origin $(git_current_branch) --force-with-lease --force-if-includes'
		# gpu='git push upstream'
		# gpv='git push --verbose'
		# gr='git remote'
		# gra='git remote add'
		# grb='git rebase'
		# grba='git rebase --abort'
		# grbc='git rebase --continue'
		# grbd='git rebase $(git_develop_branch)'
		# grbi='git rebase --interactive'
		# grbm='git rebase $(git_main_branch)'
		# grbo='git rebase --onto'
		# grbom='git rebase origin/$(git_main_branch)'
		# grbs='git rebase --skip'
		# grep='grep --color=auto --exclude-dir={.bzr,CVS,.git,.hg,.svn,.idea,.tox}'
		# grev='git revert'
		# grm='git rm'
		# grmc='git rm --cached'
		# grmv='git remote rename'
		# groh='git reset origin/$(git_current_branch) --hard'
		# grrm='git remote remove'
		# grs='git restore'
		# grset='git remote set-url'
		# grss='git restore --source'
		# grst='git restore --staged'
		# gru='git reset --'
		# grup='git remote update'
		# grv='git remote --verbose'
		# gsb='git status --short --branch'
		# gsd='git svn dcommit'
		# gsh='git show'
		# gsi='git submodule init'
		# gsps='git show --pretty=short --show-signature'
		# gsr='git svn rebase'
		# gss='git status --short'
		# gsta='git stash push'
		# gstaa='git stash apply'
		# gstall='git stash --all'
		# gstc='git stash clear'
		# gstd='git stash drop'
		# gstl='git stash list'
		# gstp='git stash pop'
		# gsts='git stash show --text'
		# gsu='git submodule update'
		# gsw='git switch'
		# gswc='git switch --create'
		# gswd='git switch $(git_develop_branch)'
		# gswm='git switch $(git_main_branch)'
		# gtl='gtl(){ git tag --sort=-v:refname -n --list "${1}*" }; noglob gtl'
		# gts='git tag --sign'
		# gtv='git tag | sort -V'
		# gunignore='git update-index --no-assume-unchanged'
		# gunwip='git rev-list --max-count=1 --format="%s" HEAD | grep -q "\--wip--" && git reset HEAD~1'
		# gup='git pull --rebase'
		# gupa='git pull --rebase --autostash'
		# gupav='git pull --rebase --autostash --verbose'
		# gupom='git pull --rebase origin $(git_main_branch)'
		# gupomi='git pull --rebase=interactive origin $(git_main_branch)'
		# gupv='git pull --rebase --verbose'
		# gwch='git whatchanged -p --abbrev-commit --pretty=medium'
		# gwip='git add -A; git rm $(git ls-files --deleted) 2> /dev/null; git commit --no-verify --no-gpg-sign --message "--wip-- [skip ci]"'
		# gwt='git worktree'
		# gwta='git worktree add'
		# gwtls='git worktree list'
		# gwtmv='git worktree move'
		# gwtrm='git worktree remove'
  };
}
