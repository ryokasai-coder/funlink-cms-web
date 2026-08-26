/**
 * FunLink CMS — データ品質チェックスクリプト
 * 実行: node data-quality-check.js
 * 出力: data-quality-report.json
 *
 * チェック項目:
 *   1. FLコード重複
 *   2. 契約中でfee=0またはnull
 *   3. stores配列が空（契約中）
 *   4. statusの表記ゆれ（想定値以外）
 *   5. start日付が不正または欠損（契約中）
 *   6. startが未来日（異常値）
 *   7. 会社名が空
 */

const SUPABASE_URL = 'https://xfumvuxahjferrapdywj.supabase.co';
const ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmdW12dXhhaGpmZXJyYXBkeXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMzIxNzQsImV4cCI6MjA5NjcwODE3NH0.6NX0EQubDt3h-jy2E9VDS2ehb6IhFnYnHTajNQ4YEM4';

const VALID_STATUSES = ['契約中', '解約', '仮登録', '休止', '見込み', '契約終了', '無償運用'];
const fs    = require('fs');
const https = require('https');

function fetchJson(url, headers) {
  return new Promise(function(resolve, reject) {
    var opts = require('url').parse(url);
    opts.headers = headers;
    https.get(opts, function(res) {
      // チャンクはBufferのまま貯めて最後にまとめてUTF-8デコードする。
      // 文字列連結(body += c)だとマルチバイト文字がチャンク境界で分割された際に
      // 文字化けし、正常なDB値まで「表記ゆれ」と誤検知するため。
      var chunks = [];
      res.on('data', function(c){ chunks.push(c); });
      res.on('end', function(){
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch(e){ reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('[1/3] Supabaseからcms_storeのcasesレコードを取得中...');
  var data = await fetchJson(
    SUPABASE_URL + '/rest/v1/cms_store?id=eq.cases&select=data',
    {
      'apikey':        ANON_KEY,
      'Authorization': 'Bearer ' + ANON_KEY,
      'Content-Type':  'application/json'
    }
  );

  if (!data || !data[0] || !data[0].data || !data[0].data.master) {
    console.error('エラー: casesデータが取得できませんでした');
    process.exit(1);
  }

  var cases = data[0].data.master;
  var todayStr = new Date().toISOString().slice(0, 10);
  console.log('[2/3] ' + cases.length + '社のデータをチェック中...');

  var report = {
    checked_at:    todayStr,
    total_cases:   cases.length,
    issues:        [],
    info:          [],   // 問題ではないが参考情報（将来開始契約など）
    summary:       {}
  };

  var flSeen   = {};
  var issueCounts = {
    duplicate_fl:        0,
    null_fee:            0,
    zero_fee:            0,
    empty_stores:        0,
    invalid_status:      0,
    missing_start:       0,
    empty_name:          0
  };

  cases.forEach(function(c) {
    // 1. FLコード重複
    if (!c.fl) {
      report.issues.push({ type: 'missing_fl', fl: '(空)', name: c.name || '' });
    } else {
      if (flSeen[c.fl]) {
        issueCounts.duplicate_fl++;
        report.issues.push({ type: 'duplicate_fl', fl: c.fl, name: c.name || '' });
      }
      flSeen[c.fl] = true;
    }

    // 2. 会社名が空
    if (!c.name || !c.name.trim()) {
      issueCounts.empty_name++;
      report.issues.push({ type: 'empty_name', fl: c.fl || '(空)', name: '' });
    }

    // 3. statusの表記ゆれ
    if (!VALID_STATUSES.includes(c.status)) {
      issueCounts.invalid_status++;
      report.issues.push({ type: 'invalid_status', fl: c.fl, name: c.name, value: c.status || '(未設定)' });
    }

    // 契約中に限定したチェック
    if (c.status === '契約中') {
      // 4. fee=nullまたは0
      if (c.fee == null || c.fee === '') {
        issueCounts.null_fee++;
        report.issues.push({ type: 'null_fee', fl: c.fl, name: c.name, value: String(c.fee) });
      } else if (Number(c.fee) === 0) {
        issueCounts.zero_fee++;
        report.issues.push({ type: 'zero_fee', fl: c.fl, name: c.name, value: 0 });
      }

      // 5. stores配列が空または未定義
      if (!c.stores || c.stores.length === 0) {
        issueCounts.empty_stores++;
        report.issues.push({ type: 'empty_stores', fl: c.fl, name: c.name });
      }

      // 6. start欠損
      if (!c.start) {
        issueCounts.missing_start++;
        report.issues.push({ type: 'missing_start', fl: c.fl, name: c.name });
      } else {
        // 7. start未来日（今日より後）＝将来スタート契約として正当なケースがあるため
        //    「問題」ではなく参考情報(info)として記録する（総問題件数には含めない）
        if (c.start > todayStr) {
          report.info.push({ type: 'future_start', fl: c.fl, name: c.name, value: c.start });
        }
      }
    }
  });

  report.summary = issueCounts;
  report.total_issues = report.issues.length;

  // 集計サマリー出力
  console.log('\n===== データ品質チェック結果 =====');
  console.log('チェック対象: ' + cases.length + '社');
  console.log('問題件数合計: ' + report.total_issues + '件\n');
  Object.keys(issueCounts).forEach(function(k) {
    if (issueCounts[k] > 0) {
      var labels = {
        duplicate_fl:   'FLコード重複',
        null_fee:        '月額 null/未設定（契約中）',
        zero_fee:        '月額 ¥0（契約中）',
        empty_stores:    '店舗情報なし（契約中）',
        invalid_status:  'ステータス表記ゆれ',
        missing_start:   '開始日欠損（契約中）',
        empty_name:      '会社名が空'
      };
      console.log('  ⚠  ' + (labels[k] || k) + ': ' + issueCounts[k] + '件');
    }
  });

  if (report.total_issues === 0) {
    console.log('  ✅ 全チェック通過 — 問題なし');
  }

  // 参考情報（問題ではない）
  if (report.info.length > 0) {
    console.log('\n----- 参考情報（問題ではない） -----');
    report.info.forEach(function(i) {
      if (i.type === 'future_start') {
        console.log('  ℹ  将来スタート契約: ' + i.fl + ' ' + i.name + ' → ' + i.value);
      }
    });
  }

  var outPath = 'data-quality-report.json';
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('\n詳細レポート → ' + outPath);
  console.log('================================\n');
}

main().catch(function(e) {
  console.error('実行エラー:', e.message);
  process.exit(1);
});
