import * as cdk from "aws-cdk-lib";
import { MarginaliaPlanStack, MarginaliaWafStack } from "../lib/edge-stacks.js";
import { MarginaliaStack } from "../lib/marginalia-stack.js";

const app = new cdk.App();

// モデルとリージョンは context で差し替え可能: cdk deploy --all -c noteModelId=jp.anthropic.claude-opus-5-5
// リージョンは CDK_DEFAULT_REGION(CLI の設定リージョン)に引きずられないよう既定で東京に固定する。
// jp. 推論プロファイルは日本リージョンからしか呼べないため。
const region = (app.node.tryGetContext("region") as string | undefined) ?? "ap-northeast-1";
const modelId = (app.node.tryGetContext("modelId") as string | undefined) ?? "jp.anthropic.claude-haiku-5-5";
const noteModelId = app.node.tryGetContext("noteModelId") as string | undefined;
// CloudFront の料金: "free"(定額料金プランの Free。既定)/ "payg"(従量課金。WAF もプランも作らない)
const cloudfrontPlan = (app.node.tryGetContext("cloudfrontPlan") as string | undefined) ?? "free";
if (!["free", "payg"].includes(cloudfrontPlan)) throw new Error('cloudfrontPlan は "free" か "payg"');

const account = process.env.CDK_DEFAULT_ACCOUNT;

let webAclArn: string | undefined;
let waf: MarginaliaWafStack | undefined;
if (cloudfrontPlan === "free") {
  waf = new MarginaliaWafStack(app, "MarginaliaWaf", {
    env: { account, region: "us-east-1" },
    crossRegionReferences: true,
  });
  webAclArn = waf.webAclArn;
}

const main = new MarginaliaStack(app, "Marginalia", {
  env: { account, region },
  crossRegionReferences: cloudfrontPlan === "free",
  modelId,
  noteModelId,
  webAclArn,
});

if (waf && webAclArn) {
  new MarginaliaPlanStack(app, "MarginaliaPlan", {
    env: { account, region: "us-east-1" },
    crossRegionReferences: true,
    distributionArn: main.distributionArn,
    webAclArn,
  });
}
