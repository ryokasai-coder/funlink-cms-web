# Funrix 顧客管理システム（FunLink CMS）

## プロジェクト概要
Funrix社のカスタマーサクセス・PR特化型CRM。単一HTMLファイル（index.html）アプリ。
ビルド不要・ライブラリはCDN経由。

**パス:** `C:\Users\ryo19\funrix-sr`（旧 funlink-cms-web からリネーム・2026-08-26）
**GitHub:** `github.com/ryokasai-coder/funrix-sr` / **Vercel プロジェクト:** `funrix-sr`（ドメイン `funrix-sr.vercel.app`）
**期限:** 2026年7月末
**本番:** http://localhost:5501（`npx serve -p 5501 .`）

## 技術スタック
- **フロント:** 単一HTML（index.html）＋バニラJS＋CSS（ビルドなし）
- **バックエンド:** Supabase（PostgreSQL）
- **Supabase URL:** `https://xfumvuxahjferrapdywj.supabase.co`
- **ANON KEY:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmdW12dXhhaGpmZXJyYXBkeXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMzIxNzQsImV4cCI6MjA5NjcwODE3NH0.6NX0EQubDt3h-jy2E9VDS2ehb6IhFnYnHTajNQ4YEM4`

## DBスキーマ（Supabase）
- `cms_store` テーブル: `id`, `data`（JSONB）, `updated_at`
  - `id='cases'`: MASTER_CASES（521社の案件マスタ）`data.master[]`
  - `id='main'`: ストアデータ（タスク・打合せ等）
  - `id='review_kpi'`: クチコミKPIデータ `data.by_fl{}`, `data.by_store{}`
- `line_user_fl_map`: LINE ID と FLコードのマッピング

## MASTER_CASESの主要フィールド
```
fl, name, status, ccontact, cemail, ctel, caddr, login, industry, company_id,
start, fee, stores[]{store_id, sname, addr, tel, plan, gbp_id, gbp_status}
```

## 実装済みモジュール（12個）
1. **dashboard** — KPIカード（契約数・MRR・チャーン等）
2. **master** — 案件マスタ（全幅テーブル・ソート・詳細モーダル）
3. **contract** — 契約管理
4. **matching** — データ付け合せ
5. **line** — LINE対応
6. **review** — クチコミ管理（★最新リデザイン済み）
7. **meeting** — MTG・議事録
8. **task** — タスク管理
9. **proposal** — 提案管理
10. **support** — サポート履歴
11. **payment** — 支払い管理
12. **settings** — 設定

## 実装完了済み（旧「次のタスク」— 2026-07-08時点で全て実装済み）
1. ~~ダッシュボードKPI強化~~ ✅ Chart.js 4.4.0導入・クチコミ推移グラフ・未返信バッジ配線済
2. ~~サポート履歴モジュール整備~~ ✅ 問い合わせ種別・解決状況フィルタ・対応時間記録 実装済
3. ~~支払い管理モジュール~~ ✅ 請求ロボCSVインポート・未収アラート 実装済
4. ~~クチコミ未マッチ手動紐付けUI~~ ✅ 実装済
（GitHub issueは#49まで全てクローズ済み。コード面の残タスクは無し）

## 残タスク（データ品質是正 — 本番DB / 業務判断が必要）
`node data-quality-check.js` で521社を検査。2026-08-25時点で問題205件（**168社**にまたがる）：
1. **店舗情報なし（契約中）: 151件** — stores配列が空。KPI・マッチングに影響
2. **月額¥0（契約中）: 41件** — `無償運用`扱いか未設定か個別判断中（【Reel Box】系9件含む）
3. **開始日欠損（契約中）: 13件** — FL00030, FL00119, FL00514 等
- ※将来スタート契約（例: FL00493→2026-10-30）は正当なため参考情報(info)扱い・問題ではない
- ※これらは本番の業務記録がないと埋められない実データ欠損。是正用の記入リストを生成済み:
  `G:\マイドライブ\Funrix\FunLink案件管理\データ品質_是正ワークリスト_20260825.csv`（168社・BOM付きUTF-8）

### 2026-08-25 修正メモ
- 旧「ステータス表記ゆれ: 1件（FL00054 契��中）」は**本番DBの問題ではなく** `data-quality-check.js` の
  HTTPチャンク文字列連結によるマルチバイト文字化けが原因だった。Buffer結合デコードに修正済み（誤検知解消）。
- index.html のGASデプロイ手順の古い `H:\` パスを `G:\` に修正。

## コーディング規約
- バニラJS（ES5互換）・`var` 使用
- 関数名は英語・コメントは日本語OK
- モーダル: `openModal(title, bodyHtml, footerHtml, cls)` / `closeModal()`
- トースト: `toast(msg, isError)`
- ローカルストレージ: `getStore()` / `saveStore(s)` で全データ管理
- HTML生成は文字列連結（テンプレートリテラル不要）
- escaping: `escHtml(str)` を必ず使用

## 注意事項
- `.env` ファイルなし（Supabase keyはindex.html内にハードコード）
- `index.html` は1600行超。編集前に対象関数の行番号をGrepで特定すること
- プレビューサーバー起動: `npx serve -p 5501 C:\Users\ryo19\funrix-sr`

## 開発基本方針（適用メモ）
- **集計ロジック確認必須:** MRR（`sum(fee)` 契約中ステータスのみ）・チャーン率・クチコミ件数推移・KPIカード各数値の算出式をコメントで明示する
- **保存先:** CSV出力・HTMLエクスポートは `G:\マイドライブ\Funrix\FunLink案件管理\` に保存
- **Google API:** 案件データのGoogle Sheetsエクスポートに Sheets API を使用（既存の `funlink` シートID: `1kTIjqt7fNP-ut96UQV3Xe9y4e0D3zHj9ssnsRH450Gg`）
- **自動化:** LINE通知・未返信アラート・KPI定期集計はSupabase Webhookまたは定期スクリプトで自動化
