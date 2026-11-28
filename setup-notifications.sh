#!/usr/bin/env bash
# スタッフアプリのプッシュ通知まわりを Supabase へ一括セットアップする。
# GitHub Actions の deploy-notifications ワークフローから実行される。
# 必要な環境変数: SUPABASE_ACCESS_TOKEN (リポジトリシークレット)
set -euo pipefail
REF=wdbkdwhtocbdaufxufqs

echo "=== 1) Writing function sources ==="

mkdir -p "$(dirname supabase/functions/_shared/notify.ts)"
cat > supabase/functions/_shared/notify.ts <<'EOF_NOTIFY_TS'
// ============================================================
// 通知の共通処理（Edge Functions 用）
// - notifications テーブルへ履歴を INSERT（service role）
// - push_subscriptions を引いて Web Push を送信
// 必要な Secrets（supabase secrets set ...）:
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  … Edge Functions に自動注入
//   VAPID_KEYS_JSON    … VAPID鍵ペアのJWK JSON（生成方法は docs/notifications.md）
//   VAPID_SUBJECT      … 例: mailto:h.kgroup0901@gmail.com
//   WEBHOOK_SECRET     … Database Webhook からの呼び出し検証用
// ============================================================
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ApplicationServer, importVapidKeys } from "jsr:@negrel/webpush";

export const BAND_LABEL: Record<string, string> = {
  lunch: "ランチ 11:00–15:00",
  dinner: "ディナー 18:00–22:00",
  late: "深夜 22:00–27:00",
};
export const DOW = ["日", "月", "火", "水", "木", "金", "土"];

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Webhook 呼び出しの検証。直接 invoke（ブラウザ）の場合は JWT が付くため任意。 */
export function isAuthorized(req: Request): boolean {
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (secret && req.headers.get("x-webhook-secret") === secret) return true;
  // Supabase 経由の呼び出し（Authorization: Bearer ...）は許可する
  return !!req.headers.get("authorization");
}

// ---------- Web Push ----------
let appServerPromise: Promise<ApplicationServer> | null = null;
function getAppServer(): Promise<ApplicationServer> {
  if (!appServerPromise) {
    appServerPromise = (async () => {
      const keysJson = Deno.env.get("VAPID_KEYS_JSON");
      if (!keysJson) throw new Error("VAPID_KEYS_JSON is not set");
      const vapidKeys = await importVapidKeys(JSON.parse(keysJson));
      return await ApplicationServer.new({
        contactInformation: Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
        vapidKeys,
      });
    })();
  }
  return appServerPromise;
}

async function sendPushToStaff(
  sb: SupabaseClient,
  staffId: string,
  payload: { title: string; body: string; url?: string },
): Promise<boolean> {
  const { data: subs } = await sb
    .from("push_subscriptions")
    .select("id, endpoint, subscription")
    .eq("staff_id", staffId);
  if (!subs || subs.length === 0) return false;

  let server: ApplicationServer;
  try {
    server = await getAppServer();
  } catch (e) {
    console.error("VAPID not configured:", e);
    return false;
  }

  let sent = false;
  for (const row of subs) {
    try {
      const subscriber = server.subscribe(row.subscription);
      // @negrel/webpush: pushMessageJSON が無いバージョンでは pushTextMessage を使う
      const anySub = subscriber as unknown as Record<string, Function>;
      if (typeof anySub.pushMessageJSON === "function") {
        await anySub.pushMessageJSON(payload, {});
      } else {
        await anySub.pushTextMessage(JSON.stringify(payload), {});
      }
      sent = true;
    } catch (e) {
      const status = (e as { statusCode?: number; status?: number })?.statusCode
        ?? (e as { status?: number })?.status;
      console.error("push failed:", row.endpoint, e);
      // 購読が失効していたら削除する
      if (status === 404 || status === 410) {
        await sb.from("push_subscriptions").delete().eq("id", row.id);
      }
    }
  }
  return sent;
}

// ---------- 通知の登録＋送信 ----------
export interface NotifyInput {
  type: string;
  title: string;
  body: string;
  workRequestId?: string | null;
  url?: string;
}

