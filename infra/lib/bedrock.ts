/**
 * Converse(bedrock:InvokeModel)に必要な IAM リソース ARN を作る。
 *
 * クロスリージョン推論プロファイル(jp. / apac. / us. / eu. / global. など)を使う場合は、
 * プロファイル自体と、ルーティング先リージョンの基盤モデルの両方に権限が必要。
 * ルーティング先はプロファイルごとに決まるので、基盤モデルはリージョンをワイルドカードにする。
 */
const PROFILE_PREFIXES = ["jp", "apac", "us", "eu", "global", "au", "ca", "us-gov"];

export function bedrockModelArns(modelId: string, region: string, account: string, partition = "aws"): string[] {
  const [prefix, ...rest] = modelId.split(".");
  if (prefix && PROFILE_PREFIXES.includes(prefix) && rest.length > 0) {
    const base = rest.join(".");
    return [
      `arn:${partition}:bedrock:${region}:${account}:inference-profile/${modelId}`,
      `arn:${partition}:bedrock:*::foundation-model/${base}*`,
    ];
  }
  return [`arn:${partition}:bedrock:${region}::foundation-model/${modelId}*`];
}

/**
 * モデルごとの Converse 設定(additionalModelRequestFields と出力上限)。
 * - Haiku 系: thinking を無効化できる。短い出力なので無効にする(仕様の maxTokens をそのまま使える)
 * - Sonnet 5.5 / Opus 5.5 など: thinking を無効化すると 400 になるため既定(adaptive)のまま送らない。
 *   思考にも出力トークンを使うので上限を広げる
 */
export function modelRuntimeSettings(modelId: string, baseMaxTokens: number) {
  const isHaiku = /haiku/.test(modelId);
  return isHaiku
    ? { fields: { thinking: { type: "disabled" } }, maxTokens: baseMaxTokens }
    : { fields: {}, maxTokens: Math.max(baseMaxTokens, 4000) };
}
