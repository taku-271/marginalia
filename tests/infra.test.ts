import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { bedrockModelArns } from "../infra/lib/bedrock.js";
import { MarginaliaStack } from "../infra/lib/marginalia-stack.js";

describe("bedrockModelArns", () => {
  it("推論プロファイルと基盤モデルの両方", () => {
    expect(bedrockModelArns("jp.anthropic.claude-haiku-5-5", "ap-northeast-1", "123")).toEqual([
      "arn:aws:bedrock:ap-northeast-1:123:inference-profile/jp.anthropic.claude-haiku-5-5",
      "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-5-5*",
    ]);
  });
  it("プロファイルなしのモデルID", () => {
    expect(bedrockModelArns("anthropic.claude-haiku-5-5", "ap-northeast-1", "123")).toEqual([
      "arn:aws:bedrock:ap-northeast-1::foundation-model/anthropic.claude-haiku-5-5*",
    ]);
  });
});

describe("MarginaliaStack", () => {
  const app = new cdk.App();
  const stack = new MarginaliaStack(app, "Test", {
    env: { account: "123456789012", region: "ap-northeast-1" },
    modelId: "jp.anthropic.claude-haiku-5-5",
    noteModelId: "jp.anthropic.claude-sonnet-5-5",
    webDistDir: "/nonexistent",
  });
  const t = Template.fromStack(stack);

  it("DynamoDB は PK/SK のシングルテーブル", () => {
    t.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
    });
  });

  it("関数URLは AWS_IAM で、CloudFront からのみ呼べる", () => {
    t.hasResourceProperties("AWS::Lambda::Url", { AuthType: "AWS_IAM" });
    t.hasResourceProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunctionUrl",
      Principal: "cloudfront.amazonaws.com",
    });
  });

  it("/api/* はキャッシュなし・全メソッド", () => {
    t.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: [
          Match.objectLike({
            PathPattern: "/api/*",
            AllowedMethods: Match.arrayWith(["POST"]),
            CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
          }),
        ],
      }),
    });
  });

  it("Bedrock の権限は指定モデルだけ", () => {
    const policies = JSON.stringify(t.findResources("AWS::IAM::Policy"));
    expect(policies).toContain(":bedrock:ap-northeast-1:");
    expect(policies).toContain(":inference-profile/jp.anthropic.claude-haiku-5-5");
    expect(policies).toContain(":inference-profile/jp.anthropic.claude-sonnet-5-5");
    expect(policies).toContain(":bedrock:*::foundation-model/anthropic.claude-sonnet-5-5*");
    expect(policies).not.toMatch(/"Resource":"\*"/);
  });

  it("web/dist があればフロントをデプロイし config.json を書き出す", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "web-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<!doctype html>");
    writeFileSync(join(dir, "assets", "a-123.js"), "");
    const s = new MarginaliaStack(new cdk.App(), "WithWeb", {
      env: { account: "123456789012", region: "ap-northeast-1" },
      modelId: "jp.anthropic.claude-haiku-5-5",
      webDistDir: dir,
    });
    const tpl = Template.fromStack(s);
    tpl.resourceCountIs("Custom::CDKBucketDeployment", 2);
    tpl.hasResourceProperties("Custom::CDKBucketDeployment", {
      SystemMetadata: { "cache-control": "no-cache" },
      DistributionPaths: ["/*"],
    });
    tpl.hasResourceProperties("Custom::CDKBucketDeployment", {
      SystemMetadata: { "cache-control": "public, max-age=31536000, immutable" },
    });
  });

  it("Lambda の環境変数", () => {
    t.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Environment: {
        Variables: Match.objectLike({
          MODEL_ID: "jp.anthropic.claude-haiku-5-5",
          NOTE_MODEL_ID: "jp.anthropic.claude-sonnet-5-5",
        }),
      },
    });
  });
});