/** 1名のスタッフへ：履歴を残し、Push も送る */
export async function notifyStaff(
  sb: SupabaseClient,
  staffId: string,
  input: NotifyInput,
): Promise<void> {
  const { data: notif, error } = await sb
    .from("notifications")
    .insert({
      staff_id: staffId,
      type: input.type,
      title: input.title,
      body: input.body,
      work_request_id: input.workRequestId ?? null,
    })
    .select("id")
    .single();
  if (error) {
    console.error("notifications insert failed:", error);
    return;
  }
  const pushed = await sendPushToStaff(sb, staffId, {
    title: input.title,
    body: input.body,
    url: input.url ?? "./index.html#inbox",
  });
  if (pushed) {
    await sb.from("notifications").update({ pushed: true }).eq("id", notif.id);
  }
}

/** 管理者（admin）と副管理者（subadmin）全員へ */
export async function notifyAdmins(
  sb: SupabaseClient,
  input: NotifyInput,
): Promise<void> {
  const { data: admins } = await sb
    .from("staff")
    .select("id")
    .in("role", ["admin", "subadmin"])
    .eq("active", true);
  for (const a of admins ?? []) {
    await notifyStaff(sb, a.id, input);
  }
}

/** '2026-12-05' -> '12月5日（金）' */
export function fmtDateJP(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00+09:00");
  return `${d.getMonth() + 1}月${d.getDate()}日（${DOW[d.getDay()]}）`;
}
EOF_NOTIFY_TS

mkdir -p "$(dirname supabase/functions/work-request-created/index.ts)"
cat > supabase/functions/work-request-created/index.ts <<'EOF_WR_CREATED'
// ============================================================
// 出勤依頼が作成されたら、対象スタッフへ通知する
// 起動経路:
//   A) Database Webhook: work_requests の INSERT
//      body = { type:'INSERT', table:'work_requests', record:{...} }
//   B) 管理画面からの直接 invoke: body = { work_request_id }
// ============================================================
import {
  adminClient, notifyStaff, isAuthorized, jsonResponse, corsHeaders,
  BAND_LABEL, fmtDateJP,
} from "../_shared/notify.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!isAuthorized(req)) return jsonResponse({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const sb = adminClient();

  const workRequestId = body.record?.id ?? body.work_request_id;
  if (!workRequestId) return jsonResponse({ error: "work_request_id required" }, 400);

  const { data: wr, error } = await sb
    .from("work_requests")
    .select("id, staff_id, date, band, message")
    .eq("id", workRequestId)
    .single();
  if (error || !wr) return jsonResponse({ error: "work_request not found" }, 404);

  await notifyStaff(sb, wr.staff_id, {
    type: "work_request",
    title: "出勤のお願いが届いています",
    body:
      `${fmtDateJP(wr.date)} ${BAND_LABEL[wr.band] ?? wr.band} に入ってもらえませんか？` +
      (wr.message ? `\n「${wr.message}」` : "") +
      `\nアプリの「お知らせ」から回答してね。`,
    workRequestId: wr.id,
  });

  return jsonResponse({ ok: true });
});
EOF_WR_CREATED

mkdir -p "$(dirname supabase/functions/work-request-answered/index.ts)"
cat > supabase/functions/work-request-answered/index.ts <<'EOF_WR_ANSWERED'
// ============================================================
// スタッフが出勤依頼に回答したら、管理者へ通知する
// 起動経路:
//   A) Database Webhook: work_requests の UPDATE（status の変化）
//      body = { type:'UPDATE', record:{...}, old_record:{...} }
//   B) スタッフアプリからの直接 invoke: body = { work_request_id }
// 承諾された場合は、確定シフトへの反映もサーバー側で冪等に行う。
// ============================================================
import {
  adminClient, notifyAdmins, isAuthorized, jsonResponse, corsHeaders,
  BAND_LABEL, fmtDateJP,
} from "../_shared/notify.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!isAuthorized(req)) return jsonResponse({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const sb = adminClient();

  const workRequestId = body.record?.id ?? body.work_request_id;
  if (!workRequestId) return jsonResponse({ error: "work_request_id required" }, 400);

  // Webhook の場合、status が変わっていない UPDATE では何もしない
  if (body.old_record && body.record &&
      body.old_record.status === body.record.status) {
    return jsonResponse({ ok: true, skipped: "status unchanged" });
  }

  const { data: wr, error } = await sb
    .from("work_requests")
    .select("id, staff_id, date, band, status")
    .eq("id", workRequestId)
    .single();
  if (error || !wr) return jsonResponse({ error: "work_request not found" }, 404);
  if (wr.status !== "accepted" && wr.status !== "declined") {
    return jsonResponse({ ok: true, skipped: "not answered yet" });
  }

  const { data: staff } = await sb
    .from("staff").select("name").eq("id", wr.staff_id).single();
  const name = staff?.name ?? "スタッフ";
  const when = `${fmtDateJP(wr.date)} ${BAND_LABEL[wr.band] ?? wr.band}`;

  if (wr.status === "accepted") {
    // 確定シフトへ反映（unique 制約で二重登録を防止）
    await sb.from("shifts").upsert(
      { staff_id: wr.staff_id, date: wr.date, band: wr.band },
      { onConflict: "staff_id,date,band", ignoreDuplicates: true },
    );
    await notifyAdmins(sb, {
      type: "answer_accepted",
      title: "出勤依頼が承諾されました",
      body: `${name}さんが ${when} の出勤依頼を承諾しました。確定シフトに反映済みです。`,
      workRequestId: wr.id,
    });
  } else {
    await notifyAdmins(sb, {
      type: "answer_declined",
      title: "出勤依頼が辞退されました",
      body: `${name}さんが ${when} の出勤依頼を辞退しました。代わりの人の検討をお願いします。`,
      workRequestId: wr.id,
    });
  }

  return jsonResponse({ ok: true });
});
EOF_WR_ANSWERED

