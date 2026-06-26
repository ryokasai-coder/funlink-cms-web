import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const OWNER_EMAILS = ['ryo.kasai@funrix.co.jp']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

    // 認証チェック
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ログイン済みユーザーの確認
    const userSb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user }, error: authError } = await userSb.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // オーナーチェック
    if (!OWNER_EMAILS.includes(user.email!)) {
      return new Response(JSON.stringify({ ok: false, error: 'Forbidden: オーナー権限が必要です' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const adminSb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const body = await req.json()
    const { action, email, userId } = body

    // ユーザー一覧取得
    if (action === 'list') {
      const { data, error } = await adminSb.auth.admin.listUsers({ perPage: 100 })
      return Response.json(
        { ok: !error, users: data?.users || [], error: error?.message },
        { headers: corsHeaders }
      )
    }

    // ユーザー招待（メールリンクから本人が初回パスワード設定）
    if (action === 'invite') {
      if (!email) return Response.json({ ok: false, error: 'emailが必要です' }, { headers: corsHeaders })
      const { error } = await adminSb.auth.admin.inviteUserByEmail(email, {
        redirectTo: req.headers.get('origin') || 'http://localhost:5501'
      })
      return Response.json({ ok: !error, error: error?.message }, { headers: corsHeaders })
    }

    // ユーザー削除
    if (action === 'delete') {
      if (!userId) return Response.json({ ok: false, error: 'userIdが必要です' }, { headers: corsHeaders })
      const { error } = await adminSb.auth.admin.deleteUser(userId)
      return Response.json({ ok: !error, error: error?.message }, { headers: corsHeaders })
    }

    // パスワードリセットリンク生成
    if (action === 'reset') {
      if (!email) return Response.json({ ok: false, error: 'emailが必要です' }, { headers: corsHeaders })
      const { data, error } = await adminSb.auth.admin.generateLink({
        type: 'recovery',
        email: email,
        options: { redirectTo: req.headers.get('origin') || 'http://localhost:5501' }
      })
      return Response.json({
        ok: !error,
        link: data?.properties?.action_link,
        error: error?.message
      }, { headers: corsHeaders })
    }

    return Response.json({ ok: false, error: '不明なアクション' }, { status: 400, headers: corsHeaders })

  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500, headers: corsHeaders })
  }
})
