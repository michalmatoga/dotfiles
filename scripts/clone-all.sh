ORGANIZATION=elikonas
TOKEN=your_token

curl -s -H "Authorization: token $TOKEN" "https://api.github.com/orgs/$ORGANIZATION/repos?per_page=100" | \
  grep -o 'git@[^"]*' | \
  xargs -L1 git clone