mkdir -p "$(dirname supabase/functions/shifts-confirmed/index.ts)"
cat > supabase/functions/shifts-confirmed/index.ts <<'EOF_SHIFTS'
// ============================================================
// シフトが確定したら、対象スタッフへ通知する
// 起動経路: 管理画面の「シフト確定」処理からの直接 invoke
//   body = { shift_ids: string[] }  もしくは  { shifts: [{staff_id, date, band}] }
// スタッフごとに1通にまとめて通知する（1人ずつバラバラに送らない）。
// ============================================================
import {
  adminClient, notifyStaff, isAuthorized, jsonResponse, corsHeaders, fmtDateJP,
} from "../_shared/notify.ts";

interface ShiftRow { staff_id: string; date: string; band: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!isAuthorized(req)) return jsonResponse({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const sb = adminClient();

  let shifts: ShiftRow[] = [];
  if (Array.isArray(body.shifts) && body.shifts.length) {
    shifts = body.shifts;
  } else if (Array.isArray(body.shift_ids) && body.shift_ids.length) {
    const { data, error } = await sb
      .from("shifts")
      .select("staff_id, date, band")
      .in("id", body.shift_ids);
    if (error) return jsonResponse({ error: "shifts fetch failed" }, 500);
    shifts = data ?? [];
  } else {
    return jsonResponse({ error: "shift_ids or shifts required" }, 400);
  }
  if (!shifts.length) return jsonResponse({ ok: true, notified: 0 });

  // スタッフごとに集計
  const byStaff = new Map<string, ShiftRow[]>();
  for (const s of shifts) {
    if (!byStaff.has(s.staff_id)) byStaff.set(s.staff_id, []);
    byStaff.get(s.staff_id)!.push(s);
  }

  let notified = 0;
  for (const [staffId, rows] of byStaff) {
    rows.sort((a, b) => (a.date < b.date ? -1 : 1));
    const first = rows[0].date, last = rows[rows.length - 1].date;
    const range = first === last ? fmtDateJP(first) : `${fmtDateJP(first)}〜${fmtDateJP(last)}`;
    await notifyStaff(sb, staffId, {
      type: "shift_confirmed",
      title: "シフトが確定しました",
      body: `${range} のシフト（${rows.length}件）が確定しました。アプリの「シフト」で確認してね。`,
    });
    notified++;
  }

  return jsonResponse({ ok: true, notified });
});
EOF_SHIFTS

mkdir -p "$(dirname supabase/functions/correction-request-created/index.ts)"
cat > supabase/functions/correction-request-created/index.ts <<'EOF_CR_CREATED'
// ============================================================
// 打刻の訂正依頼が作成されたら、管理者へ通知する
// 起動経路:
//   A) Database Webhook: correction_requests の INSERT
//   B) スタッフアプリからの直接 invoke: body = { correction_request_id }
// ============================================================
import {
  adminClient, notifyAdmins, isAuthorized, jsonResponse, corsHeaders, fmtDateJP,
} from "../_shared/notify.ts";

