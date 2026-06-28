-- ============================================================
-- Funrix CMS - RLS（行レベルセキュリティ）全テーブル適用
-- 実行場所: Supabase Dashboard > SQL Editor または supabase db push
-- ============================================================

-- ============================================================
-- 1. cms_store テーブル
--    データ構造: id text PK, data JSONB, updated_at
--    アクセス方針: 認証済みユーザー全員が読み取り可。
--               admin のみ書き込み可（GASからの書き込みはservice_roleで行う）。
-- ============================================================
ALTER TABLE cms_store ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cms_store_read"         ON cms_store;
DROP POLICY IF EXISTS "cms_store_admin_write"  ON cms_store;

-- 読み取り: 認証済みユーザー全員
CREATE POLICY "cms_store_read" ON cms_store
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- 書き込み（INSERT/UPDATE/DELETE）: admin のみ
CREATE POLICY "cms_store_admin_write" ON cms_store
  FOR ALL
  USING (
    auth.uid() IN (
      SELECT id FROM auth.users WHERE email = 'ryo.kasai@funrix.co.jp'
    )
  )
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM auth.users WHERE email = 'ryo.kasai@funrix.co.jp'
    )
  );


-- ============================================================
-- 2. line_messages テーブル
--    アクセス方針: 認証済みユーザー全員が読み書き可（LINEからの書き込みはservice_roleで行う）。
-- ============================================================
ALTER TABLE line_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "line_messages_read"   ON line_messages;
DROP POLICY IF EXISTS "line_messages_write"  ON line_messages;

-- 読み取り: 認証済みユーザー全員
CREATE POLICY "line_messages_read" ON line_messages
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- 書き込み: 認証済みユーザー全員（担当者が返信下書きを保存するため）
CREATE POLICY "line_messages_write" ON line_messages
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');


-- ============================================================
-- 3. line_user_fl_map テーブル
--    アクセス方針: 認証済みユーザー全員が読み書き可（LINE紐付け管理のため）。
-- ============================================================
ALTER TABLE line_user_fl_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "line_map_read"   ON line_user_fl_map;
DROP POLICY IF EXISTS "line_map_write"  ON line_user_fl_map;

-- 読み取り: 認証済みユーザー全員
CREATE POLICY "line_map_read" ON line_user_fl_map
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- 書き込み: 認証済みユーザー全員（紐付け追加・更新）
CREATE POLICY "line_map_write" ON line_user_fl_map
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');


-- ============================================================
-- 4. review_kpi テーブル（存在する場合）
--    アクセス方針: 認証済みユーザー全員が読み取り可。admin のみ書き込み可。
-- ============================================================
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='review_kpi') THEN
    EXECUTE 'ALTER TABLE review_kpi ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "review_kpi_read"  ON review_kpi';
    EXECUTE 'DROP POLICY IF EXISTS "review_kpi_write" ON review_kpi';
    EXECUTE $q$
      CREATE POLICY "review_kpi_read" ON review_kpi
        FOR SELECT USING (auth.role() = 'authenticated')
    $q$;
    EXECUTE $q$
      CREATE POLICY "review_kpi_write" ON review_kpi
        FOR ALL
        USING (auth.uid() IN (SELECT id FROM auth.users WHERE email = 'ryo.kasai@funrix.co.jp'))
        WITH CHECK (auth.uid() IN (SELECT id FROM auth.users WHERE email = 'ryo.kasai@funrix.co.jp'))
    $q$;
    RAISE NOTICE 'review_kpi RLS 適用完了';
  ELSE
    RAISE NOTICE 'review_kpi テーブルが存在しないためスキップ（cms_store.data に格納済みの場合は不要）';
  END IF;
END $do$;


-- ============================================================
-- 確認クエリ（実行後）
-- ============================================================
-- SELECT tablename, rowsecurity, relforcerowsecurity
--   FROM pg_tables t
--   JOIN pg_class c ON c.relname = t.tablename
--   WHERE schemaname = 'public'
--   ORDER BY tablename;
