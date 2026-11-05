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