const FIELD_LABEL: Record<string, string> = {
  clock_in: "出勤", clock_out: "退勤",
  break_start: "休憩開始", break_end: "休憩終了",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!isAuthorized(req)) return jsonResponse({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const sb = adminClient();

  const id = body.record?.id ?? body.correction_request_id;
  if (!id) return jsonResponse({ error: "correction_request_id required" }, 400);

  const { data: cr, error } = await sb
    .from("correction_requests")
    .select("id, staff_id, field, requested_at, reason")
    .eq("id", id)
    .single();
  if (error || !cr) return jsonResponse({ error: "correction_request not found" }, 404);

  const { data: staff } = await sb
    .from("staff").select("name").eq("id", cr.staff_id).single();
  const name = staff?.name ?? "スタッフ";
  const at = new Date(cr.requested_at);
  const hhmm = `${at.getHours()}:${String(at.getMinutes()).padStart(2, "0")}`;

  await notifyAdmins(sb, {
    type: "correction_request",
    title: "打刻の訂正依頼が届いています",
    body:
      `${name}さんから訂正依頼です。${FIELD_LABEL[cr.field] ?? cr.field} を ` +
      `${fmtDateJP(cr.requested_at.slice(0, 10))} ${hhmm} に直したいとのことです。` +
      (cr.reason ? `\n理由：「${cr.reason}」` : "") +
      `\nアプリの「お知らせ」で承認・却下できます。`,
  });

  return jsonResponse({ ok: true });
});
EOF_CR_CREATED

mkdir -p "$(dirname supabase/functions/correction-request-decided/index.ts)"
cat > supabase/functions/correction-request-decided/index.ts <<'EOF_CR_DECIDED'
// ============================================================
// 訂正依頼が承認/却下されたら、打刻へ反映し、スタッフへ結果を通知する
// 起動経路:
//   A) Database Webhook: correction_requests の UPDATE
//   B) 管理者操作からの直接 invoke: body = { correction_request_id }
// processed_at で多重処理を防止する。
// ============================================================
import {
  adminClient, notifyStaff, isAuthorized, jsonResponse, corsHeaders, fmtDateJP,
} from "../_shared/notify.ts";

const FIELD_LABEL: Record<string, string> = {
  clock_in: "出勤", clock_out: "退勤",
  break_start: "休憩開始", break_end: "休憩終了",
};

/** timestamptz を Asia/Tokyo の 'YYYY-MM-DD' にする */
function dateInJST(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" })
    .format(new Date(iso));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!isAuthorized(req)) return jsonResponse({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const sb = adminClient();

  const id = body.record?.id ?? body.correction_request_id;
  if (!id) return jsonResponse({ error: "correction_request_id required" }, 400);

  const { data: cr, error } = await sb
    .from("correction_requests")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !cr) return jsonResponse({ error: "correction_request not found" }, 404);
  if (cr.status === "pending") return jsonResponse({ ok: true, skipped: "not decided yet" });
  if (cr.processed_at) return jsonResponse({ ok: true, skipped: "already processed" });

  const label = FIELD_LABEL[cr.field] ?? cr.field;
  const at = new Date(cr.requested_at);
  const hhmm = `${at.getHours()}:${String(at.getMinutes()).padStart(2, "0")}`;
  const whenText = `${fmtDateJP(cr.requested_at.slice(0, 10))} ${hhmm}`;

  if (cr.status === "approved") {
    // ---- 打刻へ反映 ----
    if (cr.attendance_id) {
      const { data: att } = await sb
        .from("attendance").select("*").eq("id", cr.attendance_id).single();
      if (att) {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (cr.field === "clock_in") {
          patch.clock_in = cr.requested_at;
          patch.date = dateInJST(cr.requested_at); // 日をまたぐ訂正にも対応
        } else if (cr.field === "clock_out") {
          patch.clock_out = cr.requested_at;
        } else {
          const breaks = Array.isArray(att.breaks) ? [...att.breaks] : [];
          const idx = cr.break_index ?? 0;
          if (breaks[idx]) {
            breaks[idx] = {
              ...breaks[idx],
              [cr.field === "break_start" ? "start" : "end"]: cr.requested_at,
            };
            patch.breaks = breaks;
          }
        }
        await sb.from("attendance").update(patch).eq("id", att.id);
      }
    }
    await notifyStaff(sb, cr.staff_id, {
      type: "correction_approved",
      title: "打刻の訂正が承認されました",
      body: `${label} を ${whenText} に訂正しました。確認ありがとうございます。`,
    });
  } else {
    await notifyStaff(sb, cr.staff_id, {
      type: "correction_rejected",
      title: "打刻の訂正依頼が却下されました",
      body: `${label}（${whenText} への訂正）は却下されました。心当たりがあれば神坂さんか柳村さんに直接聞いてね。`,
    });
  }

  await sb.from("correction_requests")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", cr.id);

  return jsonResponse({ ok: true });
});
EOF_CR_DECIDED

