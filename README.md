# marginalia

読書アウトプットMVP。紙の本を読み終えたら AI が問いを1つだけ投げ、回答から読書ノートを作る。

## 開発環境

```sh
nix develop      # Node 22 / npm(direnv なら .envrc で自動)
npm install
npm run typecheck
npm test
```

## AWS(CDK)

```sh
npx cdk bootstrap aws://<account>/ap-northeast-1   # 初回のみ
npm run deploy
# P3 だけ上位モデルにする例
npx cdk deploy -c noteModelId=jp.anthropic.claude-sonnet-5-5
```

- CloudFront → `/api/*` は Lambda 関数URL(AWS_IAM + OAC)、それ以外は S3(`web/dist` があればデプロイ)
- DynamoDB シングルテーブル(PK/SK、PITR・削除保護あり、スタック削除時も保持)
- Cognito ユーザープール(MVP は招待制。ユーザーはコンソール等で作成)
- Lambda には指定モデルの `bedrock:InvokeModel` だけを付与
- リージョンは既定で `ap-northeast-1`(`jp.` 推論プロファイルのため)。`-c region=...` で変更

## 構成

- `src/shared/` フロント・サーバー共通(イベントスキーマ、質問タイプ)
- `src/server/ai/` P1(今回の1問)/ P2(ひとことリアクション)/ P3(読書ノート)と質問タイプのローテーション
- `src/server/events/` `POST /api/events` の検証・書き込み、`ai_call` の記録
- `src/server/handlers/api.ts` Lambda エントリ(X-Id-Token の Cognito ID トークンを検証)
- `src/client/` API クライアント、イベントトラッカー、可視時間ストップウォッチ
- `scripts/export-events.ts` 分析用 JSONL エクスポート
- `infra/` CDK スタック

## 環境変数

| 名前 | 既定 | 説明 |
|---|---|---|
| `TABLE_NAME` | 必須 | DynamoDB テーブル |
| `MODEL_ID` | `jp.anthropic.claude-haiku-5-5` | P1/P2 のモデル |
| `NOTE_MODEL_ID` | `MODEL_ID` | P3 のモデル |
| `MODEL_FIELDS` / `NOTE_MODEL_FIELDS` | `{"thinking":{"type":"disabled"}}` | Converse の `additionalModelRequestFields` |
| `P1_TEMPERATURE` / `P2_TEMPERATURE` / `P3_TEMPERATURE` | 未送信 | Haiku 5.5 は既定以外の temperature を拒否するため既定では送らない |
| `USER_POOL_ID` / `USER_POOL_CLIENT_ID` | | Cognito |
| `BEDROCK_REGION` | `AWS_REGION` | |
