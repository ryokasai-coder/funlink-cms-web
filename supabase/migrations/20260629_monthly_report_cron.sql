-- 月次レポート自動送信スケジュール（毎月1日 09:00 JST = 00:00 UTC）
-- 前提: Supabase Dashboard > Database > Extensions で pg_cron と pg_net を有効化すること

DO $do$
BEGIN
  -- pg_cron が有効でなければスキップ
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron が無効のためスキップ。Dashboard > Extensions で有効化後に db push を再実行してください。';
    RETURN;
  END IF;

  -- 既存ジョブがあれば削除（動的SQLで cron スキーマ未存在エラーを回避）
  EXECUTE $q$
    SELECT cron.unschedule('monthly-report-line')
    FROM cron.job
    WHERE jobname = 'monthly-report-line'
  $q$;

  -- 毎月1日 00:00 UTC（= 09:00 JST）に monthly-report を呼び出す
  EXECUTE $q$
    SELECT cron.schedule(
      'monthly-report-line',
      '0 0 1 * *',
      $body$
        SELECT net.http_post(
          url := current_setting('app.supabase_url') || '/functions/v1/monthly-report',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.service_role_key')
          ),
          body := '{}'::jsonb
        )
      $body$
    )
  $q$;
END $do$;