printf 'project_id = "karamenya-staff"\n' > supabase/config.toml

echo "=== 2) Generating VAPID keys and webhook secret ==="
node <<'EOF_NODE'
const { writeFileSync, appendFileSync } = require("fs");
(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  writeFileSync("/tmp/vapid_keys.json",
    JSON.stringify({ publicKey: publicJwk, privateKey: privateJwk }));
  const x = Buffer.from(publicJwk.x, "base64url");
  const y = Buffer.from(publicJwk.y, "base64url");
  const appKey = Buffer.concat([Buffer.from([4]), x, y]).toString("base64url");
  const rnd = new Uint8Array(48);
  crypto.getRandomValues(rnd);
  writeFileSync("/tmp/webhook_secret.txt", Buffer.from(rnd).toString("base64url"));
  console.log("APP_SERVER_KEY=" + appKey);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      "## VAPID public key (config.js no VAPID_PUBLIC_KEY e)\n\n`APP_SERVER_KEY=" + appKey + "`\n");
  }
})();
EOF_NODE

echo "=== 3) Link, set secrets, deploy functions ==="
supabase link --project-ref "$REF"
supabase secrets set \
  "VAPID_KEYS_JSON=$(cat /tmp/vapid_keys.json)" \
  "VAPID_SUBJECT=mailto:h.kgroup0901@gmail.com" \
  "WEBHOOK_SECRET=$(cat /tmp/webhook_secret.txt)" --yes
for f in work-request-created work-request-answered shifts-confirmed correction-request-created correction-request-decided; do
  supabase functions deploy "$f" --no-verify-jwt --yes
done

echo "=== 4) Creating database webhooks ==="
python3 <<'EOF_PY'
import json, os, urllib.request

ref = "wdbkdwhtocbdaufxufqs"
token = os.environ["SUPABASE_ACCESS_TOKEN"]
with open("/tmp/webhook_secret.txt") as fh:
    secret = fh.read().strip()

def run_sql(sql):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
        method="POST")
    with urllib.request.urlopen(req) as res:
        return res.read().decode()

sig = run_sql("""
  SELECT pg_get_function_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'supabase_functions' AND p.proname = 'http_request'
  LIMIT 1;
""")
print("http_request signature:", sig)

base = f"https://{ref}.supabase.co/functions/v1"
hooks = [
    ("notify-work-request-created", "work_requests", "INSERT", f"{base}/work-request-created"),
    ("notify-work-request-answered", "work_requests", "UPDATE", f"{base}/work-request-answered"),
    ("notify-correction-created", "correction_requests", "INSERT", f"{base}/correction-request-created"),
    ("notify-correction-decided", "correction_requests", "UPDATE", f"{base}/correction-request-decided"),
]
for name, table, event, url in hooks:
    headers = json.dumps({"Content-Type": "application/json",
                          "x-webhook-secret": secret})
    sql = f"""
      DROP TRIGGER IF EXISTS "{name}" ON public.{table};
      CREATE TRIGGER "{name}"
      AFTER {event} ON public.{table}
      FOR EACH ROW
      EXECUTE FUNCTION supabase_functions.http_request(
        '{url}', 'POST', '{headers}', '{{}}', '5000');
    """
    run_sql(sql)
    print("trigger created:", name)

out = run_sql("""
  SELECT trigger_name FROM information_schema.triggers
  WHERE trigger_name LIKE 'notify-%' ORDER BY trigger_name;
""")
print("webhook triggers now:", out)
EOF_PY

echo "=== 5) Verifying deployed functions ==="
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$REF/functions" \
  | python3 -c "import json,sys; [print(f['slug'], f['status']) for f in json.load(sys.stdin)]"
echo "=== DONE ==="
