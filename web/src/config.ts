export interface RuntimeConfig {
  userPoolId: string;
  userPoolClientId: string;
}

/**
 * Cognito の ID は CDK デプロイ時に /config.json として書き出す(ビルドし直さずに済むように)。
 * 開発時は web/public/config.json を置く(config.example.json を参照)。
 */
export async function loadConfig(): Promise<RuntimeConfig> {
  const res = await fetch("/config.json", { cache: "no-store" });
  if (!res.ok) throw new Error("config.json を読み込めませんでした");
  return (await res.json()) as RuntimeConfig;
}
