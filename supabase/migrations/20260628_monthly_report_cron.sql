-- 月次レポート自動送信スケジュール（毎月1日 09:00 JST = 00:00 UTC）
-- Supabase ダッシュボード > Database > Extensions で pg_cron を有効化してから実行する

-- 既存のジョブがあれば削除
SELECT cron.unschedule('monthly-report-line') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'monthly-report-line'
);

-- 毎月1日 00:00 UTC（= 09:00 JST）に monthly-report を呼び出す
SELECT cron.schedule(
  'monthly-report-line',
  '0 0 1 * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/monthly-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  )
  $$
);
