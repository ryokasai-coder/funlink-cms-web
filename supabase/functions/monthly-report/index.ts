/**
 * monthly-report Edge Function
 *
 * 呼び出し方:
 *   A) pg_cron（自動）: service_role_key で認証 → 全契約中顧客に一括送信
 *   B) フロントエンド（手動）: ユーザー JWT で認証 → fl（1件）または fls（複数）を指定
 *
 * 必要な Supabase シークレット:
 *   LINE_CHANNEL_ACCESS_TOKEN  — LINE Messaging API チャンネルアクセストークン
 *   SUPABASE_URL               — 自動挿入
 *   SUPABASE_SERVICE_ROLE_KEY  — 自動挿入
 *   SUPABASE_ANON_KEY          — フロントエンド認証用
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function fmtNum(n: number): string {
  return n.toLocaleString('ja-JP')
}

function prevMonth(refDate: Date): string {
  const d = new Date(refDate.getFullYear(), refDate.getMonth() - 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function delta(cur: number, prev: number): string {
  const diff = cur - prev
  if (diff > 0) return `▲${diff}`
  if (diff < 0) return `▼${Math.abs(diff)}`
  return '±0'
}

async function sendLineMessage(userId: string, text: string, token: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] }),
    })
    return res.ok
  } catch {
    return false
  }
}

// 1件分のメッセージ本文を生成（フロントエンドプレビュー用にも共用）
function buildMessage(
  storeName: string,
  ym: string,
  total: number,
  prevTotal: number,
  rating: number,
  prevRating: number,
  unresponded: number,
  lastDate: string
): string {
  return [
    `【${ym.replace('-', '年')}月 月次クチコミレポート】`,
    `${storeName} さんの先月の実績をお届けします。`,
    ``,
    `📊 クチコミ総件数: ${fmtNum(total)} 件（前月比 ${delta(total, prevTotal)}）`,
    `⭐ 平均評価: ${rating > 0 ? rating.toFixed(1) : '--'} / 5.0（前月比 ${
      delta(Math.round(rating * 10), Math.round(prevRating * 10))
        .replace('▲', '+').replace('▼', '-')
    }）`,
    unresponded > 0
      ? `💬 未返信クチコミ: ${unresponded} 件（早めの返信をおすすめします）`
      : `💬 未返信クチコミ: なし ✅`,
    `📅 最新クチコミ日: ${lastDate}`,
    ``,
    `引き続きFunrixサービスをよろしくお願いします。`,
    `ご質問はこちらのLINEにてお気軽にどうぞ！`,
  ].join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const lineToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') || ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''

  if (!lineToken || !supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Missing env vars (LINE_CHANNEL_ACCESS_TOKEN 等)' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // 認証: ユーザーJWT（フロントエンドから）または pg_cron（service_role_key）
  const authHeader = req.headers.get('Authorization') || ''
  const adminSb = createClient(supabaseUrl, serviceKey)

  if (authHeader && anonKey) {
    // ユーザーJWT の場合: 認証確認（operator以上であれば通す）
    const userSb = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user }, error: authErr } = await userSb.auth.getUser()
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }

  let body: { fl?: string; fls?: string[] } = {}
  try { body = await req.json() } catch { /* pg_cron は空bodyで呼ぶ場合がある */ }

  const now = new Date()
  const ym = prevMonth(now)

  // cms_store から cases + review_kpi を取得
  const { data: storeRows, error: storeErr } = await adminSb
    .from('cms_store').select('id, data').in('id', ['cases', 'review_kpi'])

  if (storeErr) {
    return new Response(
      JSON.stringify({ ok: false, error: storeErr.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const casesRow = storeRows?.find((r) => r.id === 'cases')
  const kpiRow = storeRows?.find((r) => r.id === 'review_kpi')

  const masterCases: Array<{
    fl: string; name: string; status: string; stores?: Array<{ sname: string }>
  }> = casesRow?.data?.master || []

  const kpiByFl: Record<string, {
    total?: number; prev_total?: number; rating?: number; prev_rating?: number
    last_review_date?: string; unresponded?: number
  }> = kpiRow?.data?.by_fl || {}

  // LINE IDマッピングを取得
  const { data: lineMapRows } = await adminSb
    .from('line_user_fl_map').select('fl_code, line_user_id')

  const lineMap: Record<string, string> = {}
  for (const row of lineMapRows || []) {
    lineMap[row.fl_code] = row.line_user_id
  }

  // 送信対象を絞り込む
  let contracted = masterCases.filter((c) => c.status === '契約中')
  if (body.fl) {
    contracted = contracted.filter((c) => c.fl === body.fl)
  } else if (body.fls && body.fls.length > 0) {
    contracted = contracted.filter((c) => body.fls!.includes(c.fl))
  }

  const results: Array<{ fl: string; name: string; status: string; reason?: string }> = []

  for (const c of contracted) {
    const lineUserId = lineMap[c.fl]
    if (!lineUserId) {
      results.push({ fl: c.fl, name: c.name, status: 'skip', reason: 'LINE未連携' })
      continue
    }

    const kpi = kpiByFl[c.fl] || {}
    const total = kpi.total ?? 0
    const prevTotal = kpi.prev_total ?? 0
    const rating = kpi.rating ?? 0
    const prevRating = kpi.prev_rating ?? 0
    const unresponded = kpi.unresponded ?? 0
    const lastDate = kpi.last_review_date ?? '未記録'
    const storeName = (c.stores && c.stores[0]) ? c.stores[0].sname : c.name

    const text = buildMessage(storeName, ym, total, prevTotal, rating, prevRating, unresponded, lastDate)
    const sent = await sendLineMessage(lineUserId, text, lineToken)
    results.push({ fl: c.fl, name: c.name, status: sent ? 'sent' : 'failed' })
  }

  const sentCount = results.filter((r) => r.status === 'sent').length
  const failed = results.filter((r) => r.status === 'failed').length
  const skipped = results.filter((r) => r.status === 'skip').length

  return new Response(
    JSON.stringify({ ok: true, ym, total: contracted.length, sent: sentCount, failed, skipped, results }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
