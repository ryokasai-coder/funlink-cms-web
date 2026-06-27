import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// HMAC-SHA256署名を計算してBase64で返す
async function hmacSha256Base64(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

// LINE Profile APIでdisplay_nameを取得
async function getLineDisplayName(userId: string, accessToken: string): Promise<string> {
  if (!accessToken) return userId
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) return userId
    const data = await res.json()
    return (data.displayName as string) || userId
  } catch {
    return userId
  }
}

const MSG_TYPE_LABEL: Record<string, string> = {
  image: '【画像を送信】',
  video: '【動画を送信】',
  audio: '【音声を送信】',
  file: '【ファイルを送信】',
  sticker: '【スタンプ】',
  location: '【位置情報を送信】',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // ヘルスチェック（接続テスト用）
  if (req.method === 'GET') {
    return Response.json(
      { ok: true, service: 'line-webhook', status: 'ready' },
      { headers: corsHeaders }
    )
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const CHANNEL_SECRET = Deno.env.get('LINE_CHANNEL_SECRET') || ''
  const ACCESS_TOKEN = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') || ''

  const bodyText = await req.text()

  // LINE署名検証（CHANNEL_SECRETが設定されている場合のみ）
  if (CHANNEL_SECRET) {
    const signature = req.headers.get('x-line-signature') || ''
    const expected = await hmacSha256Base64(CHANNEL_SECRET, bodyText)
    if (expected !== signature) {
      console.error('Signature mismatch. Expected:', expected, 'Got:', signature)
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }
  }

  let body: { events?: any[] }
  try {
    body = JSON.parse(bodyText)
  } catch {
    return new Response('Bad Request', { status: 400, headers: corsHeaders })
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  for (const event of (body.events || [])) {
    const userId: string | undefined = event.source?.userId
    if (!userId) continue

    const ts = new Date(event.timestamp).toISOString()
    const dateStr = ts.slice(0, 10)

    // line_user_fl_map からFLコードと表示名を取得
    const { data: mapping } = await sb
      .from('line_user_fl_map')
      .select('fl_code, display_name')
      .eq('line_user_id', userId)
      .single()

    const flCode: string = mapping?.fl_code || userId
    let displayName: string = mapping?.display_name || ''

    // フォロー（友だち追加）イベント
    if (event.type === 'follow') {
      if (!displayName) {
        displayName = await getLineDisplayName(userId, ACCESS_TOKEN)
      }
      await sb.from('line_user_fl_map').upsert({
        line_user_id: userId,
        display_name: displayName,
        fl_code: mapping?.fl_code || null,
      }, { onConflict: 'line_user_id' })
      console.log('Follow event:', userId, displayName)
      continue
    }

    // アンフォロー（ブロック）
    if (event.type === 'unfollow') {
      console.log('Unfollow event:', userId)
      continue
    }

    // メッセージイベント
    if (event.type === 'message') {
      // 未登録ユーザーのプロフィール取得・登録
      if (!displayName) {
        displayName = await getLineDisplayName(userId, ACCESS_TOKEN)
        await sb.from('line_user_fl_map').upsert({
          line_user_id: userId,
          display_name: displayName,
          fl_code: null,
        }, { onConflict: 'line_user_id' })
      }

      const msgType: string = event.message?.type || 'text'
      const message = msgType === 'text'
        ? (event.message.text as string || '')
        : (MSG_TYPE_LABEL[msgType] || `【${msgType}を送信】`)

      const { error } = await sb.from('line_messages').insert({
        id: crypto.randomUUID(),
        case_fl: flCode,
        date: dateStr,
        sender: '顧客',
        sender_name: displayName,
        assignee: '',
        category: 'その他',
        message: message,
        reply_draft: '',
        status: '未対応',
        created_at: ts,
      })

      if (error) {
        console.error('Insert error:', error.message, 'fl:', flCode, 'user:', userId)
      } else {
        console.log('Message saved:', userId, '->', flCode, msgType)
      }
    }
  }

  return Response.json({ ok: true }, { headers: corsHeaders })
})
