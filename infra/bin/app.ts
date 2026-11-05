import * as cdk from "aws-cdk-lib";
import { MarginaliaStack } from "../lib/marginalia-stack.js";

const app = new cdk.App();

// モデルとリージョンは context で差し替え可能: cdk deploy -c noteModelId=jp.anthropic.claude-sonnet-5-5
// リージョンは CDK_DEFAULT_REGION(CLI の設定リージョン)に引きずられないよう既定で東京に固定する。
// jp. 推論プロファイルは日本リージョンからしか呼べないため。
const region = (app.node.tryGetContext("region") as string | undefined) ?? "ap-northeast-1";
const modelId = (app.node.tryGetContext("modelId") as string | undefined) ?? "jp.anthropic.claude-haiku-5-5";
const noteModelId = app.node.tryGetContext("noteModelId") as string | undefined;

new MarginaliaStack(app, "Marginalia", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region,
  },
  modelId,
  noteModelId,
});
