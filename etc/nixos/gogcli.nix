{ lib
, buildGoModule
, fetchFromGitHub
, installShellFiles
, unstableGo ? null
}:

let
  pname = "gogcli";
  version = "0.9.0";
  rev = "99d957581f61532de08f3847e79f639edad3c68b";
  commitShort = lib.strings.substring 0 12 rev;
  goModuleBuilder =
    if unstableGo != null then
      buildGoModule.override { go = unstableGo; }
    else
      buildGoModule;
in
goModuleBuilder rec {
  inherit pname version;

  src = fetchFromGitHub {
    owner = "steipete";
    repo = pname;
    inherit rev;
    hash = "sha256-DXRw5jf/5fC8rgwLIy5m9qkxy3zQNrUpVG5C0RV7zKM=";
  };

  vendorHash = "sha256-nig3GI7eM1XRtIoAh1qH+9PxPPGynl01dCZ2ppyhmzU=";

  subPackages = [ "cmd/gog" ];

  ldflags = [
    "-s"
    "-w"
    "-X github.com/steipete/gogcli/internal/cmd.version=${version}"
    "-X github.com/steipete/gogcli/internal/cmd.commit=${commitShort}"
    "-X github.com/steipete/gogcli/internal/cmd.date=2026-01-22T04:14:55Z"
  ];

  nativeBuildInputs = [ installShellFiles ];

  postInstall = ''
    installShellCompletion --cmd gog \
      --bash <($out/bin/gog completion bash) \
      --fish <($out/bin/gog completion fish) \
      --zsh <($out/bin/gog completion zsh)
  '';

  doCheck = false;

  meta = with lib; {
    description = "CLI for Google Workspace services";
    homepage = "https://gogcli.sh/";
    license = licenses.mit;
    maintainers = with maintainers; [];
    mainProgram = "gog";
    platforms = platforms.linux;
  };
}
