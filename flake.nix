{
  description = "marginalia: 読書アウトプットMVP";

  # GitHub API のレート制限・制限環境を避けるため、NixOS 公式チャンネルの tarball を使う
  # (リビジョンは flake.lock で固定される)
  inputs.nixpkgs.url = "https://channels.nixos.org/nixos-unstable/nixexprs.tar.xz";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          # ローカルは bun だけ(Node / npm は入れない)。Lambda の実行環境は AWS 側の Node 24
          packages = [ pkgs.bun ];
          shellHook = ''
            echo "bun $(bun --version)"
          '';
        };
      });
    };
}
