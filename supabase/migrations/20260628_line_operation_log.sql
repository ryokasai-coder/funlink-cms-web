-- P3: LINE操作ログテーブル（誰がいつどのメッセージに何をしたか記録）
-- Supabase Dashboard > SQL Editor で実行する

CREATE TABLE IF NOT EXISTS line_operation_log (
  id          BIGSERIAL PRIMARY KEY,
  fl_code     TEXT,
  message_id  TEXT,
  action      TEXT CHECK (action IN ('done', 'deleted', 'replied', 'assigned')),
  operator    TEXT,
  operated_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス（FL別の操作履歴検索用）
CREATE INDEX IF NOT EXISTS idx_line_oplog_fl ON line_operation_log (fl_code, operated_at DESC);

-- RLS有効化（既存のline_messagesと同じ方針）
ALTER TABLE line_operation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users" ON line_operation_log
  FOR ALL USING (auth.role() = 'authenticated');

-- サービスロールからの書き込みも許可（Webhook等）
CREATE POLICY "Allow service role" ON line_operation_log
  FOR INSERT WITH CHECK (true);
