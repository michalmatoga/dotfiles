{ lib
, fetchurl
, stdenv
}:

let
  pname = "agent-of-empires";
  version = "0.11.1";
  src = fetchurl {
    url = "https://github.com/njbrake/agent-of-empires/releases/download/v${version}/aoe-linux-amd64.tar.gz";
    hash = "sha256-f3iGsDI/LLRjOlx0gPL5+ueJQlK7D6ObWZ+GMdR9VCk=";
  };
in
stdenv.mkDerivation {
  inherit pname version;

  inherit src;

  dontBuild = true;

  unpackPhase = ''
    runHook preUnpack
    mkdir source
    tar -xzf "$src" -C source
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall
    install -D -m 0755 source/aoe-linux-amd64 "$out/bin/aoe"
    runHook postInstall
  '';

  meta = with lib; {
    description = "Terminal session manager for AI coding agents";
    homepage = "https://agent-of-empires.com/";
    license = licenses.mit;
    maintainers = with maintainers; [];
    mainProgram = "aoe";
    platforms = [ "x86_64-linux" ];
  };
}
