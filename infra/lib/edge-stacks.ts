import * as cdk from "aws-cdk-lib";
import * as pricing from "aws-cdk-lib/aws-pricingplanmanager";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import type { Construct } from "constructs";

/**
 * CloudFront の定額料金プラン(Free)に必要な us-east-1 側のリソース。
 *
 *   MarginaliaWaf(us-east-1)   … CLOUDFRONT スコープの Web ACL(プランの必須条件)
 *   Marginalia(ap-northeast-1)  … ディストリビューションに上の Web ACL を付ける
 *   MarginaliaPlan(us-east-1)  … PricingPlanManager のサブスクリプション(ディストリビューション + Web ACL)
 *
 * Free プランの制約: WAF ルールは 5 個まで、キャッシュ/オリジンリクエストポリシーは AWS 管理のもののみ、
 * ビヘイビアは 5 個まで、Free プランは 1 アカウント 3 個まで、AWS 無料プランのアカウントでは使えない。
 */

function managedGroup(
  name: string,
  priority: number,
  ruleActionOverrides?: wafv2.CfnWebACL.RuleActionOverrideProperty[],
): wafv2.CfnWebACL.RuleProperty {
  return {
    name: `AWS-${name}`,
    priority,
    statement: { managedRuleGroupStatement: { vendorName: "AWS", name, ruleActionOverrides } },
    overrideAction: { none: {} },
    visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: name },
  };
}

export class MarginaliaWafStack extends cdk.Stack {
  readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    if (props.env?.region && props.env.region !== "us-east-1") {
      throw new Error("CLOUDFRONT スコープの Web ACL は us-east-1 にしか作れません");
    }

    const acl = new wafv2.CfnWebACL(this, "WebAcl", {
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: "marginalia" },
      rules: [
        {
          // 同じ IP から 5 分で 1000 リクエストを超えたらブロック(1人で使うアプリとしては十分な余裕)
          name: "RateLimitPerIp",
          priority: 0,
          statement: { rateBasedStatement: { limit: 1000, aggregateKeyType: "IP", evaluationWindowSec: 300 } },
          action: { block: {} },
          visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: "RateLimitPerIp" },
        },
        // 本文 8KB 超をブロックするルールは記録のみ(日本語の回答 4000 字やイベント 25 件の送信が超えうるため)
        managedGroup("AWSManagedRulesCommonRuleSet", 1, [
          { name: "SizeRestrictions_BODY", actionToUse: { count: {} } },
        ]),
        managedGroup("AWSManagedRulesAmazonIpReputationList", 2),
        managedGroup("AWSManagedRulesKnownBadInputsRuleSet", 3),
      ],
    });
    this.webAclArn = acl.attrArn;
  }
}

export interface MarginaliaPlanStackProps extends cdk.StackProps {
  distributionArn: string;
  webAclArn: string;
}

export class MarginaliaPlanStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MarginaliaPlanStackProps) {
    super(scope, id, props);
    // Free は作成と同時に有効になる(承認不要・課金なし)。プランの変更はスタック更新ではできない
    new pricing.CfnSubscription(this, "CloudFrontFreePlan", {
      planFamily: "CloudFront",
      planTier: "FREE",
      usageLevel: "DEFAULT",
      resourceArns: [props.distributionArn, props.webAclArn],
    });
  }
}
