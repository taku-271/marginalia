import { Amplify } from "aws-amplify";
import {
  confirmSignIn,
  fetchAuthSession,
  getCurrentUser,
  signIn,
  signOut,
} from "aws-amplify/auth";
import type { RuntimeConfig } from "./config";

export function configureAuth(config: RuntimeConfig) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
        loginWith: { email: true },
      },
    },
  });
}

/** API 呼び出し用の ID トークン(期限切れなら Amplify が更新する) */
export async function getIdToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

export async function isSignedIn(): Promise<boolean> {
  try {
    await getCurrentUser();
    return true;
  } catch {
    return false;
  }
}

export type SignInResult = "done" | "new_password_required";

export async function login(email: string, password: string): Promise<SignInResult> {
  const r = await signIn({ username: email, password });
  if (r.isSignedIn) return "done";
  // 招待制なので、管理者が作ったユーザーは初回に新しいパスワードを設定する
  if (r.nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") return "new_password_required";
  throw new Error(`未対応のサインイン手順です: ${r.nextStep.signInStep}`);
}

export async function setNewPassword(newPassword: string): Promise<void> {
  const r = await confirmSignIn({ challengeResponse: newPassword });
  if (!r.isSignedIn) throw new Error("パスワードの設定に失敗しました");
}

export async function logout(): Promise<void> {
  await signOut();
}
