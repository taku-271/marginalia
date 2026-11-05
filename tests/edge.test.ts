import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { MarginaliaPlanStack, MarginaliaWafStack } from "../infra/lib/edge-stacks.js";
import { MarginaliaStack } from "../infra/lib/marginalia-stack.js";

const account = "123456789012";

function build() {
  const app = new cdk.App();
  const waf = new MarginaliaWafStack(app, "Waf", { env: { account, region: "us-east-1" }, crossRegionReferences: true });
  const main = new MarginaliaStack(app, "Main", {
    env: { account, region: "ap-northeast-1" },
    crossRegionReferences: true,
    modelId: "jp.anthropic.claude-haiku-5-5",
    webAclArn: waf.webAclArn,
    webDistDir: "/nonexistent",
  });
  const plan = new MarginaliaPlanStack(app, "Plan", {
    env: { account, region: "us-east-1" },
    crossRegionReferences: true,
    distributionArn: main.distributionArn,
    webAclArn: waf.webAclArn,
  });
  return { waf: Template.fromStack(waf), main: Template.fromStack(main), plan: Template.fromStack(plan) };
}

describe("CloudFront 定額料金プラン(Free)", () => {
  const t = build();

  it("Web ACL は CLOUDFRONT スコープで、ルールは Free の上限 5 個以内", () => {
    const acls = Object.values(t.waf.findResources("AWS::WAFv2::WebACL"));
    expect(acls).toHaveLength(1);
    const props = acls[0]!.Properties;
    expect(props.Scope).toBe("CLOUDFRONT");
    expect(props.Rules.length).toBeLessThanOrEqual(5);
  });

  it("本文サイズ制限ルールは記録のみ(長い回答をブロックしない)", () => {
    const rules = Object.values(t.waf.findResources("AWS::WAFv2::WebACL"))[0]!.Properties.Rules as any[];
    const common = rules.find((r) => r.Name === "AWS-AWSManagedRulesCommonRuleSet");
    expect(common.Statement.ManagedRuleGroupStatement.RuleActionOverrides).toEqual([
      { Name: "SizeRestrictions_BODY", ActionToUse: { Count: {} } },
    ]);
  });

  it("ディストリビューションは Web ACL 付き・AWS 管理ポリシーのみ・ビヘイビア 5 個以内", () => {
    const dist = Object.values(t.main.findResources("AWS::CloudFront::Distribution"))[0]!.Properties.DistributionConfig;
    expect(dist.WebACLId).toBeDefined();
    const behaviors = [dist.DefaultCacheBehavior, ...(dist.CacheBehaviors ?? [])];
    expect(behaviors.length).toBeLessThanOrEqual(5);
    // 独自のキャッシュ/オリジンリクエストポリシーは Free では使えない
    t.main.resourceCountIs("AWS::CloudFront::CachePolicy", 0);
    t.main.resourceCountIs("AWS::CloudFront::OriginRequestPolicy", 0);
    for (const b of behaviors) expect(typeof b.CachePolicyId).toBe("string");
    expect(dist.Logging).toBeUndefined();
  });

  it("サブスクリプションは FREE で、ディストリビューションと Web ACL を参照する", () => {
    const sub = Object.values(t.plan.findResources("AWS::PricingPlanManager::Subscription"))[0]!.Properties;
    expect(sub.PlanFamily).toBe("CloudFront");
    expect(sub.PlanTier).toBe("FREE");
    expect(sub.ResourceArns).toHaveLength(2);
    expect(JSON.stringify(sub.ResourceArns[0])).toContain(":cloudfront::123456789012:distribution/");
  });

  it("Web ACL を us-east-1 以外に作ろうとしたらエラー", () => {
    expect(() => new MarginaliaWafStack(new cdk.App(), "X", { env: { account, region: "ap-northeast-1" } })).toThrow();
  });
});
