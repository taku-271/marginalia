import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";
import { bedrockModelArns } from "./bedrock.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface MarginaliaStackProps extends cdk.StackProps {
  /** P1/P2 のモデル */
  modelId: string;
  /** P3(読書ノート)のモデル。未指定なら modelId */
  noteModelId?: string;
  /** フロントのビルド成果物。存在すれば S3 にデプロイする */
  webDistDir?: string;
}

/**
 * 構成:
 *   CloudFront ─┬─ /api/*  → Lambda 関数URL(AWS_IAM + OAC。X-Id-Token の Cognito ID トークンを Lambda 内で検証)
 *               └─ その他  → S3(フロントの PWA。SPA 用に拡張子なしのパスを /index.html に書き換え)
 *   DynamoDB シングルテーブル(PK/SK)、Cognito ユーザープール、Bedrock(Converse)
 */
export class MarginaliaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MarginaliaStackProps) {
    super(scope, id, props);
    const noteModelId = props.noteModelId ?? props.modelId;

    // ---------------------------------------------------------------- DynamoDB
    const table = new dynamodb.TableV2(this, "Table", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ---------------------------------------------------------------- Cognito
    const userPool = new cognito.UserPool(this, "UserPool", {
      // MVP は招待制(管理者がユーザーを作る)。公開するときに true にする
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: { minLength: 12 },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const userPoolClient = userPool.addClient("WebClient", {
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(90),
    });

    // ---------------------------------------------------------------- Lambda
    const logGroup = new logs.LogGroup(this, "ApiLogs", {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const api = new nodejs.NodejsFunction(this, "Api", {
      entry: join(ROOT, "src/server/handlers/api.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      // P3(maxTokens 1500)が収まる長さ。CloudFront のオリジン応答タイムアウトも合わせる
      timeout: cdk.Duration.seconds(60),
      logGroup,
      environment: {
        TABLE_NAME: table.tableName,
        MODEL_ID: props.modelId,
        NOTE_MODEL_ID: noteModelId,
        BEDROCK_REGION: this.region,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node22",
        minify: true,
        sourceMap: true,
        // ESM バンドル内で CommonJS 依存が require を使えるようにする
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });
    table.grantReadWriteData(api);
    api.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          ...new Set([
            ...bedrockModelArns(props.modelId, this.region, this.account, this.partition),
            ...bedrockModelArns(noteModelId, this.region, this.account, this.partition),
          ]),
        ],
      }),
    );

    const apiUrl = api.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

    // ---------------------------------------------------------------- Web(S3)
    const webBucket = new s3.Bucket(this, "WebBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // SPA: 拡張子のないパスは /index.html を返す(/api には付けない。API の 404 を書き換えないため)
    const spaRewrite = new cloudfront.Function(this, "SpaRewrite", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        `function handler(event) {
  var req = event.request;
  if (!req.uri.includes('.')) req.uri = '/index.html';
  return req;
}`,
      ),
    });

    // ---------------------------------------------------------------- CloudFront
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultRootObject: "index.html",
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          { function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        "/api/*": {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(apiUrl, {
            readTimeout: cdk.Duration.seconds(60),
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // X-Id-Token / x-amz-content-sha256 を含むヘッダーを転送(Host は OAC 署名のため除外)
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });

    // フロント: ハッシュ付きの assets/* は長期キャッシュ、それ以外(index.html, sw.js, manifest, config.json)は毎回確認。
    // config.json は Cognito の ID をデプロイ時に書き出す(フロントをビルドし直さずに済むように)。
    // prune: false にして、古いクライアントが参照する前のバージョンの assets を消さない。
    const webDist = props.webDistDir ?? join(ROOT, "web/dist");
    if (existsSync(webDist)) {
      new s3deploy.BucketDeployment(this, "DeployWebAssets", {
        sources: [s3deploy.Source.asset(webDist, { exclude: ["*", "!assets", "!assets/**", "assets/**/*.map"] })],
        destinationBucket: webBucket,
        prune: false,
        cacheControl: [s3deploy.CacheControl.fromString("public, max-age=31536000, immutable")],
      });
      new s3deploy.BucketDeployment(this, "DeployWeb", {
        sources: [
          s3deploy.Source.asset(webDist, { exclude: ["assets/**", "*.map"] }),
          s3deploy.Source.jsonData("config.json", {
            userPoolId: userPool.userPoolId,
            userPoolClientId: userPoolClient.userPoolClientId,
          }),
        ],
        destinationBucket: webBucket,
        prune: false,
        cacheControl: [s3deploy.CacheControl.fromString("no-cache")],
        distribution,
        distributionPaths: ["/*"],
      });
    }

    // ---------------------------------------------------------------- Outputs
    new cdk.CfnOutput(this, "AppUrl", { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "WebBucketName", { value: webBucket.bucketName });
  }
}
