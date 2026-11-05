import { CognitoJwtVerifier } from "aws-jwt-verify";

/**
 * CloudFront(OAC)→ Lambda 関数URL の構成では Authorization ヘッダーが SigV4 に使われるため、
 * Cognito の ID トークンは X-Id-Token ヘッダーで受け取り、Lambda 内で検証する。
 * userId は必ずここで検証したトークンの sub から取る(リクエストボディは信用しない)。
 */
export type VerifyIdToken = (token: string) => Promise<string /* userId */>;

export function createCognitoVerifier(userPoolId: string, clientId: string): VerifyIdToken {
  const verifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: "id" });
  return async (token) => {
    const payload = await verifier.verify(token);
    return payload.sub;
  };
}
