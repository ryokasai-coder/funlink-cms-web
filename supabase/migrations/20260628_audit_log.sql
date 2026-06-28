-- ============================================================
-- Funrix CMS - 監査ログテーブル
-- 実行場所: Supabase Dashboard > SQL Editor
-- ============================================================

-- 監査ログテーブル（誰がいつ何を変更したかを記録）
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email  TEXT,                          -- ログ時点のメールアドレス（後から参照可能）
  action      TEXT NOT NULL,                 -- 'create' | 'update' | 'delete' | 'save'
  target_type TEXT NOT NULL,                 -- 'case' | 'task' | 'meeting' | 'payment' | 'store' | 'review' | 'main'
  target_id   TEXT,                          -- FL番号や対象IDなど
  target_name TEXT,                          -- 会社名や店舗名など（可読性のため）
  detail      JSONB                          -- 変更内容の詳細（旧値/新値）
);

-- インデックス（検索用）
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id    ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target     ON audit_log(target_type, target_id);

-- RLS（Row Level Security）の有効化
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- 管理者は全件閲覧可能、一般ユーザーは自分のログのみ
DROP POLICY IF EXISTS "admin_all"      ON audit_log;
DROP POLICY IF EXISTS "user_own_logs"  ON audit_log;
DROP POLICY IF EXISTS "user_insert"    ON audit_log;

CREATE POLICY "admin_all" ON audit_log
  FOR ALL
  USING (
    auth.uid() IN (
      SELECT id FROM auth.users WHERE email = 'ryo.kasai@funrix.co.jp'
    )
  );

CREATE POLICY "user_own_logs" ON audit_log
  FOR SELECT
  USING (user_id = auth.uid());

-- 全認証ユーザーがINSERT可能（自分のアクションを記録）
CREATE POLICY "user_insert" ON audit_log
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 確認クエリ（実行後に動作確認）
-- ============================================================
-- SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 20;
