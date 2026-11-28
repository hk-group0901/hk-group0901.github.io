/* ============================================================
辛麺屋 物語 スタッフアプリ
- ログイン（Supabase Auth）／デモモード（端末内データ）
- 打刻 / シフト希望提出 / シフト確認 / 給与明細 / お知らせ
接続情報は config.js。Supabase 未設定 or デモ指定時はデモモード。
============================================================ */
(function () {
"use strict";
const CFG = window.APP_CONFIG;
const PR = CFG.PAYROLL;
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const BAND = {
lunch: { label: "ランチ", time: "11:00–15:00", start: "11:00", end: "15:00"},
dinner: { label: "ディナー", time: "18:00–22:00", start: "18:00", end: "22:00"},
late: { label: "深夜", time: "22:00–27:00", start: "22:00", end: "27:00"}
};

// ---------- モード判定 ----------
const forceDemo = localStorage.getItem("karamenya_force_demo") === "1";
const hasSupabase =!!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
const DEMO = forceDemo ||!hasSupabase;
const sb =!DEMO? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY): null;

// ---------- ユーティリティ ----------
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtYen = (n) => "¥" + Math.round(n).toLocaleString("ja-JP");
const fmtHM = (min) => `${Math.floor(min / 60)}時間${pad(Math.round(min % 60))}分`;
const esc = (s) => String(s?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
function toast(msg) {
const t = $("toast"); t.textContent = msg; t.classList.add("show");
setTimeout(() => t.classList.remove("show"), 2600);
}
const uid = () => { if (crypto.randomUUID) return crypto.randomUUID(); const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80; const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20); };

// ============================================================
// デモデータ
// ============================================================
const ROSTER = [
// name, short(苗字), role, canCook, wage, その他手当まわりのサンプル値
["神坂春貴", "神坂", "admin", true, 0],
["柳村奎弥", "柳村", "subadmin", true, 1250],
["沼口健太郎", "沼口", "staff", true, 1085],
["山口直也", "山口", "staff", true, 1085],
["黒木一真", "黒木", "staff", true, 1150],
["妹尾里佳", "妹尾", "staff", false, 1085],
["神坂凛", "神坂", "staff", false, 1085],
["島本蒼", "島本", "staff", false, 1085],
["阿久井真奈美", "阿久井", "staff", false, 1500],
["吉村汐織", "吉村", "staff", false, 1085],
["矢野恵", "矢野", "staff", false, 1085],
["福島妙子", "福島", "staff", false, 1085],
["打刻用iPad", "iPad", "kiosk", false, 0]
];
// 社員（月給制）の固定給。柳村奎弥（マネージャー）・島本蒼（BAR OK ROCK店長）。
// 金額は確定値。基本給は最低賃金対応のため2026年11月分から185,000円
// （2026年10月実績明細では177,320円）。深夜手当（固定額）も11月分から
// 27,000円に改定（2026年10月実績明細では25,790円）。
// drink はドリンクバックのサンプル値。
const SALARY = {
"柳村奎弥": { base: 185000, position: 10000, night: 27000, deemed: 10000, transport: 0, drink: 10800, si: false},
"島本蒼": { base: 185000, position: 10000, night: 27000, deemed: 10000, transport: 5000, drink: 5400, si: true}
};
function seedDemo() {
const staff = ROSTER.map((r, i) => ({
id: "demo-" + (i + 1), name: r[0], short: r[1], role: r[2], can_cook: r[3],
hourly_wage: r[4] || PR.defaultHourlyWage,
night_included: r[0] === "阿久井真奈美", // 阿久井は時給1500円（深夜手当込み）
quota_wage: (r[0] === "山口直也" || r[0] === "沼口健太郎")? 1500: null, // ノルマ達成時の時給
quota_threshold: (r[0] === "山口直也" || r[0] === "沼口健太郎")? 3000000: null,
cross_allowance: (r[0] === "柳村奎弥" || r[0] === "島本蒼")? 3000: null, // 辛麺屋出勤手当（1日あたり、所定時間外賃金として支給）
pay_type: SALARY[r[0]]? "salary": "hourly", // 給与形態（社員は月給制）
base_salary: SALARY[r[0]]? SALARY[r[0]].base: 0, // 月給制の基本給
fixed_night_allowance: SALARY[r[0]]? SALARY[r[0]].night: 0, // 月給制の深夜手当（固定額）
social_insurance: SALARY[r[0]]? SALARY[r[0]].si: null, // 月給制の社保加入（柳村=false / 島本=true）
position_allowance: SALARY[r[0]]? SALARY[r[0]].position: (r[2] === "subadmin"? 10000: 0), // 役職手当
deemed_overtime: SALARY[r[0]]? SALARY[r[0]].deemed: 0, // みなし残業
transport_allowance: SALARY[r[0]]? SALARY[r[0]].transport: 0, // 交通費
drink_back: SALARY[r[0]]? SALARY[r[0]].drink: 0, // ドリンクバック（月次入力のサンプル値）
other_allowances: [], social_insurance_enrolled: r[2]!== "staff",
dependents: 0, resident_tax: 0, advance_payment: 0,
shop_name: "辛麺屋 物語 中町本店", active: true, sort_order: i + 1
}));
const db = { staff, attendance: [], shift_requests: [], shifts: [], work_requests: [], notifications: [], monthly_sales: []};
// 今月の確定シフト（サンプルパターン）
const now = new Date();
// 月売上のサンプル（ノルマ判定用）：今月はノルマ未達ペース、先月は達成
db.monthly_sales = [
{ month: fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), sales: 2860000 },
{ month: fmtDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), sales: 3120000 }
];
const gen = (y, m) => {
const days = new Date(y, m + 1, 0).getDate();
const byName = (n) => staff.find((s) => s.name === n).id;
for (let d = 1; d <= days; d++) {
const date = new Date(y, m, d), dow = date.getDay(), ds = fmtDate(date);
if (dow === 2) continue;
const add = (n, band, s, e) => db.shifts.push({ id: uid(), staff_id: byName(n), date: ds, band, start_time: s || null, end_time: e || null});
if (dow!== 0) { add(dow === 6? "神坂春貴": "黒木一真", "lunch"); add("妹尾里佳", "lunch");}
if (dow === 3) add("神坂春貴", "dinner", "18:00", "21:30"); else add("柳村奎弥", "dinner");
add("神坂凛", "dinner");
add(dow === 5 || dow === 6? "山口直也": "沼口健太郎", "late");
if (dow === 1 || dow === 3) add("福島妙子", "late");
if (dow >= 4 || dow === 0) add("矢野恵", "late");
if (dow === 5 || dow === 6) add("吉村汐織", "late");
}
};
gen(now.getFullYear(), now.getMonth());
gen(now.getFullYear(), now.getMonth() + 1 > 11? 0: now.getMonth() + 1);
// シフト希望のサンプル（管理者の「提出状況」画面の確認用）：
// 今月と来月分を、提出する6名のパターンで作る。
// 沼口・神坂凛・阿久井は未提出のまま（未提出一覧の見え方も確認できる）。
const reqGen = (y, m) => {
const days = new Date(y, m + 1, 0).getDate();
const byName = (n) => staff.find((s) => s.name === n).id;
const addR = (n, d, band) => db.shift_requests.push({
id: uid(), staff_id: byName(n), date: fmtDate(new Date(y, m, d)), band,
status: "pending", created_at: new Date().toISOString()});
for (let d = 1; d <= days; d++) {
const dow = new Date(y, m, d).getDay();
if (dow === 2) continue; // 火曜定休
if (dow!== 0) addR("妹尾里佳", d, "lunch");
if (dow === 1 || dow === 3 || dow === 5) addR("黒木一真", d, "lunch");
if (dow === 5 || dow === 6) { addR("山口直也", d, "late"); addR("吉村汐織", d, "dinner"); addR("吉村汐織", d, "late");}
if (dow === 4 || dow === 5 || dow === 6 || dow === 0) addR("矢野恵", d, "late");
if (dow === 1 || dow === 3) addR("福島妙子", d, "late");
}
};
reqGen(now.getFullYear(), now.getMonth());
const nextM = new Date(now.getFullYear(), now.getMonth() + 1, 1);
reqGen(nextM.getFullYear(), nextM.getMonth());
// 先月分も生成する：辛麺屋出勤手当は確定シフトの日数で数えるため、
// 先月の給与明細プレビューでも手当が付くように（打刻からは数えない）
const prevGen = new Date(now.getFullYear(), now.getMonth() - 1, 1);
gen(prevGen.getFullYear(), prevGen.getMonth());
// 先月の勤怠サンプル（給与明細の見え方確認用）：数名分だけ軽く生成
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
staff.forEach((s) => {
if (s.role === "kiosk") return; // 打刻用iPadは勤怠サンプルを作らない
for (let d = 1; d <= 20; d++) {
const date = new Date(prev.getFullYear(), prev.getMonth(), d);
if (date.getDay() === 2 || (d + s.sort_order) % 3 === 0) continue;
const inn = new Date(date); inn.setHours(18, 0, 0, 0);
const out = new Date(date); out.setHours(23, 30, 0, 0);
db.attendance.push({
id: uid(), staff_id: s.id, date: fmtDate(date),
clock_in: inn.toISOString(), clock_out: out.toISOString(),
breaks: [{ start: new Date(date.setHours(20, 0)).toISOString(), end: new Date(date.setHours(20, 30)).toISOString()}]
});
}
});
localStorage.setItem("karamenya_demo_db", JSON.stringify(db));
return db;
}
function loadDemo() {
try {
const raw = localStorage.getItem("karamenya_demo_db");
if (raw) return JSON.parse(raw);
} catch (e) { /* ignore */}
return seedDemo();
}
let demoDB = DEMO? loadDemo(): null;
const saveDemo = () => { if (DEMO) localStorage.setItem("karamenya_demo_db", JSON.stringify(demoDB));};

// ============================================================
// データ層（demo / supabase の2実装）
// ============================================================
const DB = {
async listStaff() {
if (DEMO) return demoDB.staff.filter((s) => s.active);
const { data} = await sb.from("staff").select("*").eq("active", true).order("sort_order");
return data || [];
},
async staffByAuthUser(userId) {
const { data} = await sb.from("staff").select("*").eq("auth_user_id", userId).single();
return data;
},
async todayAttendance(dateStr) {
if (DEMO) return demoDB.attendance.filter((a) => a.date === dateStr);
const { data} = await sb.from("attendance").select("*").eq("date", dateStr);
return data || [];
},
async myAttendanceMonth(staffId, y, m) {
const from = fmtDate(new Date(y, m, 1)), to = fmtDate(new Date(y, m + 1, 0));
if (DEMO) return demoDB.attendance.filter((a) => a.staff_id === staffId && a.date >= from && a.date <= to);
const { data} = await sb.from("attendance").select("*").eq("staff_id", staffId).gte("date", from).lte("date", to);
return data || [];
},
async getMonthlySales(y, m) {
// 月売上（ノルマ判定用）。未登録の月は null を返す
const monthStr = `${y}-${pad(m + 1)}-01`;
if (DEMO) {
const r = (demoDB.monthly_sales || []).find((x) => x.month === monthStr);
return r? r.sales: null;
}
const { data} = await sb.from("monthly_sales").select("sales").eq("month", monthStr).maybeSingle();
return data? data.sales: null;
},
async upsertAttendance(rec) {
if (DEMO) {
const i = demoDB.attendance.findIndex((a) => a.id === rec.id);
if (i >= 0) demoDB.attendance[i] = rec; else demoDB.attendance.push(rec);
saveDemo(); return rec;
}
const { data} = await sb.from("attendance").upsert(rec).select().single();
return data;
},
async listShifts(y, m) {
const from = fmtDate(new Date(y, m, 1)), to = fmtDate(new Date(y, m + 1, 0));
if (DEMO) return demoDB.shifts.filter((s) => s.date >= from && s.date <= to);
const { data} = await sb.from("shifts").select("*").gte("date", from).lte("date", to);
return data || [];
},
async myRequests(staffId, y, m) {
const from = fmtDate(new Date(y, m, 1)), to = fmtDate(new Date(y, m + 1, 0));
if (DEMO) return demoDB.shift_requests.filter((r) => r.staff_id === staffId && r.date >= from && r.date <= to);
const { data} = await sb.from("shift_requests").select("*").eq("staff_id", staffId).gte("date", from).lte("date", to);
return data || [];
},
async addRequests(rows) {
if (DEMO) { rows.forEach((r) => demoDB.shift_requests.push(r)); saveDemo(); return null;}
const { error } = await sb.from("shift_requests").insert(rows);
return error;
},
async listNotifications(staffId) {
if (DEMO) return demoDB.notifications.filter((n) => n.staff_id === staffId)
.sort((a, b) => (a.created_at < b.created_at? 1: -1));
const { data} = await sb.from("notifications").select("*").eq("staff_id", staffId)
.order("created_at", { ascending: false}).limit(50);
return data || [];
},
async markNotificationRead(id) {
if (DEMO) { const n = demoDB.notifications.find((x) => x.id === id); if (n) n.read = true; saveDemo(); return;}
await sb.from("notifications").update({ read: true}).eq("id", id);
},
async getWorkRequest(id) {
if (DEMO) return demoDB.work_requests.find((w) => w.id === id);
const { data} = await sb.from("work_requests").select("*").eq("id", id).single();
return data;
},
async answerWorkRequest(id, answer) { // answer: 'accepted' | 'declined'
if (DEMO) {
const w = demoDB.work_requests.find((x) => x.id === id);
if (w) {
w.status = answer;
if (answer === "accepted") {
demoDB.shifts.push({ id: uid(), staff_id: w.staff_id, date: w.date, band: w.band, start_time: null, end_time: null});
}
}
saveDemo(); return;
}
// 本番：status を更新すると、サーバー側（DB Webhook → Edge Function）が
// 承諾時に確定シフトを作成し、管理者へ通知します。
// 保険として Edge Function を直接 invoke もします（関数側で多重通知を防止）。
await sb.from("work_requests").update({ status: answer, answered_at: new Date().toISOString()}).eq("id", id);
try {
await sb.functions.invoke("work-request-answered", { body: { work_request_id: id } });
} catch (e) { /* Webhook 側で通知されるため失敗しても無視 */ }
},
async savePushSubscription(sub) {
if (DEMO) { localStorage.setItem("karamenya_push_sub", JSON.stringify(sub)); return;}
await sb.from("push_subscriptions").upsert(
{ staff_id: ME.id, endpoint: sub.endpoint, subscription: sub},
{ onConflict: "endpoint"}
);
},
async myAttendanceSince(staffId, fromDateStr) {
if (DEMO) return demoDB.attendance.filter((a) => a.staff_id === staffId && a.date >= fromDateStr);
const { data } = await sb.from("attendance").select("*").eq("staff_id", staffId).gte("date", fromDateStr).order("date");
return data || [];
},
async addCorrectionRequest(row) {
if (DEMO) {
demoDB.correction_requests = demoDB.correction_requests || [];
demoDB.correction_requests.push(row);
// デモ：管理者・副管理者へお知らせを入れる（本番は Edge Function が担当）
demoDB.staff.filter((s) => s.role === "admin" || s.role === "subadmin").forEach((a) => {
demoDB.notifications.push({ id: uid(), staff_id: a.id, type: "correction_request",
title: "打刻の訂正依頼が届いています", body: `${ME.name}さんから訂正依頼が届きました。お知らせ画面で確認してください。`,
created_at: new Date().toISOString(), read: false, work_request_id: null });
});
saveDemo(); return null;
}
const { error } = await sb.from("correction_requests").insert(row);
if (error) return error;
try { await sb.functions.invoke("correction-request-created", { body: { correction_request_id: row.id } }); } catch (e) {}
return null;
},
async myCorrectionRequests(staffId) {
if (DEMO) return (demoDB.correction_requests || []).filter((c) => c.staff_id === staffId)
.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
const { data } = await sb.from("correction_requests").select("*").eq("staff_id", staffId)
.order("created_at", { ascending: false }).limit(30);
return data || [];
},
async pendingCorrectionRequests() {
if (DEMO) return (demoDB.correction_requests || []).filter((c) => c.status === "pending");
const { data } = await sb.from("correction_requests").select("*").eq("status", "pending")
.order("created_at", { ascending: true });
return data || [];
},
async decideCorrectionRequest(id, decision) { // decision: 'approved' | 'rejected'
if (DEMO) {
const cr = (demoDB.correction_requests || []).find((c) => c.id === id);
if (!cr) return;
cr.status = decision; cr.decided_by = ME.id; cr.decided_at = new Date().toISOString();
if (decision === "approved") applyCorrectionToAttendance(cr);
demoDB.notifications.push({ id: uid(), staff_id: cr.staff_id,
type: decision === "approved" ? "correction_approved" : "correction_rejected",
title: decision === "approved" ? "打刻の訂正が承認されました" : "打刻の訂正依頼が却下されました",
body: decision === "approved" ? "訂正が反映されました。確認ありがとうございます。" : "心当たりがあれば神坂さんか柳村さんに直接聞いてね。",
created_at: new Date().toISOString(), read: false, work_request_id: null });
saveDemo(); return;
}
// 本番：status 更新 → Webhook/直接 invoke で Edge Function が打刻へ反映し、スタッフへ通知
await sb.from("correction_requests").update(
{ status: decision, decided_by: ME.id, decided_at: new Date().toISOString() }).eq("id", id);
try { await sb.functions.invoke("correction-request-decided", { body: { correction_request_id: id } }); } catch (e) {}
},
// ---------- 管理者用 ----------
async listAllRequests(y, m) {
// 全員分のシフト希望（管理者の提出状況・確定作業用）
const from = fmtDate(new Date(y, m, 1)), to = fmtDate(new Date(y, m + 1, 0));
if (DEMO) return demoDB.shift_requests.filter((r) => r.date >= from && r.date <= to);
const { data } = await sb.from("shift_requests").select("*").gte("date", from).lte("date", to);
return data || [];
},
async saveShift(row) {
// 確定シフトの保存。row.id があれば時刻の更新、なければ
// (staff_id, date, band) の一意制約で upsert する。
if (DEMO) {
if (row.id) {
const i = demoDB.shifts.findIndex((s) => s.id === row.id);
if (i >= 0) demoDB.shifts[i] = { ...demoDB.shifts[i], ...row };
else demoDB.shifts.push(row);
} else {
const i = demoDB.shifts.findIndex((s) => s.staff_id === row.staff_id && s.date === row.date && s.band === row.band);
if (i >= 0) demoDB.shifts[i] = { ...demoDB.shifts[i], ...row, id: demoDB.shifts[i].id };
else demoDB.shifts.push({ ...row, id: uid() });
}
saveDemo(); return;
}
if (row.id) {
await sb.from("shifts").update({ start_time: row.start_time, end_time: row.end_time }).eq("id", row.id);
} else {
await sb.from("shifts").upsert(
{ staff_id: row.staff_id, date: row.date, band: row.band, start_time: row.start_time, end_time: row.end_time },
{ onConflict: "staff_id,date,band" });
}
},
async deleteShift(id) {
if (DEMO) { demoDB.shifts = demoDB.shifts.filter((s) => s.id !== id); saveDemo(); return; }
await sb.from("shifts").delete().eq("id", id);
},
async addNotifications(rows) {
// アプリ内お知らせへの直接登録（管理者のシフト確定通知用）。
// 本番は RLS ポリシー notifications_insert_admin（管理者のみ INSERT 可）を使う。
// 失敗してもシフト確定そのものは成立しているため、例外は握りつぶす。
if (!rows.length) return;
if (DEMO) {
rows.forEach((r) => demoDB.notifications.push({ read: false, work_request_id: null, ...r }));
saveDemo(); return;
}
try { await sb.from("notifications").insert(rows.map((r) => ({ ...r, work_request_id: null }))); } catch (e) {}
},
async setMonthlySales(y, m, sales) {
// 月売上の登録・更新（ノルマ判定の元データ）
const monthStr = `${y}-${pad(m + 1)}-01`;
if (DEMO) {
demoDB.monthly_sales = demoDB.monthly_sales || [];
const r = demoDB.monthly_sales.find((x) => x.month === monthStr);
if (r) r.sales = sales; else demoDB.monthly_sales.push({ month: monthStr, sales });
saveDemo(); return;
}
await sb.from("monthly_sales").upsert(
{ month: monthStr, sales, updated_at: new Date().toISOString() },
{ onConflict: "month" });
}
};

// ============================================================
// セッション
// ============================================================
let ME = null; // 自分の staff レコード
let STAFF = []; // 全スタッフ（kiosk行は除く）
const IS_KIOSK = () =>!!ME && ME.role === "kiosk"; // 打刻用iPadでログイン中か
const staffName = (id) => (STAFF.find((s) => s.id === id) || {}).name || "";
const staffShort = (id) => (STAFF.find((s) => s.id === id) || {}).short || "";

async function enterApp() {
// 打刻用iPad（kiosk）は名簿表示から除く（自分の行は ME として保持）
STAFF = (await DB.listStaff()).filter((s) => s.role!== "kiosk");
// アプリのロック（Face ID／PIN）が有効な端末では、解除するまで中身を見せない。
// 打刻用iPad（kiosk）にはロックを適用しない。
if (!IS_KIOSK() && isLockEnabled() && !lockUnlocked) {
$("view-login").classList.remove("active");
$("view-login").style.display = "none";
await requireUnlock();
}
$("view-login").classList.remove("active");
$("view-login").style.display = "none";
$("app-shell").style.display = "block";
const now = new Date();
const greet = now.getHours() < 11? "おはようございます": now.getHours() < 17? "こんにちは": "こんばんは";
$("hello-name").textContent = `${greet}、${ME.name}さん`;
if (IS_KIOSK()) {
// 打刻専用モード：個人情報の画面（給与など）は出さず、打刻だけにする
$("bottom-nav").style.display = "none";
$("hello-name").textContent = "打刻画面（お店のiPad）";
$("kiosk-area").style.display = "block";
document.body.classList.add("kiosk-mode");
$("clock-guide").style.display = "none";
$("personal-clock-extra").style.display = "none";
$("today-shift-card").style.display = "none";
}
$("hello-date").textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${DOW[now.getDay()]}）`;
// 管理者（神坂さん）だけ下部ナビに「管理者」ボタンを出す
$("nav-admin").style.display = ME.role === "admin"? "": "none";
// 管理者はログイン直後・セッション復元時とも「打刻」タブの管理者ホーム
// （ライブ時計・出勤中パネル・打刻ボード）に着地する。提出状況・日別・
// 確定編集・給与一覧・売上入力などの詳細な管理者機能は「管理者」タブに残る。
showView("clock");
await renderClock();
await refreshInboxBadge();
maybeSeedDemoInbox();
}

// ---------- ログイン ----------
function setupLogin() {
const sel = $("login-staff");
if (DEMO) {
$("demo-badge").style.display = "inline-block";
$("field-email").style.display = "none";
$("field-demo-staff").style.display = "block";
sel.innerHTML = ROSTER.map((r, i) => `<option value="demo-${i + 1}">${esc(r[0])}</option>`).join("");
} else {
$("field-email").style.display = "block";
$("field-demo-staff").style.display = "none";
}
$("login-form").addEventListener("submit", async (e) => {
e.preventDefault();
try {
if (DEMO) {
ME = demoDB.staff.find((s) => s.id === sel.value);
localStorage.setItem("karamenya_demo_session", ME.id);
} else {
const { data, error} = await sb.auth.signInWithPassword({
email: $("login-email").value.trim(),
password: $("login-password").value
});
if (error) throw error;
ME = await DB.staffByAuthUser(data.user.id);
if (!ME) { toast("スタッフ登録が見つかりません。神坂さんに連絡してね"); return;}
}
await enterApp();
toast("ログインしました");
} catch (err) {
toast("ログインできませんでした。入力を確認してね");
}
});
$("btn-demo-mode").addEventListener("click", () => {
localStorage.setItem("karamenya_force_demo", "1");
location.reload();
});
}

async function restoreSession() {
if (DEMO) {
const id = localStorage.getItem("karamenya_demo_session");
if (id) { ME = demoDB.staff.find((s) => s.id === id); if (ME) { await enterApp(); return true;}}
return false;
}
const { data} = await sb.auth.getSession();
if (data.session) {
ME = await DB.staffByAuthUser(data.session.user.id);
if (ME) { await enterApp(); return true;}
}
return false;
}

async function doLogout() {
if (DEMO) localStorage.removeItem("karamenya_demo_session");
else await sb.auth.signOut();
location.reload();
}
$("btn-logout").addEventListener("click", doLogout);
$("btn-logout-2").addEventListener("click", doLogout);
$("btn-lock-logout").addEventListener("click", doLogout);

// ---------- 画面遷移 ----------
function showView(name) {
if (IS_KIOSK()) name = "clock"; // 打刻専用モードでは打刻画面だけ
if (name === "admin" && (!ME || ME.role!== "admin")) name = "clock"; // 管理者画面は admin のみ
document.querySelectorAll("#app-shell .view").forEach((v) => v.classList.remove("active"));
$("view-" + name).classList.add("active");
document.querySelectorAll("#bottom-nav button").forEach((b) =>
b.classList.toggle("active", b.dataset.view === name));
// 管理者ホーム（admin の打刻タブ）表示中だけ、ページ全体をダークテーマにする
document.body.classList.toggle("admin-dark", name === "clock" && IS_ADMIN());
if (name === "clock") renderClock();
if (name === "request") renderRequest();
if (name === "schedule") renderSchedule();
if (name === "pay") renderPay();
if (name === "inbox") renderInbox();
if (name === "settings") renderSettings();
if (name === "admin") renderAdmin();
window.scrollTo(0, 0);
}
document.querySelectorAll("#bottom-nav button").forEach((b) =>
b.addEventListener("click", () => showView(b.dataset.view)));

// ============================================================
// 設定（パスワード変更）
// ============================================================
async function renderSettings() {
$("set-name").textContent = ME? ME.name: "";
if (ME) {
$("pf-shop").textContent = ME.shop_name || "―";
$("pf-hire").textContent = ME.hire_date || "―";
$("pf-pos").textContent = ME.position_title || "―";
$("pf-emp").textContent = ME.employment_type || "―";
$("pf-gender").value = ME.gender || "";
$("pf-birth").value = ME.birth_date || "";
$("pf-address").value = ME.address || "";
$("pf-note").value = ME.profile_note || "";
}
if (DEMO) {
$("set-email").textContent = "デモモード（ログインIDなし）";
$("pw-demo-note").style.display = "block";
$("pw-new").disabled = true;
$("pw-confirm").disabled = true;
$("btn-change-pw").disabled = true;
} else {
$("pw-demo-note").style.display = "none";
try {
const { data } = await sb.auth.getUser();
$("set-email").textContent = (data && data.user && data.user.email) || "";
} catch (e) { $("set-email").textContent = ""; }
}
refreshLockUI();
}

$("btn-save-profile").addEventListener("click", async () => {
const msg = $("pf-msg");
const setMsg = (t, ok) => { msg.textContent = t; msg.className = "form-msg " + (ok? "ok": "err"); };
if (DEMO) { setMsg("デモモードでは保存できません", false); return; }
if (!ME) return;
const fields = {
gender: $("pf-gender").value || null,
birth_date: $("pf-birth").value || null,
address: $("pf-address").value.trim() || null,
profile_note: $("pf-note").value.trim() || null
};
$("btn-save-profile").disabled = true;
const { error } = await sb.from("staff").update(fields).eq("id", ME.id);
$("btn-save-profile").disabled = false;
if (error) { setMsg("保存できませんでした。もう一度試してください", false); return; }
Object.assign(ME, fields);
setMsg("プロフィールを保存しました", true);
});

$("btn-change-pw").addEventListener("click", async () => {
const msg = $("pw-msg");
const setMsg = (t, ok) => { msg.textContent = t; msg.className = "form-msg " + (ok? "ok": "err"); };
if (DEMO) { setMsg("デモモードでは変更できません", false); return; }
const p1 = $("pw-new").value, p2 = $("pw-confirm").value;
if (p1.length < 6) { setMsg("パスワードは6文字以上にしてください", false); return; }
if (p1!== p2) { setMsg("2つのパスワードが一致しません。もう一度確認してください", false); return; }
$("btn-change-pw").disabled = true;
const { error } = await sb.auth.updateUser({ password: p1 });
$("btn-change-pw").disabled = false;
if (error) { setMsg("変更できませんでした。少し時間をおいて、もう一度試してください", false); return; }
$("pw-new").value = ""; $("pw-confirm").value = "";
setMsg("パスワードを変更しました。次にログインするときから、新しいパスワードを使ってください", true);
toast("パスワードを変更しました");
});

// ============================================================
// アプリのロック（Face ID・指紋／PIN）
// ------------------------------------------------------------
// ・設定は端末ごと・スタッフごとに localStorage に保存する。
// ・PIN は平文保存せず、ソルト付き SHA-256 ハッシュで保存する。
// ・生体認証は WebAuthn のプラットフォーム認証を使う。サーバー側の
//   署名検証は行わない「アプリ側のゲート」であり、Supabase の
//   セッション自体は保持される（解除＝この端末で中身を見せる許可）。
// ・打刻用iPad（role=kiosk）にはロックを適用しない。
// ============================================================
let lockUnlocked = false;   // この起動で解除済みか
let lockOverlayOpen = false; // ロック画面を表示中か
let lockHiddenAt = 0;        // バックグラウンドに入った時刻
const LOCK_RELOCK_MS = 60 * 1000; // バックグラウンドから1分以上で再ロック

const lockKey = (part) => `karamenya_lock_${ME? ME.id: "anon"}_${part}`;
const isLockEnabled = () => localStorage.getItem(lockKey("enabled")) === "1";
function setLockEnabled(on) {
if (on) localStorage.setItem(lockKey("enabled"), "1");
else localStorage.removeItem(lockKey("enabled"));
}
function getPinRecord() {
try {
const raw = localStorage.getItem(lockKey("pin"));
return raw? JSON.parse(raw): null;
} catch (e) { return null; }
}
const getCredId = () => localStorage.getItem(lockKey("cred"));

// ---------- バイナリ <-> Base64 ----------
const b64enc = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const b64dec = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64urlEnc = (buf) => b64enc(new Uint8Array(buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlDec = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return b64dec(s); };

// ---------- PIN（ソルト付き SHA-256） ----------
async function hashPin(pin, saltBytes) {
const pinBytes = new TextEncoder().encode(pin);
const buf = new Uint8Array(saltBytes.length + pinBytes.length);
buf.set(saltBytes, 0); buf.set(pinBytes, saltBytes.length);
return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}
async function savePin(pin) {
const salt = crypto.getRandomValues(new Uint8Array(16));
const hash = await hashPin(pin, salt);
localStorage.setItem(lockKey("pin"), JSON.stringify({ salt: b64enc(salt), hash: b64enc(hash) }));
}
async function verifyPin(pin) {
const rec = getPinRecord();
if (!rec) return false;
const hash = await hashPin(pin, b64dec(rec.salt));
return b64enc(hash) === rec.hash;
}

// ---------- WebAuthn（プラットフォーム認証：Face ID・指紋） ----------
const waSupported = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create && navigator.credentials.get);
async function waRegister() {
const cred = await navigator.credentials.create({ publicKey: {
challenge: crypto.getRandomValues(new Uint8Array(32)),
rp: { name: "辛麺屋 物語 スタッフアプリ", id: location.hostname },
user: { id: new TextEncoder().encode(ME.id), name: ME.name, displayName: ME.name },
pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
timeout: 60000
}});
if (!cred) throw new Error("credential not created");
return b64urlEnc(cred.rawId);
}
async function waAuthenticate(credIdB64) {
const res = await navigator.credentials.get({ publicKey: {
challenge: crypto.getRandomValues(new Uint8Array(32)),
rpId: location.hostname,
allowCredentials: [{ type: "public-key", id: b64urlDec(credIdB64) }],
userVerification: "required",
timeout: 60000
}});
if (!res) throw new Error("assertion not obtained");
return true;
}

// ---------- 設定画面：ロックまわり ----------
function refreshLockUI() {
const hasPin =!!getPinRecord();
const enabled = isLockEnabled();
$("lock-toggle").checked = enabled;
$("lock-setup").style.display = "none";
$("lock-manage").style.display = hasPin? "block": "none";
const bioBtn = $("btn-bio-register");
const bioOk = waSupported();
bioBtn.style.display = bioOk? "block": "none";
if (bioOk) {
const registered =!!getCredId();
$("bio-status").textContent = registered
? "生体認証（Face ID・指紋）：登録済みです。ロック解除に使えます"
: "生体認証（Face ID・指紋）：まだ登録していません";
bioBtn.textContent = registered? "Face ID・指紋を登録し直す": "Face ID・指紋を登録する";
} else {
$("bio-status").textContent = "この端末・ブラウザでは生体認証が使えません（PINのみ）";
}
}
$("lock-toggle").addEventListener("change", (e) => {
if (e.target.checked) {
if (getPinRecord()) {
setLockEnabled(true);
toast("アプリのロックをONにしました");
refreshLockUI();
} else {
// PIN がまだ無い場合は、まず PIN を決めてもらう
$("lock-manage").style.display = "none";
$("lock-setup").style.display = "block";
$("pin-msg").textContent = "まず、解除に使うPIN（数字4桁）を決めてください";
$("pin-msg").className = "form-msg";
}
} else {
setLockEnabled(false);
toast("アプリのロックをOFFにしました");
refreshLockUI();
}
});
$("btn-change-pin").addEventListener("click", () => {
$("pin-new").value = ""; $("pin-confirm").value = "";
$("pin-msg").textContent = "";
$("pin-msg").className = "form-msg";
$("lock-setup").style.display = "block";
});
$("btn-save-pin").addEventListener("click", async () => {
const msg = $("pin-msg");
const setMsg = (t, ok) => { msg.textContent = t; msg.className = "form-msg " + (ok? "ok": "err"); };
const p1 = $("pin-new").value.trim(), p2 = $("pin-confirm").value.trim();
if (!/^\d{4}$/.test(p1)) { setMsg("PINは数字4桁で入力してください", false); return; }
if (p1!== p2) { setMsg("2つのPINが一致しません。もう一度確認してください", false); return; }
await savePin(p1);
$("pin-new").value = ""; $("pin-confirm").value = "";
// トグルの状態に合わせて有効化（PIN変更だけのときはON/OFFを変えない）
setLockEnabled($("lock-toggle").checked);
toast($("lock-toggle").checked? "PINを決めました。ロックがONになりました": "PINを変更しました");
refreshLockUI();
});
$("btn-bio-register").addEventListener("click", async () => {
if (!waSupported()) return;
try {
const credId = await waRegister();
localStorage.setItem(lockKey("cred"), credId);
toast("生体認証を登録しました");
} catch (e) {
toast("登録できませんでした。もう一度試してください");
}
refreshLockUI();
});

// ---------- ロック画面 ----------
let pinBuffer = "";
let unlockResolver = null;
function renderPinDots() {
document.querySelectorAll("#pin-dots span").forEach((s, i) =>
s.classList.toggle("filled", i < pinBuffer.length));
}
function requireUnlock() {
return new Promise((resolve) => {
unlockResolver = resolve;
lockOverlayOpen = true;
pinBuffer = ""; renderPinDots();
$("lock-name").textContent = ME? `${ME.name}さん、ロック中です`: "ロック中です";
$("lock-msg").textContent = "PIN（数字4桁）を入力してください";
$("lock-msg").className = "lock-msg";
const canBio = waSupported() &&!!getCredId();
$("btn-lock-bio").style.display = canBio? "block": "none";
$("lock-screen").style.display = "block";
document.body.style.overflow = "hidden";
// 開いたら一度だけ生体認証を試す（失敗したらPIN入力に切り替わる）
if (canBio) tryBioUnlock();
});
}
function finishUnlock() {
lockUnlocked = true;
lockOverlayOpen = false;
pinBuffer = ""; renderPinDots();
$("lock-screen").style.display = "none";
document.body.style.overflow = "";
toast("ロックを解除しました");
if (unlockResolver) { const r = unlockResolver; unlockResolver = null; r(); }
}
async function tryBioUnlock() {
try {
await waAuthenticate(getCredId());
finishUnlock();
} catch (e) {
$("lock-msg").textContent = "生体認証ができませんでした。PINを入力してください";
}
}
$("btn-lock-bio").addEventListener("click", tryBioUnlock);
document.querySelectorAll("#pin-pad button").forEach((b) =>
b.addEventListener("click", async () => {
if (!lockOverlayOpen) return;
const k = b.dataset.pin;
if (k === "del") { pinBuffer = pinBuffer.slice(0, -1); renderPinDots(); return; }
if (pinBuffer.length >= 4) return;
pinBuffer += k;
renderPinDots();
if (pinBuffer.length === 4) {
const entered = pinBuffer;
if (await verifyPin(entered)) {
finishUnlock();
} else {
if (navigator.vibrate) navigator.vibrate(200);
$("lock-msg").textContent = "PINが違います。もう一度入力してください";
$("lock-msg").className = "lock-msg err";
pinBuffer = ""; renderPinDots();
}
}
}));
// バックグラウンドに一定時間いたら再ロックする
document.addEventListener("visibilitychange", () => {
if (document.hidden) { lockHiddenAt = Date.now(); return; }
if (!ME || IS_KIOSK() || lockOverlayOpen || !isLockEnabled()) return;
if ($("app-shell").style.display === "none") return;
if (lockHiddenAt && Date.now() - lockHiddenAt >= LOCK_RELOCK_MS) {
lockUnlocked = false;
requireUnlock();
}
lockHiddenAt = 0;
});

// ============================================================
// 打刻
// ============================================================
function myToday(records) {
return records.find((a) => a.staff_id === ME.id);
}
function currentStatus(rec) {
if (!rec ||!rec.clock_in) return "off";
if (rec.clock_out) return "done";
const openBreak = (rec.breaks || []).find((b) =>!b.end);
return openBreak? "break": "working";
}
function todayLines(rec) {
if (!rec) return [];
const t = (iso) => { const d = new Date(iso); return `${d.getHours()}:${pad(d.getMinutes())}`;};
const lines = [];
if (rec.clock_in) lines.push(`出勤 ${t(rec.clock_in)}`);
(rec.breaks || []).forEach((b) => lines.push(`休憩 ${t(b.start)}〜${b.end? t(b.end): "…"}`));
if (rec.clock_out) lines.push(`退勤 ${t(rec.clock_out)}`);
return lines;
}
async function renderClock() {
const today = fmtDate(new Date());
const records = await DB.todayAttendance(today);
// 管理者（admin）は「打刻」タブが管理者ホームになる（通常スタッフ向けの
// カード群は出さず、時計・出勤中パネル・打刻ボードを出す）。
if (IS_ADMIN()) { await renderAdminHome(records); return;}
// 出勤中のみんな（共通表示）。社員も出勤タップした人は出勤中として出す。
const working = records.filter((r) => currentStatus(r) === "working" || currentStatus(r) === "break");
$("now-working").innerHTML = working
.map((r) => `<span class="working-chip${currentStatus(r) === "break"? " break": ""}">${esc(staffName(r.staff_id))}${currentStatus(r) === "break"? "（休憩中）": ""}</span>`)
.join("");
$("now-working-empty").style.display = working.length? "none": "block";

if (IS_KIOSK()) { renderKiosk(records); return;}

renderTodayShift();
renderQuotaCard();
// 社員（月給制）は出勤タップのみのため、案内文を社員向けに切り替える
if (ME.pay_type === "salary") {
$("clock-guide-text").innerHTML = "社員の方は、辛麺屋に出勤したらお店のiPadで「出勤」だけ押してください（退勤は不要です）。<br>押した日数が、そのまま出勤手当に反映されます。";
}
const rec = myToday(records);
const lines = todayLines(rec);
$("today-records").innerHTML = lines.length? lines.map(esc).join("<br>"): "まだ記録がありません";
renderCorrections();
}

// ---------- 今日のあなたのシフト（ホーム先頭） ----------
// 管理者画面と同じく、ホームを開いてすぐ自分の今日のシフトが見えるようにする。
// データ取得は既存の DB.listShifts（今月分）を使う。
async function renderTodayShift() {
const body = $("today-shift-body");
if (!body || !ME) return;
const now = new Date();
const today = fmtDate(now);
try {
const shifts = await DB.listShifts(now.getFullYear(), now.getMonth());
const mine = shifts
.filter((s) => s.staff_id === ME.id && s.date === today)
.sort((a, b) => ((a.start_time || BAND[a.band].start) < (b.start_time || BAND[b.band].start)? -1: 1));
if (!mine.length) {
body.className = "hint";
body.textContent = "今日はシフトが入っていません。ゆっくり休んでね";
return;
}
body.className = "";
body.innerHTML = mine.map((s) => {
const st = s.start_time || BAND[s.band].start;
const en = s.end_time || BAND[s.band].end;
return `<div class="today-shift-row"><span class="tag solid ${s.band}">${BAND[s.band].label}</span><span class="today-shift-time">${st}–${en}</span></div>`;
}).join("");
} catch (e) {
body.className = "hint";
body.textContent = "今日のシフトを読み込めませんでした";
}
}

// ---------- ノルマ進捗カード（対象スタッフのみ） ----------
async function renderQuotaCard() {
const card = $("quota-card");
if (!ME ||!ME.quota_wage) { card.style.display = "none"; return;}
const now = new Date();
const threshold = ME.quota_threshold || 3000000;
const sales = await DB.getMonthlySales(now.getFullYear(), now.getMonth());
card.style.display = "block";
if (sales == null) {
$("quota-body").innerHTML =
`<div class="quota-sales">今月の売上はまだ集計されていません</div>` +
`<div class="hint">ノルマは ${fmtYen(threshold)} です。売上が集計されると進捗が出ます。</div>`;
return;
}
const achieved = sales > threshold;
const pct = Math.min(100, Math.floor((sales / threshold) * 100));
$("quota-body").innerHTML = achieved
? `<div class="quota-done">ノルマ達成！今月は時給 ${fmtYen(ME.quota_wage)}（深夜手当込み）</div>
<div class="quota-sales">今月の売上 ${fmtYen(sales)}</div>
<div class="quota-bar"><div class="quota-fill done" style="width:100%"></div></div>`
: `<div class="quota-sales">今月の売上 ${fmtYen(sales)}</div>
<div class="quota-rest">ノルマ ${fmtYen(threshold)} まで あと ${fmtYen(threshold - sales)}</div>
<div class="quota-bar"><div class="quota-fill" style="width:${pct}%"></div></div>
<div class="hint">${fmtYen(threshold)} を超えたら、今月は時給 ${fmtYen(ME.quota_wage)}（深夜手当込み）になります</div>`;
}

// ---------- 打刻（お店のiPad・キオスク専用） ----------
let kioskTargetId = null; // iPadで選択中のスタッフ
function renderKiosk(records) {
const grid = $("kiosk-grid");
grid.innerHTML = "";
const stateLabel = { off: "未出勤", working: "出勤中", break: "休憩中", done: "退勤ずみ"};
// 代表（admin）は打刻不要のため名前一覧に出さない。社員（月給制）は
// 出勤タップのみ使うため一覧に出す（2026-11-28変更）。
STAFF.filter((s) => s.role !== "admin").forEach((s) => {
const rec = records.find((a) => a.staff_id === s.id);
const st = currentStatus(rec);
const btn = document.createElement("button");
btn.className = "kiosk-name is-" + st + (s.id === kioskTargetId? " selected": "");
btn.innerHTML = `<span class="k-name">${esc(s.name)}</span><span class="k-state">${stateLabel[st]}</span>`;
btn.addEventListener("click", () => { kioskTargetId = s.id; renderClock();});
grid.appendChild(btn);
});
const target = STAFF.find((s) => s.id === kioskTargetId);
const rec = records.find((a) => a.staff_id === kioskTargetId);
const st = currentStatus(rec);
const targetIsSalary =!!target && target.pay_type === "salary";
$("kiosk-status").textContent =!target? "まず名前を選んでください":
targetIsSalary && st === "working"? `${target.name}さん：出勤ずみです（退勤は不要です）`:
{ off: `${target.name}さん：まだ出勤していません`,
working: `${target.name}さん：出勤中です`,
break: `${target.name}さん：休憩中です`,
done: `${target.name}さん：今日は退勤ずみです`}[st];
$("k-btn-in").disabled =!(target && st === "off");
$("k-btn-break-start").disabled =!(target &&!targetIsSalary && st === "working");
$("k-btn-break-end").disabled =!(target &&!targetIsSalary && st === "break");
$("k-btn-out").disabled =!(target &&!targetIsSalary && (st === "working" || st === "break"));
const lines = todayLines(rec);
$("kiosk-today").innerHTML = lines.length? lines.map(esc).join("<br>"): "";
}
async function getOrCreateFor(staffId) {
const today = fmtDate(new Date());
const records = await DB.todayAttendance(today);
let rec = records.find((a) => a.staff_id === staffId);
if (!rec) {
rec = { staff_id: staffId, date: today, clock_in: null, clock_out: null, breaks: []};
if (DEMO) rec.id = uid();
}
return rec;
}
async function kioskAct(kind) {
if (!kioskTargetId) { toast("まず名前を選んでね"); return;}
const name = staffName(kioskTargetId);
if (kind === "out" &&!confirm(`${name}さん、退勤しますか？`)) return;
const rec = await getOrCreateFor(kioskTargetId);
const nowIso = new Date().toISOString();
if (kind === "in") rec.clock_in = nowIso;
if (kind === "break_start") { rec.breaks = rec.breaks || []; rec.breaks.push({ start: nowIso, end: null});}
if (kind === "break_end") { const b = (rec.breaks || []).find((x) =>!x.end); if (b) b.end = nowIso;}
if (kind === "out") {
const b = (rec.breaks || []).find((x) =>!x.end); if (b) b.end = nowIso;
rec.clock_out = nowIso;
}
await DB.upsertAttendance(rec);
toast({ in: `${name}さん、出勤しました`, break_start: `${name}さん、休憩に入りました`,
break_end: `${name}さん、休憩おわり`, out: `${name}さん、退勤しました。おつかれさまでした！`}[kind]);
renderClock();
}
$("k-btn-in").addEventListener("click", () => kioskAct("in"));
$("k-btn-break-start").addEventListener("click", () => kioskAct("break_start"));
$("k-btn-break-end").addEventListener("click", () => kioskAct("break_end"));
$("k-btn-out").addEventListener("click", () => kioskAct("out"));

// ============================================================
// 管理者ホーム（role='admin' の「打刻」タブ）
// ------------------------------------------------------------
// ・admin がログインした直後・セッション復元時の着地画面。試作側の
//   管理者ホームと同じ構成にする：
//     日付＋大きなライブ時計／時間帯で変わる挨拶／
//     「勤務中 ○名 ／ 本日のシフト ○件」／
//     「今、出勤中 ○名」パネル（出勤中一覧＋未出勤リスト）／
//     打刻ボード（名前タップで選択し、そのスタッフとして打刻）。
// ・詳細な管理者機能（提出状況・確定編集・給与一覧など）は従来どおり
//   下部ナビの「管理者」タブ（view-admin）に残っている。
// ・社員（月給制）は出勤タップのみ（2026-11-28変更）のため、ボード・
//   出勤中・未出勤のいずれにも出す（kiosk のボードと同じ扱い）。
// ・本番で admin が他人の打刻レコードを「新規作成」するには RLS の
//   attendance_insert_admin ポリシーが必要（schema.sql／
//   apply_attendance_admin_policy.py）。既存レコードの更新は
//   attendance_update_admin（admin/subadmin 可）で従来から可能。
// ============================================================
function adminGreetingText(h) {
if (h >= 22 || h < 5) return ["おつかれさまです！", "深夜もありがとうございます"];
if (h < 11) return ["おはようございます！", "今日もよろしくお願いします"];
if (h < 15) return ["おつかれさまです！", "ランチタイムもありがとうございます"];
if (h < 18) return ["おつかれさまです！", "午後もありがとうございます"];
return ["おつかれさまです！", "夜の部もありがとうございます"];
}
let adminClockTimer = null;
function tickAdminClock() {
const now = new Date();
const c = $("ah-clock");
if (c) c.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
const d = $("ah-date");
if (d) d.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${DOW[now.getDay()]}）`;
const g = $("ah-greeting");
if (g) g.innerHTML = adminGreetingText(now.getHours()).map(esc).join("<br>");
}
function startAdminClock() {
tickAdminClock();
if (!adminClockTimer) adminClockTimer = setInterval(tickAdminClock, 1000);
}

async function renderAdminHome(records) {
// 管理者ホームを表示し、通常スタッフ向けのカード群を隠す
document.body.classList.add("admin-dark"); // 管理者ホーム表示中はダークテーマ
$("admin-home").style.display = "block";
$("today-shift-card").style.display = "none";
$("quota-card").style.display = "none";
$("now-working-card").style.display = "none";
$("clock-guide").style.display = "none";
$("personal-clock-extra").style.display = "none";
startAdminClock();
const now = new Date();
const today = fmtDate(now);
const shifts = await DB.listShifts(now.getFullYear(), now.getMonth());
const todayShifts = shifts.filter((s) => s.date === today);
const working = records.filter((r) => currentStatus(r) === "working" || currentStatus(r) === "break");
$("ah-summary").innerHTML =
`勤務中 <b>${working.length}名</b> / 本日のシフト ${todayShifts.length}件`;
$("ah-working-count").textContent = `${working.length}名`;
$("ah-working").innerHTML = working
.map((r) => `<span class="working-chip${currentStatus(r) === "break"? " break": ""}">${esc(staffName(r.staff_id))}${currentStatus(r) === "break"? "（休憩中）": ""}</span>`)
.join("");
$("ah-working-empty").style.display = working.length? "none": "block";
// 本日シフトあり・まだ未出勤：確定シフトと打刻から作る。
// 時刻はその人の最も早い開始時刻。
const toMin = (t) => { const [h, mm] = t.split(":").map(Number); return h * 60 + mm;};
const recByStaff = new Map(records.map((r) => [r.staff_id, r]));
const byStaff = new Map();
todayShifts.forEach((s) => {
if (!byStaff.has(s.staff_id)) byStaff.set(s.staff_id, []);
byStaff.get(s.staff_id).push(s);
});
const notYet = [];
byStaff.forEach((list, sid) => {
const rec = recByStaff.get(sid);
if (rec && rec.clock_in) return; // 出勤済み（勤務中・休憩中・退勤ずみ）
const earliest = list.map((s) => s.start_time || BAND[s.band].start)
.sort((a, b) => toMin(a) - toMin(b))[0];
const st = STAFF.find((s) => s.id === sid);
notYet.push({ name: staffName(sid), start: earliest, min: toMin(earliest),
order: st && st.sort_order != null? st.sort_order: 99});
});
notYet.sort((a, b) => a.min - b.min || a.order - b.order);
$("ah-notyet").innerHTML = notYet.length
? `<div class="notyet-title">本日シフトあり・まだ未出勤</div>` +
notYet.map((x) => `<div class="notyet-row"><span class="notyet-time">${x.start}〜</span><span class="notyet-name">${esc(x.name)}</span></div>`).join("")
: "";
renderAdminBoard(records);
}

// ---------- 管理者ホームの打刻ボード ----------
let adminTargetId = null; // 管理者ホームで選択中のスタッフ
function renderAdminBoard(records) {
const grid = $("ah-grid");
grid.innerHTML = "";
const stateLabel = { off: "まだ出勤していません", working: "出勤中", break: "休憩中", done: "退勤ずみ"};
// 社員（月給制）も出勤タップのみ使うため名前一覧に出す（kiosk と同じ）。
// 代表（admin）は打刻不要のため出さない。
STAFF.filter((s) => s.role!== "admin").forEach((s) => {
const rec = records.find((a) => a.staff_id === s.id);
const st = currentStatus(rec);
const btn = document.createElement("button");
btn.className = "kiosk-name is-" + st + (s.id === adminTargetId? " selected": "");
btn.innerHTML = `<span class="k-name">${esc(s.name)}</span><span class="k-state">${stateLabel[st]}</span>`;
btn.addEventListener("click", () => { adminTargetId = s.id; renderClock();});
grid.appendChild(btn);
});
const target = STAFF.find((s) => s.id === adminTargetId);
const rec = records.find((a) => a.staff_id === adminTargetId);
const st = currentStatus(rec);
const ahTargetIsSalary =!!target && target.pay_type === "salary";
$("ah-status").textContent =!target? "まず名前を選んでください":
ahTargetIsSalary && st === "working"? `${target.name}さん：出勤ずみです（退勤は不要です）`:
{ off: `${target.name}さん：まだ出勤していません`,
working: `${target.name}さん：出勤中です`,
break: `${target.name}さん：休憩中です`,
done: `${target.name}さん：今日は退勤ずみです`}[st];
$("ah-btn-in").disabled =!(target && st === "off");
$("ah-btn-break-start").disabled =!(target &&!ahTargetIsSalary && st === "working");
$("ah-btn-break-end").disabled =!(target &&!ahTargetIsSalary && st === "break");
$("ah-btn-out").disabled =!(target &&!ahTargetIsSalary && (st === "working" || st === "break"));
const lines = todayLines(rec);
$("ah-today").innerHTML = lines.length? lines.map(esc).join("<br>"): "";
}
async function adminBoardAct(kind) {
if (!adminTargetId) { toast("まず名前を選んでね"); return;}
const name = staffName(adminTargetId);
if (kind === "out" &&!confirm(`${name}さん、退勤しますか？`)) return;
const rec = await getOrCreateFor(adminTargetId);
const nowIso = new Date().toISOString();
if (kind === "in") rec.clock_in = nowIso;
if (kind === "break_start") { rec.breaks = rec.breaks || []; rec.breaks.push({ start: nowIso, end: null});}
if (kind === "break_end") { const b = (rec.breaks || []).find((x) =>!x.end); if (b) b.end = nowIso;}
if (kind === "out") {
const b = (rec.breaks || []).find((x) =>!x.end); if (b) b.end = nowIso;
rec.clock_out = nowIso;
}
await DB.upsertAttendance(rec);
toast({ in: `${name}さん、出勤しました`, break_start: `${name}さん、休憩に入りました`,
break_end: `${name}さん、休憩おわり`, out: `${name}さん、退勤しました。おつかれさまでした！`}[kind]);
renderClock();
}
$("ah-btn-in").addEventListener("click", () => adminBoardAct("in"));
$("ah-btn-break-start").addEventListener("click", () => adminBoardAct("break_start"));
$("ah-btn-break-end").addEventListener("click", () => adminBoardAct("break_end"));
$("ah-btn-out").addEventListener("click", () => adminBoardAct("out"));


// ============================================================
// 打刻の訂正依頼
// ============================================================
const FIELD_LABEL = { clock_in: "出勤", clock_out: "退勤", break_start: "休憩開始", break_end: "休憩終了" };
function applyCorrectionToAttendance(cr) {
// デモ用：サーバー側（Edge Function）と同じ反映ロジック
const att = demoDB.attendance.find((a) => a.id === cr.attendance_id);
if (!att) return;
if (cr.field === "clock_in") { att.clock_in = cr.requested_at; att.date = cr.requested_at.slice(0, 10); }
else if (cr.field === "clock_out") { att.clock_out = cr.requested_at; }
else {
const idx = cr.break_index ?? 0;
if (att.breaks && att.breaks[idx]) {
if (cr.field === "break_start") att.breaks[idx].start = cr.requested_at;
else att.breaks[idx].end = cr.requested_at;
}
}
}
function collectStamps(records) {
const out = [];
const t = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${pad(d.getMinutes())}`; };
records.forEach((rec) => {
if (rec.clock_in) out.push({ attendanceId: rec.id, field: "clock_in", breakIndex: null, iso: rec.clock_in, label: `${t(rec.clock_in)} 出勤` });
(rec.breaks || []).forEach((b, i) => {
if (b.start) out.push({ attendanceId: rec.id, field: "break_start", breakIndex: i, iso: b.start, label: `${t(b.start)} 休憩開始` });
if (b.end) out.push({ attendanceId: rec.id, field: "break_end", breakIndex: i, iso: b.end, label: `${t(b.end)} 休憩終了` });
});
if (rec.clock_out) out.push({ attendanceId: rec.id, field: "clock_out", breakIndex: null, iso: rec.clock_out, label: `${t(rec.clock_out)} 退勤` });
});
return out.sort((a, b) => (a.iso < b.iso ? 1 : -1));
}
let corrStamps = [];
async function renderCorrections() {
const from = fmtDate(new Date(Date.now() - 14 * 86400000));
const records = await DB.myAttendanceSince(ME.id, from);
corrStamps = collectStamps(records);
const sel = $("corr-stamp");
sel.innerHTML = corrStamps.length
? corrStamps.map((s, i) => `<option value="${i}">${esc(s.label)}</option>`).join("")
: `<option value="">（直近2週間に打刻がありません）</option>`;
prefillCorrectionInputs();
const mine = await DB.myCorrectionRequests(ME.id);
const stLabel = { pending: "【確認中】", approved: "【承認されました】", rejected: "【却下されました】" };
$("my-corrections").innerHTML = mine.length
? mine.map((c) => {
const d = new Date(c.requested_at);
return `${stLabel[c.status] || ""} ${FIELD_LABEL[c.field]} → ${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${pad(d.getMinutes())}`;
}).map(esc).join("<br>")
: "まだ依頼はありません";
}
function prefillCorrectionInputs() {
const s = corrStamps[Number($("corr-stamp").value)];
if (!s) return;
const d = new Date(s.iso);
$("corr-date").value = fmtDate(d);
$("corr-time").value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
$("corr-stamp").addEventListener("change", prefillCorrectionInputs);
$("btn-submit-correction").addEventListener("click", async () => {
const s = corrStamps[Number($("corr-stamp").value)];
if (!s) { toast("間違えた打刻を選んでね"); return; }
const date = $("corr-date").value, time = $("corr-time").value;
if (!date || !time) { toast("正しい日付と時刻を入れてね"); return; }
const corrErr = await DB.addCorrectionRequest({
id: uid(), staff_id: ME.id, attendance_id: s.attendanceId,
field: s.field, break_index: s.breakIndex,
requested_at: new Date(`${date}T${time}:00`).toISOString(),
reason: $("corr-reason").value.trim() || null,
status: "pending", created_at: new Date().toISOString()
});
if (corrErr) { toast("保存できませんでした。もう一度試してね"); return;}
$("corr-reason").value = "";
toast("訂正をお願いしました。結果はお知らせで届きます");
renderCorrections(); refreshInboxBadge();
});
// 管理者用：お知らせ画面に承認待ちの訂正依頼を出す
async function renderAdminCorrections() {
const card = $("admin-corrections-card");
if (!ME || (ME.role !== "admin" && ME.role !== "subadmin")) { card.style.display = "none"; return; }
const list = await DB.pendingCorrectionRequests();
card.style.display = "block";
const box = $("pending-corrections");
if (!list.length) { box.innerHTML = "新しい依頼はありません"; return; }
box.innerHTML = "";
list.forEach((c) => {
const d = new Date(c.requested_at);
const div = document.createElement("div");
div.className = "notice unread";
div.innerHTML =
`<div class="n-title">${esc(staffName(c.staff_id))}さん：${FIELD_LABEL[c.field]}の訂正</div>` +
`<div class="n-body">正しい日時：${d.getMonth() + 1}月${d.getDate()}日（${DOW[d.getDay()]}） ${d.getHours()}:${pad(d.getMinutes())}` +
(c.reason ? `<br>理由：「${esc(c.reason)}」` : "") + `</div>` +
`<div class="n-actions">
<button class="btn-accept" data-decide="approved">承認して直す</button>
<button class="btn-decline" data-decide="rejected">却下する</button></div>`;
div.querySelectorAll("[data-decide]").forEach((btn) =>
btn.addEventListener("click", async () => {
await DB.decideCorrectionRequest(c.id, btn.dataset.decide);
toast(btn.dataset.decide === "approved" ? "承認して訂正しました" : "却下しました");
renderAdminCorrections(); renderClock();
}));
box.appendChild(div);
});
}

// ============================================================
// シフト希望提出
// ============================================================
const reqState = { y: 0, m: 0, selected: new Set(), band: null};
{
const t = new Date(); t.setMonth(t.getMonth() + 1);
reqState.y = t.getFullYear(); reqState.m = t.getMonth();
}
function buildCalendar(el, y, m, cellFn, onTap) {
const first = new Date(y, m, 1);
const days = new Date(y, m + 1, 0).getDate();
let html = DOW.map((d, i) => `<div class="cal-dow ${i === 0? "sun": i === 6? "sat": ""}">${d}</div>`).join("");
for (let i = 0; i < first.getDay(); i++) html += "<div></div>";
for (let d = 1; d <= days; d++) {
const date = new Date(y, m, d);
html += cellFn(date, d);
}
el.innerHTML = html;
el.querySelectorAll("[data-date]").forEach((c) =>
c.addEventListener("click", () => onTap(c.dataset.date)));
}
async function renderRequest() {
const { y, m} = reqState;
$("req-month-title").textContent = `${y}年${m + 1}月`;
$("request-title").textContent = `${y}年${m + 1}月のシフト希望`;
const myReqs = await DB.myRequests(ME.id, y, m);
const reqMap = new Map(myReqs.map((r) => [r.date + "|" + r.band, r]));
const reqDates = new Set(myReqs.map((r) => r.date));

// 締切バナー：対象月（来月）で未提出なら表示
const now = new Date();
const isTargetMonth = y === (now.getMonth() === 11? now.getFullYear() + 1: now.getFullYear())
&& m === (now.getMonth() + 1) % 12;
const banner = $("deadline-banner");
if (isTargetMonth && myReqs.length === 0) {
banner.className = "banner warn show";
banner.textContent = now.getDate() <= CFG.SHOP.requestDeadlineDay
? `${m + 1}月のシフト希望がまだ出ていません。締切は今月${CFG.SHOP.requestDeadlineDay}日だよ！`
: `${m + 1}月のシフト希望がまだ出ていません。締切（${CFG.SHOP.requestDeadlineDay}日）を過ぎています。急いで出してね！`;
} else if (isTargetMonth) {
banner.className = "banner info show";
banner.textContent = `${m + 1}月のシフト希望は提出ずみです。変更したい日はタップで取り消してから出し直してね。`;
} else {
banner.className = "banner";
}

buildCalendar($("req-calendar"), y, m, (date, d) => {
const ds = fmtDate(date);
const closed = date.getDay() === CFG.SHOP.closedWeekday;
const tags = ["lunch", "dinner", "late"]
.filter((b) => reqMap.has(ds + "|" + b))
.map((b) => `<span class="tag ${b}">${BAND[b].label}</span>`).join("");
const sel = reqState.selected.has(ds)? " selected": "";
const dowCls = date.getDay() === 0? " sun": date.getDay() === 6? " sat": "";
return `<button class="cal-day${closed? " closed": ""}${sel}${dowCls}" data-date="${ds}" ${closed? "disabled": ""}>
<span class="dnum">${d}</span>${closed? '<span class="tag">定休日</span>': tags}</button>`;
}, (ds) => {
if (reqState.selected.has(ds)) reqState.selected.delete(ds);
else reqState.selected.add(ds);
updateSelectedCount();
renderRequestCalendarOnly();
});
updateSelectedCount();

$("my-requests").innerHTML = myReqs.length
? myReqs.sort((a, b) => (a.date < b.date? -1: 1))
.map((r) => `${r.date.slice(5).replace("-", "/")}（${DOW[new Date(r.date).getDay()]}）${BAND[r.band].label} ${BAND[r.band].time}　${r.status === "rejected"? "": r.status === "approved"? "": ""}`)
.map(esc).join("<br>")
: "まだ提出がありません";
// 内部関数：カレンダーだけ再描画（選択状態の反映）
function renderRequestCalendarOnly() { renderRequest();}
}
function updateSelectedCount() {
const n = reqState.selected.size;
$("selected-count").textContent = n
? `${n}日 選ばれています。区分ボタンを押してから提出してね`
: "日付が選ばれていません";
}
document.querySelectorAll(".btn-band").forEach((b) =>
b.addEventListener("click", () => {
reqState.band = b.dataset.band;
document.querySelectorAll(".btn-band").forEach((x) =>
x.className = "btn-band" + (x.dataset.band === reqState.band? " on-" + reqState.band: ""));
}));
$("req-prev").addEventListener("click", () => { shiftMonth(reqState, -1); renderRequest();});
$("req-next").addEventListener("click", () => { shiftMonth(reqState, 1); renderRequest();});
function shiftMonth(state, delta) {
const d = new Date(state.y, state.m + delta, 1);
state.y = d.getFullYear(); state.m = d.getMonth();
if (state.selected) state.selected.clear();
}
$("btn-submit-requests").addEventListener("click", async () => {
if (!reqState.selected.size) { toast("まず日付をタップして選んでね"); return;}
if (!reqState.band) { toast("区分（ランチ／ディナー／深夜）を選んでね"); return;}
const existing = await DB.myRequests(ME.id, reqState.y, reqState.m);
const dup = new Set(existing.map((r) => r.date + "|" + r.band));
const rows = [...reqState.selected]
.filter((ds) =>!dup.has(ds + "|" + reqState.band))
.map((ds) => ({ id: uid(), staff_id: ME.id, date: ds, band: reqState.band, status: "pending", created_at: new Date().toISOString()}));
if (!rows.length) { toast("選んだ日はもう提出ずみでした"); return;}
const err1 = await DB.addRequests(rows);
if (err1) { toast("保存できませんでした。もう一度試してね"); return;}
reqState.selected.clear();
toast(`${rows.length}日分を提出しました。ありがとう！`);
renderRequest();
});
$("btn-copy-prev").addEventListener("click", async () => {
const prev = new Date(reqState.y, reqState.m - 1, 1);
const prevReqs = await DB.myRequests(ME.id, prev.getFullYear(), prev.getMonth());
if (!prevReqs.length) { toast("前月の希望がありませんでした"); return;}
const existing = await DB.myRequests(ME.id, reqState.y, reqState.m);
const dup = new Set(existing.map((r) => r.date + "|" + r.band));
const rows = [];
prevReqs.forEach((r) => {
const day = Number(r.date.slice(8));
const nd = new Date(reqState.y, reqState.m, day);
if (nd.getMonth()!== reqState.m) return;
if (nd.getDay() === CFG.SHOP.closedWeekday) return;
const ds = fmtDate(nd);
if (!dup.has(ds + "|" + r.band)) rows.push({ id: uid(), staff_id: ME.id, date: ds, band: r.band, status: "pending", created_at: new Date().toISOString()});
});
if (!rows.length) { toast("コピーできる希望がありませんでした"); return;}
const err2 = await DB.addRequests(rows);
if (err2) { toast("保存できませんでした。もう一度試してね"); return;}
toast(`前月から${rows.length}件コピーして提出しました`);
renderRequest();
});

// ============================================================
// シフト確認
// ============================================================
const schState = { y: new Date().getFullYear(), m: new Date().getMonth()};
// 月カレンダーの人数チップ用・短い区分表記（管理者用アプリの表記に合わせる）
const BAND_SHORT = { lunch: "昼", dinner: "D", late: "深夜"};
async function renderSchedule() {
const { y, m} = schState;
$("sch-month-title").textContent = `${y}年${m + 1}月`;
const shifts = await DB.listShifts(y, m);
const byDate = new Map();
shifts.forEach((s) => {
if (!byDate.has(s.date)) byDate.set(s.date, []);
byDate.get(s.date).push(s);
});
buildCalendar($("sch-calendar"), y, m, (date, d) => {
const ds = fmtDate(date);
const closed = date.getDay() === CFG.SHOP.closedWeekday;
const dayShifts = byDate.get(ds) || [];
// 人数不足の判定（神坂さんのルール、2026-11-28確認）：昼は2名（日曜は昼営業なし）、
// ディナーは常に2名、深夜は平日2名・金土は調理できる人を含めて3名。定休日は対象外。
const dow = date.getDay();
const cnt = (b) => dayShifts.filter((s) => s.band === b).length;
const short = new Set();
if (!closed) {
if (dow!== 0 && cnt("lunch") < 2) short.add("lunch");
if (cnt("dinner") < 2) short.add("dinner");
const lateRows = dayShifts.filter((s) => s.band === "late");
if (dow === 5 || dow === 6) {
const hasCook = lateRows.some((s) => (STAFF.find((x) => x.id === s.staff_id) || {}).can_cook);
if (lateRows.length < 3 ||!hasCook) short.add("late");
} else if (lateRows.length < 2) short.add("late");
}
const tags = ["lunch", "dinner", "late"].map((b) => {
// 月カレンダーには名前を出さず、区分ごとの人数チップだけ出す。
// 名前と時間は、日をタップしたときの日別詳細（下のカード）で見る。
const count = cnt(b);
if (!count) return "";
const mine = dayShifts.some((s) => s.band === b && s.staff_id === ME.id)? " mine": "";
const sh = short.has(b)? " short": "";
return `<span class="tag ${b}${mine}${sh}">${BAND_SHORT[b]}${count}</span>`;
}).join("") + (short.size? '<span class="tag warn">要確認</span>': "");
const dowCls = date.getDay() === 0? " sun": date.getDay() === 6? " sat": "";
return `<button class="cal-day${closed? " closed": ""}${ds === fmtDate(new Date())? " today": ""}${dowCls}" data-date="${ds}">
<span class="dnum">${d}</span>${closed? '<span class="tag">定休日</span>': tags}</button>`;
}, (ds) => renderDayDetail(ds, byDate.get(ds) || []));
// 既定表示：今月を表示しているときは、タップしなくても今日の名前・時間が
// 見えるよう、日別詳細に今日を出しておく（自動ではスクロールしない）。
// ほかの月では、前の月の詳細が残らないようカードを閉じる。
const nowD = new Date();
if (y === nowD.getFullYear() && m === nowD.getMonth()) {
const todayDs = fmtDate(nowD);
renderDayDetail(todayDs, byDate.get(todayDs) || [], false);
} else {
$("day-detail-card").style.display = "none";
}
}
function renderDayDetail(ds, dayShifts, scroll = true) {
const date = new Date(ds);
$("day-detail-card").style.display = "block";
$("day-detail-title").textContent =
`${date.getMonth() + 1}月${date.getDate()}日（${DOW[date.getDay()]}）のシフト`;
const AXIS_START = 600, AXIS_END = 1620; // 10:00〜27:00
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m;};
const rows = STAFF.map((s) => {
const mine = dayShifts.filter((x) => x.staff_id === s.id);
const bars = mine.map((x) => {
const st = x.start_time || BAND[x.band].start, en = x.end_time || BAND[x.band].end;
const left = ((toMin(st) - AXIS_START) / (AXIS_END - AXIS_START)) * 100;
const width = ((toMin(en) - toMin(st)) / (AXIS_END - AXIS_START)) * 100;
return `<div class="bar ${x.band}" style="left:${left}%;width:${width}%"><span class="bar-time">${st}–${en}</span></div>`;
}).join("");
return `<tr${s.id === ME.id? ' class="me"': ""}><td class="name">${esc(s.name)}</td><td><div class="bar-cell">${bars}</div></td></tr>`;
}).join("");
$("day-detail").innerHTML = `<table>${rows}</table>`;
if (scroll) $("day-detail-card").scrollIntoView({ behavior: "smooth", block: "start"});
}
$("sch-prev").addEventListener("click", () => { shiftMonth(schState, -1); renderSchedule();});
$("sch-next").addEventListener("click", () => { shiftMonth(schState, 1); renderSchedule();});

// ---------- アプリ内印刷（1ヶ月分のシフト表） ----------
// 印刷ページ（print.html）は別ブラウザで開くとログインが引き継がれないため、
// 表示中の月をアプリの中で表に描いて、そのまま印刷できるようにする。
function printCellHTML(rows) {
if (!rows || !rows.length) return "";
const parts = [];
if (rows.some((r) => r.band === "lunch")) parts.push("昼の部");
const night = rows
.filter((r) => r.band === "dinner" || r.band === "late")
.map((r) => ({ s: r.start_time || BAND[r.band].start, e: r.end_time || BAND[r.band].end }))
.sort((a, b) => toMin(a.s) - toMin(b.s));
const merged = [];
for (const r of night) {
const lastM = merged[merged.length - 1];
if (lastM && lastM.e === r.s) lastM.e = r.e;
else merged.push({ ...r });
}
merged.forEach((r) => parts.push(`${r.s}〜${r.e}`));
return parts.join("<br>");
}
$("btn-print-inapp").addEventListener("click", async () => {
const { y, m } = schState;
const shifts = await DB.listShifts(y, m);
const cellMap = new Map();
shifts.forEach((s) => {
const key = `${s.date}|${s.staff_id}`;
if (!cellMap.has(key)) cellMap.set(key, []);
cellMap.get(key).push(s);
});
const daysInMonth = new Date(y, m + 1, 0).getDate();
const DOWP = ["日", "月", "火", "水", "木", "金", "土"];
let rowsHTML = "";
for (let d = 1; d <= daysInMonth; d++) {
const date = new Date(y, m, d);
const dow = date.getDay();
const closed = dow === CFG.SHOP.closedWeekday;
const dowCls = dow === 0 ? "sun" : dow === 6 ? "sat" : "";
const ds = fmtDate(date);
const cells = closed
? STAFF.map(() => `<td class="cell">定休日</td>`).join("")
: STAFF.map((s) => `<td class="cell">${printCellHTML(cellMap.get(`${ds}|${s.id}`))}</td>`).join("");
rowsHTML += `<tr class="${closed ? "closed" : ""}"><td class="date-col ${dowCls}">${d}（${DOWP[dow]}）</td>${cells}</tr>`;
}
$("print-sheet-root").innerHTML =
`<div class="sheet"><div class="sheet-head"><div class="sheet-title">${y}年${m + 1}月1日〜${daysInMonth}日のシフト</div>` +
`<div class="sheet-company">（株）H&Kグループ辛麺屋物語中町本店</div></div>` +
`<table class="shift-matrix"><thead><tr><th class="date-col">日付</th>${STAFF.map((s) => `<th>${esc(s.name)}</th>`).join("")}</tr></thead><tbody>${rowsHTML}</tbody></table>` +
`<div class="sheet-foot">火曜定休／日曜は夜のみ営業　ランチ 11:00–15:00・ディナー 18:00–22:00・深夜 22:00–27:00（「昼の部」はランチ勤務）</div></div>`;
window.print();
});

// ============================================================
// 給与計算
// ============================================================
function segmentsOf(rec) {
if (!rec.clock_in ||!rec.clock_out) return [];
let segs = [[new Date(rec.clock_in), new Date(rec.clock_out)]];
(rec.breaks || []).forEach((b) => {
if (!b.start) return;
const bs = new Date(b.start), be = b.end? new Date(b.end): new Date(rec.clock_out);
const next = [];
segs.forEach(([s, e]) => {
if (be <= s || bs >= e) { next.push([s, e]); return;}
if (bs > s) next.push([s, bs]);
if (be < e) next.push([be, e]);
});
segs = next;
});
return segs;
}
function overlapMin(s, e, ws, we) {
const a = Math.max(s.getTime(), ws.getTime()), b = Math.min(e.getTime(), we.getTime());
return Math.max(0, (b - a) / 60000);
}
function nightMinutes(segs) {
let total = 0;
segs.forEach(([s, e]) => {
for (let d = -1; d <= 1; d++) {
const base = new Date(s.getFullYear(), s.getMonth(), s.getDate() + d);
const w1s = new Date(base); w1s.setHours(22, 0, 0, 0);
const w1e = new Date(base); w1e.setDate(w1e.getDate() + 1); w1e.setHours(5, 0, 0, 0);
total += overlapMin(s, e, w1s, w1e);
}
});
return total;
}
// 所得税の概算（年収ベースの限界税率計算を月割りした簡易式）
// ★国税庁の月額表とは数百円ずれる場合があります。年末調整で精算される前提の概算です。
function estimateIncomeTax(gross, socialAndEmp, dependents) {
const base = Math.max(0, gross - socialAndEmp - 48000 - dependents * 31667);
const annual = base * 12;
const brackets = [
[1950000, 0.05], [3300000, 0.10], [6950000, 0.20], [9000000, 0.23],
[18000000, 0.33], [40000000, 0.40], [Infinity, 0.45]
];
let tax = 0, prev = 0;
for (const [limit, rate] of brackets) {
if (annual <= prev) break;
tax += (Math.min(annual, limit) - prev) * rate;
prev = limit;
}
return Math.floor((tax * 1.021) / 12); // 復興特別所得税2.1%
}
async function computePayroll(staff, y, m) {
const records = await DB.myAttendanceMonth(staff.id, y, m);
let workMin = 0, nightMin = 0, otMin = 0, days = 0;
records.forEach((rec) => {
const segs = segmentsOf(rec);
if (!segs.length) return;
days++;
const w = segs.reduce((a, [s, e]) => a + (e - s) / 60000, 0);
workMin += w;
nightMin += nightMinutes(segs);
otMin += Math.max(0, w - 480);
});
// 辛麺屋出勤手当（cross_allowance が設定されたスタッフのみ：柳村・島本）：
// 基本BAR勤務のため、辛麺屋に出勤した日は1日あたり cross_allowance 円を
// 所定時間外賃金として支給する。日数は「その月に打刻（出勤タップ）の記録が
// ある distinct な日」で数える（2026-11-28変更：シフト通りでない出勤がある
// ため実績連動にした。出勤タップのみ・退勤は不要・時刻は給与に影響しない）。
const crossRate = staff.cross_allowance || 0;
let crossDays = 0;
if (crossRate > 0) {
// 2026年11月分までは打刻データが無いため確定シフトの日数で数え、
// 2026年12月分から打刻（出勤タップ）のあった日数で数える。
if (y * 100 + (m + 1) >= 202612) {
crossDays = new Set(records.filter((r) => r.clock_in).map((r) => r.date)).size;
} else {
const monthShifts = await DB.listShifts(y, m);
crossDays = new Set(monthShifts.filter((s) => s.staff_id === staff.id).map((s) => s.date)).size;
}
}
const crossPay = crossRate * crossDays;
// 社会保険（健康保険・厚生年金・子ども子育て支援金）の加入判定。
// 月給制は staff.social_insurance、時給制は従来の staff.social_insurance_enrolled を使う
// （social_insurance が未設定のスタッフは従来フラグにフォールバックする）。
const siEnrolled = staff.social_insurance != null? !!staff.social_insurance: !!staff.social_insurance_enrolled;
const isSalary = staff.pay_type === "salary";
let wage = staff.hourly_wage || PR.defaultHourlyWage;
let nightIncluded =!!staff.night_included;
let quotaState = null; // 'achieved' | 'missed' | 'unknown'（ノルマ対象者のみ）
let monthSales = null;
let earnings;
if (isSalary) {
// 社員（月給制）：打刻からの時給計算はせず、固定給＋手当で組み立てる。
//   基本給（base_salary）＋役職手当＋深夜手当（固定額 fixed_night_allowance）
//   ＋みなし残業＋交通費＋ドリンクバック
//   ＋所定時間外賃金（辛麺屋出勤手当 = cross_allowance × 打刻した日数）
// ドリンクバックは月ごとに変わるため、対象月の金額を staff.drink_back に
// 入力しておく運用（従来の月次手当入力と同じ仕組み）。
earnings = [
{ label: "基本給", amount: staff.base_salary || 0},
{ label: "役職手当", amount: staff.position_allowance || 0},
{ label: "深夜手当", amount: staff.fixed_night_allowance || 0},
{ label: "みなし残業", amount: staff.deemed_overtime || 0},
{ label: "交通費", amount: staff.transport_allowance || 0},
{ label: "ドリンクバック", amount: staff.drink_back || 0},
...(staff.other_allowances || []).map((o) => ({ label: o.label, amount: o.amount}))
];
if (crossPay > 0) earnings.push({ label: "所定時間外賃金", amount: crossPay});
} else {
// 時給の決定：ノルマ対象者は対象月の売上（monthly_sales）で判定する。
//   売上 > ノルマ → quota_wage（深夜手当込み＝深夜割増を上乗せしない）
//   売上 ≦ ノルマ → 通常時給 ＋ 深夜25%割増
//   売上未登録   → 判定できないため通常時給で仮計算（quotaState = "unknown"）
// night_included のスタッフは常時、深夜割増を上乗せしない。
monthSales = await DB.getMonthlySales(y, m);
if (staff.quota_wage) {
if (monthSales == null) quotaState = "unknown";
else if (monthSales > (staff.quota_threshold || 3000000)) {
wage = staff.quota_wage; nightIncluded = true; quotaState = "achieved";
} else quotaState = "missed";
}
const basePay = Math.round((workMin / 60) * wage);
const nightPay = nightIncluded? 0: Math.round((nightMin / 60) * wage * PR.nightPremiumRate);
const otPremium = Math.round((otMin / 60) * wage * PR.overtimePremiumRate);
const otherItems = [...(staff.other_allowances || [])];
if (otPremium > 0) otherItems.push({ label: "所定時間外割増", amount: otPremium});
if (crossPay > 0) otherItems.push({ label: "所定時間外賃金", amount: crossPay});
earnings = [
{ label: "基本給", amount: basePay},
{ label: "役職手当", amount: staff.position_allowance || 0},
{ label: "深夜手当", amount: nightPay},
{ label: "みなし残業", amount: staff.deemed_overtime || 0},
{ label: "交通費", amount: staff.transport_allowance || 0},
{ label: "ドリンクバック", amount: staff.drink_back || 0},
...otherItems.map((o) => ({ label: o.label, amount: o.amount}))
];
}
const gross = earnings.reduce((a, e) => a + e.amount, 0);
let health = 0, pension = 0, child = 0;
if (siEnrolled) {
health = Math.round(gross * PR.healthInsuranceRate);
pension = Math.round(gross * PR.pensionRate);
child = Math.round(gross * PR.childSupportRate);
}
const emp = Math.round(gross * PR.employmentInsuranceRate);
const tax = estimateIncomeTax(gross, health + pension + child + emp, staff.dependents || 0);
const deductions = [
{ label: "健康保険料", amount: health},
{ label: "厚生年金", amount: pension},
{ label: "雇用保険料", amount: emp},
{ label: "所得税", amount: tax},
{ label: "子ども・子育て支援金", amount: child},
{ label: "前払金", amount: staff.advance_payment || 0},
{ label: "住民税", amount: staff.resident_tax || 0}
];
const dedTotal = deductions.reduce((a, d) => a + d.amount, 0);
return {
days, workMin, otMin, earnings, gross, deductions, dedTotal,
wage, nightIncluded, quotaState, monthSales,
crossDays, crossRate, crossPay, payType: isSalary? "salary": "hourly",
net: gross - dedTotal,
period: `${y}年${m + 1}月1日〜${m + 1}月${new Date(y, m + 1, 0).getDate()}日`
};
}

// ---------- シフトからの給与予想（概算） ----------
// 確定シフトの時間から、その月の手取りを概算する。時給・ノルマ判定・
// 控除のルールは computePayroll（打刻ベースの本計算）と同じにしてある。
async function computeShiftEstimate(staff, y, m) {
const t2m = (t) => { const [h, mm] = t.split(":").map(Number); return h * 60 + mm; };
let shifts = (await DB.listShifts(y, m)).filter((s) => s.staff_id === staff.id);
let provisional = false;
if (!shifts.length) {
// 確定シフトがまだ無い月は、希望（却下以外）から暫定の予想を出す
const reqs = (await DB.myRequests(staff.id, y, m)).filter((r) => r.status!== "rejected");
if (reqs.length) {
provisional = true;
shifts = reqs.map((r) => ({ staff_id: staff.id, date: r.date, band: r.band, start_time: BAND[r.band].start, end_time: BAND[r.band].end }));
}
}
let workMin = 0, nightMin = 0, otMin = 0;
const perDay = new Map();
shifts.forEach((s) => {
const st = t2m(s.start_time || BAND[s.band].start);
const en = t2m(s.end_time || BAND[s.band].end);
if (en <= st) return;
workMin += en - st;
// 深夜帯は 22:00〜29:00（翌5:00）との重なりで数える
nightMin += Math.max(0, Math.min(en, 1740) - Math.max(st, 1320));
perDay.set(s.date, (perDay.get(s.date) || 0) + (en - st));
});
perDay.forEach((mins) => { otMin += Math.max(0, mins - 480); });
const days = perDay.size;
let wage = staff.hourly_wage || PR.defaultHourlyWage;
let nightIncluded =!!staff.night_included;
let quotaState = null;
const monthSales = await DB.getMonthlySales(y, m);
if (staff.quota_wage) {
if (monthSales == null) quotaState = "unknown";
else if (monthSales > (staff.quota_threshold || 3000000)) {
wage = staff.quota_wage; nightIncluded = true; quotaState = "achieved";
} else quotaState = "missed";
}
const siEnrolled = staff.social_insurance != null? !!staff.social_insurance: !!staff.social_insurance_enrolled;
const calcNet = (w, ni) => {
const basePay = Math.round((workMin / 60) * w);
const nightPay = ni? 0: Math.round((nightMin / 60) * w * PR.nightPremiumRate);
const otPremium = Math.round((otMin / 60) * w * PR.overtimePremiumRate);
const gross = basePay + nightPay + otPremium
+ (staff.position_allowance || 0) + (staff.deemed_overtime || 0)
+ (staff.transport_allowance || 0) + (staff.drink_back || 0)
+ (staff.other_allowances || []).reduce((a, o) => a + o.amount, 0);
const health = siEnrolled? Math.round(gross * PR.healthInsuranceRate): 0;
const pension = siEnrolled? Math.round(gross * PR.pensionRate): 0;
const child = siEnrolled? Math.round(gross * PR.childSupportRate): 0;
const emp = Math.round(gross * PR.employmentInsuranceRate);
const tax = estimateIncomeTax(gross, health + pension + child + emp, staff.dependents || 0);
const ded = health + pension + child + emp + tax
+ (staff.advance_payment || 0) + (staff.resident_tax || 0);
return { gross, net: gross - ded };
};
const main = calcNet(wage, nightIncluded);
const altNet = quotaState === "unknown"? calcNet(staff.quota_wage, true).net: null;
return { days, workMin, nightMin, wage, nightIncluded, quotaState, provisional,
gross: main.gross, net: main.net, altNet, shiftCount: shifts.length };
}
async function renderShiftEstimate(y, m) {
const card = $("pay-estimate-card");
// 社員（月給制）は下の出勤手当表示が実質の予想になるため、カードは出さない。
if (ME.pay_type === "salary") { card.style.display = "none"; return; }
const e = await computeShiftEstimate(ME, y, m);
if (!e.shiftCount) { card.style.display = "none"; return; }
card.style.display = "";
$("pay-est-net").textContent = fmtYen(e.net);
$("pay-est-table").innerHTML =
`<tr><td>出勤日数（${e.provisional? "希望": "確定シフト"}）</td><td class="num">${e.days}日</td></tr>` +
`<tr><td>労働時間</td><td class="num">${fmtHM(e.workMin)}（深夜 ${fmtHM(e.nightMin)}）</td></tr>` +
`<tr><td>支給合計の予想</td><td class="num">${fmtYen(e.gross)}</td></tr>` +
`<tr><td>時給</td><td class="num">${fmtYen(e.wage)}${e.nightIncluded? "（深夜手当込み）": ""}</td></tr>`;
const notes = [e.provisional? "希望から計算した暫定の概算です。確定シフトが出ると、そちらで計算し直します。実際の金額は、打刻の記録や締め日の確定内容で変わります。": "確定シフトから計算した概算です。実際の金額は、打刻の記録や締め日の確定内容で変わります。"];
if (e.quotaState === "unknown") notes.push(`今月の売上が未確定のため通常時給で計算しています。ノルマ達成の場合は、手取り予想が約${fmtYen(e.altNet)}になります。`);
else if (e.quotaState === "achieved") notes.push("今月はノルマ達成の時給で計算しています。");
else if (e.quotaState === "missed") notes.push("今月の売上はノルマ未達のため、通常時給＋深夜割増で計算しています。");
$("pay-est-note").textContent = notes.join(" ");
}

const payState = { y: new Date().getFullYear(), m: new Date().getMonth()};
let lastPayroll = null;
async function renderPay() {
const { y, m} = payState;
$("pay-month-title").textContent = `${y}年${m + 1}月分`;
$("pay-slip-title").textContent = `給料支払明細書（${y}年${m + 1}月分）`;
$("pay-staff-name").textContent = ME.name;
const p = await computePayroll(ME, y, m);
lastPayroll = p;
await renderShiftEstimate(y, m);
$("pay-net").textContent = fmtYen(p.net);
const payDate = new Date(y, m + 1, PR.payDay);
$("pay-date-note").textContent = `支払予定日：${payDate.getMonth() + 1}月${PR.payDay}日`;
const row = (label, val) => `<tr><td>${esc(label)}</td><td class="num">${esc(val)}</td></tr>`;
// 社員（月給制）は明細内訳を見せず、辛麺屋の出勤手当だけを表示する。
// 給与はドリンクバック等で変わり確定はBAR側のため、このアプリ（辛麺屋専用）
// では出勤日数と手当だけを出す（2026-11-28決定）。計算自体は従来どおり。
const salaryView = ME.pay_type === "salary";
$("pay-slip-area").style.display = salaryView? "none": "";
$("pay-cross-area").style.display = salaryView? "": "none";
if (salaryView) {
$("pay-cross-amount").textContent = fmtYen(p.crossPay);
$("pay-cross-formula").textContent = `${fmtYen(p.crossRate)} × ${p.crossDays}日分`;
$("pay-cross-table").innerHTML =
row("出勤日数", `${p.crossDays}日`) +
row("出勤手当（単価）", fmtYen(p.crossRate)) +
`<tr class="total"><td>出勤手当 合計</td><td class="num">${fmtYen(p.crossPay)}</td></tr>`;
return;
}
$("pay-attendance").innerHTML =
row("労働期間", p.period) + row("労働日数", `${p.days}日`) +
row("労働時間", fmtHM(p.workMin)) + row("所定時間外労働", fmtHM(p.otMin));
$("pay-earnings").innerHTML =
p.earnings.map((e) => row(e.label, fmtYen(e.amount))).join("") +
`<tr class="total"><td>支給合計</td><td class="num">${fmtYen(p.gross)}</td></tr>`;
$("pay-deductions").innerHTML =
p.deductions.map((d) => row(d.label, fmtYen(d.amount))).join("") +
`<tr class="total"><td>控除合計</td><td class="num">${fmtYen(p.dedTotal)}</td></tr>`;
const remarkLines = [`所属店舗：${esc(ME.shop_name || "辛麺屋 物語 中町本店")}`];
if (p.crossPay > 0) remarkLines.push(`辛麺屋出勤手当 ${fmtYen(p.crossRate)} × ${p.crossDays}日分を、所定時間外賃金として加算しています。`);
if (p.payType === "salary") remarkLines.push(`社員（月給制）のため、固定給（基本給＋各種手当）で計算しています。`);
if (p.quotaState === "achieved") remarkLines.push(`今月はノルマ達成のため、時給${fmtYen(p.wage)}（深夜手当込み）で計算しています。`);
else if (p.quotaState === "missed") remarkLines.push(`今月の売上はノルマ未達のため、通常時給＋深夜割増で計算しています。`);
else if (p.quotaState === "unknown") remarkLines.push(`今月の売上がまだ集計されていないため、通常時給で仮計算しています。`);
else if (p.nightIncluded) remarkLines.push(`時給は深夜手当込みのため、深夜割増は上乗せしていません。`);
remarkLines.push(`所得税・社会保険料は概算です。`);
$("pay-remarks").innerHTML = remarkLines.join("<br>");
}
$("pay-prev").addEventListener("click", () => { shiftMonth(payState, -1); renderPay();});
$("pay-next").addEventListener("click", () => { shiftMonth(payState, 1); renderPay();});

function payslipText() {
const p = lastPayroll; if (!p) return "";
const L = [];
L.push(`給料支払明細書（${payState.y}年${payState.m + 1}月分）`);
L.push(`${ME.name} 殿`);
L.push("");
L.push(`労働期間：${p.period}／労働日数：${p.days}日／労働時間：${fmtHM(p.workMin)}／所定時間外労働：${fmtHM(p.otMin)}`);
L.push("");
p.earnings.forEach((e) => L.push(`${e.label}：${fmtYen(e.amount)}`));
L.push(`支給合計：${fmtYen(p.gross)}`);
L.push("");
p.deductions.forEach((d) => L.push(`${d.label}：${fmtYen(d.amount)}`));
L.push(`控除合計：${fmtYen(p.dedTotal)}`);
L.push(`差引支給額：${fmtYen(p.net)}`);
if (p.crossPay > 0) L.push(`辛麺屋出勤手当：${fmtYen(p.crossRate)} × ${p.crossDays}日（所定時間外賃金として支給）`);
if (p.payType === "salary") L.push(`社員（月給制）のため、固定給で計算しています`);
L.push(`備考：所属店舗 ${ME.shop_name || "辛麺屋 物語 中町本店"}`);
L.push("株式会社H&Kグループ");
return L.join("\n");
}
$("btn-copy-pay").addEventListener("click", async () => {
try { await navigator.clipboard.writeText(payslipText()); toast("明細をコピーしました");}
catch (e) { toast("コピーできませんでした");}
});
$("btn-share-pay").addEventListener("click", async () => {
const text = payslipText();
if (navigator.share) {
try { await navigator.share({ title: "給料支払明細書", text});} catch (e) { /* キャンセル時 */}
} else {
try { await navigator.clipboard.writeText(text); toast("共有機能がないためコピーしました");}
catch (e) { toast("共有できませんでした");}
}
});
$("btn-print-pay").addEventListener("click", () => {
const p = lastPayroll; if (!p) return;
const w = window.open("", "_blank");
if (!w) { toast("ポップアップがブロックされました"); return;}
const trs = (items, totalLabel, total) =>
items.map((i) => `<tr><td>${esc(i.label)}</td><td class="num">${fmtYen(i.amount)}</td></tr>`).join("") +
`<tr class="total"><td>${totalLabel}</td><td class="num">${fmtYen(total)}</td></tr>`;
w.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<title>給料支払明細書</title><style>
@page{size:A4 portrait;margin:14mm}
body{font-family:"Hiragino Sans","Noto Sans JP",sans-serif;color:#222;font-size:13px}
h1{font-size:19px;text-align:center;margin:0 0 4px}
.name{font-size:15px;font-weight:700;margin:10px 0}
table{width:100%;border-collapse:collapse;margin:8px 0 14px}
th,td{border:1px solid #888;padding:5px 8px}
th{background:#F7F2EC;text-align:left}
td.num{text-align:right}
tr.total td{font-weight:800;background:#F7F2EC}
h2{font-size:14px;margin:14px 0 4px;border-left:5px solid #D94036;padding-left:8px}
.net{text-align:center;border:2px solid #222;padding:12px;margin:16px 0}
.net.amt{font-size:26px;font-weight:900}
.foot{text-align:right;margin-top:24px;font-weight:700}
</style></head><body>
<h1>給料支払明細書（${payState.y}年${payState.m + 1}月分）</h1>
<div class="name">${esc(ME.name)} 殿</div>
<h2>勤怠</h2>
<table>
<tr><th>労働期間</th><td>${p.period}</td><th>労働日数</th><td>${p.days}日</td></tr>
<tr><th>労働時間</th><td>${fmtHM(p.workMin)}</td><th>所定時間外労働</th><td>${fmtHM(p.otMin)}</td></tr>
</table>
<h2>支給額</h2>
<table>${trs(p.earnings, "支給合計", p.gross)}</table>
<h2>控除額</h2>
<table>${trs(p.deductions, "控除合計", p.dedTotal)}</table>
<div class="net">差引支給額　<span class="amt">${fmtYen(p.net)}</span></div>
<div>備考：所属店舗 ${esc(ME.shop_name || "辛麺屋 物語 中町本店")}／所得税・社会保険料は概算です</div>
<div class="foot">株式会社H&Kグループ</div>
<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script>
</body></html>`);
w.document.close();
});

// ============================================================
// お知らせ
// ============================================================
function maybeSeedDemoInbox() {
if (!DEMO) return;
if (demoDB.notifications.some((n) => n.staff_id === ME.id)) return;
const now = new Date();
demoDB.notifications.push({
id: uid(), staff_id: ME.id, type: "reminder",
title: "シフト希望の締切が近づいています",
body: `来月分のシフト希望の締切は今月${CFG.SHOP.requestDeadlineDay}日です。まだの人は「希望提出」から出してね。`,
created_at: now.toISOString(), read: false, work_request_id: null
});
if (ME.name === "吉村汐織" || ME.name === "矢野恵") {
const fri = new Date(now); fri.setDate(fri.getDate() + ((5 - fri.getDay() + 7) % 7 || 7));
const wr = { id: uid(), staff_id: ME.id, date: fmtDate(fri), band: "late", message: "深夜に入ってもらえると助かります", status: "pending", created_at: now.toISOString()};
demoDB.work_requests.push(wr);
demoDB.notifications.push({
id: uid(), staff_id: ME.id, type: "work_request",
title: "出勤のお願いが届いています",
body: `${fri.getMonth() + 1}月${fri.getDate()}日（金）深夜 22:00–27:00 に入ってもらえませんか？`,
created_at: now.toISOString(), read: false, work_request_id: wr.id
});
}
saveDemo();
refreshInboxBadge();
}
async function refreshInboxBadge() {
if (!ME) return;
const list = await DB.listNotifications(ME.id);
const unread = list.filter((n) =>!n.read).length;
const badge = $("inbox-badge");
badge.style.display = unread? "block": "none";
badge.textContent = unread;
}
async function renderInbox() {
renderAdminCorrections();
const list = await DB.listNotifications(ME.id);
$("notice-empty").style.display = list.length? "none": "block";
const typeLabel = {
work_request: "出勤のお願い", rejection: "シフト希望について",
shift_confirmed: "シフト確定", answer_accepted: "出勤依頼の回答",
answer_declined: "出勤依頼の回答",
correction_request: "打刻の訂正依頼", correction_approved: "訂正の結果",
correction_rejected: "訂正の結果", reminder: "リマインド", info: "お知らせ"
};
$("notice-list").innerHTML = "";
for (const n of list) {
const div = document.createElement("div");
div.className = "notice" + (n.read? "": " unread");
const d = new Date(n.created_at);
let actions = "";
if (n.type === "work_request" && n.work_request_id) {
const wr = await DB.getWorkRequest(n.work_request_id);
if (wr && wr.status === "pending") {
actions = `<div class="n-actions">
<button class="btn-accept" data-act="accept" data-wr="${wr.id}">入ります</button>
<button class="btn-decline" data-act="decline" data-wr="${wr.id}">難しいです</button></div>`;
} else if (wr) {
actions = `<p class="hint">${wr.status === "accepted"? "承諾ずみ（確定シフトに入りました）": "辞退ずみ"}</p>`;
}
}
div.innerHTML =
`<div class="n-title">${esc(typeLabel[n.type] || "お知らせ")}：${esc(n.title)}</div>` +
`<div class="n-body">${esc(n.body)}</div>` +
`<div class="n-date">${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${pad(d.getMinutes())}</div>` + actions;
div.querySelectorAll("[data-act]").forEach((btn) =>
btn.addEventListener("click", async () => {
await DB.answerWorkRequest(btn.dataset.wr, btn.dataset.act === "accept"? "accepted": "declined");
await DB.markNotificationRead(n.id);
toast(btn.dataset.act === "accept"? "承諾しました。確定シフトに入りました": "辞退を伝えました");
renderInbox(); refreshInboxBadge();
}));
if (!n.read) DB.markNotificationRead(n.id);
$("notice-list").appendChild(div);
}
refreshInboxBadge();
}

// ============================================================
// Push通知の購読
// ============================================================
/** 購読に使われているサーバー鍵が、現在の設定の鍵と一致するか */
function subKeyMatches(sub) {
try {
const cur = sub && sub.options && sub.options.applicationServerKey;
if (!cur || !CFG.VAPID_PUBLIC_KEY) return true;
const b64 = btoa(String.fromCharCode(...new Uint8Array(cur)))
.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
return b64 === CFG.VAPID_PUBLIC_KEY;
} catch (e) { return true; }
}
function urlBase64ToUint8Array(base64) {
const padding = "=".repeat((4 - (base64.length % 4)) % 4);
const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
const raw = atob(b64);
return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function setupPushUI() {
const banner = $("push-banner");
const btn = $("btn-enable-push");
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = window.navigator.standalone === true
|| window.matchMedia("(display-mode: standalone)").matches;
// iOS はホーム画面に追加したアプリでないと通知が使えない。追加を案内する。
if (isIOS && !standalone) {
banner.firstChild.textContent =
"iPhoneで通知を受け取るには、このページをホーム画面に追加して、追加したアイコンから開いてください（共有ボタン→「ホーム画面に追加」）。 ";
btn.style.display = "none";
banner.style.display = "block";
return;
}
if (!("serviceWorker" in navigator) ||!("PushManager" in window)) {
banner.style.display = "none"; return;
}
// 通知がブロックされている場合はボタンでは直せないので、設定の案内を出す。
if (Notification.permission === "denied") {
banner.firstChild.textContent =
"通知がブロックされています。端末の設定で、このアプリの通知を許可してください。 ";
btn.style.display = "none";
banner.style.display = "block";
return;
}
const reg = await navigator.serviceWorker.ready;
let sub = await reg.pushManager.getSubscription();
// サーバー側の鍵が差し替わっていたら、古い購読は使えないので破棄する。
if (sub && !subKeyMatches(sub)) {
try { await sub.unsubscribe(); } catch (e) {}
sub = null;
}
// 許可済みなのに購読が無い（端末変更・購読の失効など）場合は、黙って取り直す。
if (!sub && Notification.permission === "granted" && CFG.VAPID_PUBLIC_KEY) {
try {
sub = await reg.pushManager.subscribe({
userVisibleOnly: true,
applicationServerKey: urlBase64ToUint8Array(CFG.VAPID_PUBLIC_KEY)
});
if (sub) await DB.savePushSubscription(sub.toJSON());
} catch (e) { /* 取れなければバナーを出して手動でONにしてもらう */ }
}
banner.style.display = sub ? "none" : "block";
btn.style.display = sub ? "none" : "";
}
$("btn-enable-push").addEventListener("click", async () => {
try {
const perm = await Notification.requestPermission();
if (perm!== "granted") { toast("通知が許可されませんでした"); return;}
const reg = await navigator.serviceWorker.ready;
let sub = await reg.pushManager.getSubscription();
if (sub && !subKeyMatches(sub)) {
try { await sub.unsubscribe(); } catch (e) {}
sub = null;
}
if (!sub && CFG.VAPID_PUBLIC_KEY) {
sub = await reg.pushManager.subscribe({
userVisibleOnly: true,
applicationServerKey: urlBase64ToUint8Array(CFG.VAPID_PUBLIC_KEY)
});
}
if (sub) await DB.savePushSubscription(sub.toJSON());
$("push-banner").style.display = "none";
toast("通知をONにしました");
} catch (e) {
toast("通知の設定に失敗しました");
}
});

// ============================================================
// 管理者画面（role='admin' のみ）
// ------------------------------------------------------------
// ・シフト希望の提出状況／日別シフト（全員・名前列は横スクロール時も
//   左端に固定）／シフトの確定・編集／給与一覧と個人明細／
//   税理士送付用の一括出力（CSV・コピー・共有）／月の売上入力。
// ・副管理者（subadmin）には管理者メニュー自体を出さない
//   （訂正承認と希望閲覧は従来の導線のまま）。
// ・給与計算は既存の computePayroll をそのまま使う（計算は変えない）。
// ============================================================
const admState = { y: new Date().getFullYear(), m: new Date().getMonth(),
day: fmtDate(new Date()), editDate: fmtDate(new Date()), payDetailId: null};
let admPayrolls = []; // {staff, p} 給与一覧の計算結果（CSV・コピー用に保持）
const IS_ADMIN = () =>!!ME && ME.role === "admin";

async function renderAdmin() {
if (!IS_ADMIN()) return;
const { y, m} = admState;
$("adm-month-title").textContent = `${y}年${m + 1}月`;
if (!$("adm-day-date").value) $("adm-day-date").value = admState.day;
await renderAdminRequests();
await renderAdminDay();
await renderAdminEditor();
await renderAdminPayrolls();
await renderAdminSales();
}
$("adm-prev").addEventListener("click", () => { shiftMonth(admState, -1); admState.payDetailId = null; $("adm-pay-detail").innerHTML = ""; renderAdmin();});
$("adm-next").addEventListener("click", () => { shiftMonth(admState, 1); admState.payDetailId = null; $("adm-pay-detail").innerHTML = ""; renderAdmin();});

// ---------- 1. シフト希望の提出状況 ----------
async function renderAdminRequests() {
const { y, m} = admState;
const reqs = await DB.listAllRequests(y, m);
const byStaff = new Map();
reqs.forEach((r) => {
if (!byStaff.has(r.staff_id)) byStaff.set(r.staff_id, []);
byStaff.get(r.staff_id).push(r);
});
const isExempt = (s) => s.pay_type === "salary"; // 社員は希望提出の対象外
const submitted = STAFF.filter((s) => (byStaff.get(s.id) || []).length > 0);
const missing = STAFF.filter((s) =>!isExempt(s) &&!(byStaff.get(s.id) || []).length);
$("adm-req-summary").innerHTML =
`提出済み ${submitted.length}名 ／ 未提出 ${missing.length}名` +
(missing.length? `<br>未提出：${missing.map((s) => esc(s.name)).join("、")}`: "");
$("adm-req-list").innerHTML = STAFF.map((s) => {
const list = (byStaff.get(s.id) || []).slice()
.sort((a, b) => (a.date < b.date? -1: a.date > b.date? 1: a.band < b.band? -1: 1));
if (!list.length && isExempt(s))
return `<div class="adm-req-staff"><span class="adm-badge">対象外</span> <b>${esc(s.name)}</b></div>`;
if (!list.length)
return `<div class="adm-req-staff"><span class="adm-badge ng">未提出</span> <b>${esc(s.name)}</b></div>`;
const byDate = new Map();
list.forEach((r) => {
if (!byDate.has(r.date)) byDate.set(r.date, []);
byDate.get(r.date).push(r.band);
});
const lines = [...byDate.entries()].map(([ds, bands]) => {
const d = new Date(ds);
return `${d.getMonth() + 1}/${d.getDate()}（${DOW[d.getDay()]}）${bands.map((b) => BAND[b].label).join("・")}`;
});
return `<div class="adm-req-staff"><span class="adm-badge ok">提出済み</span> <b>${esc(s.name)}</b>` +
`<div class="hint">${lines.map(esc).join("<br>")}</div></div>`;
}).join("");
// 希望カレンダー：日ごとに「区分＋希望者の短い名前」を並べて、
// 誰がいつ入りたいかをカレンダー形式でひと目で分かるようにする。
const reqByDate = new Map();
reqs.filter((r) => r.status!== "rejected").forEach((r) => {
if (!reqByDate.has(r.date)) reqByDate.set(r.date, []);
reqByDate.get(r.date).push(r);
});
const shortName = (id) => (STAFF.find((s) => s.id === id) || {}).short || "";
buildCalendar($("adm-req-calendar"), y, m, (date, d) => {
const ds = fmtDate(date);
const closed = date.getDay() === CFG.SHOP.closedWeekday;
const dayReqs = reqByDate.get(ds) || [];
const lines = ["lunch", "dinner", "late"].map((b) => {
const names = dayReqs.filter((r) => r.band === b).map((r) => shortName(r.staff_id)).filter(Boolean);
if (!names.length) return "";
return `<div class="req-line ${b}"><span class="req-band">${BAND_SHORT[b]}</span>${esc(names.join("・"))}</div>`;
}).join("");
const dowCls = date.getDay() === 0? " sun": date.getDay() === 6? " sat": "";
return `<button class="cal-day${closed? " closed": ""}${dowCls}" data-date="${ds}">
<span class="dnum">${d}</span>${closed? '<span class="tag">定休日</span>': lines}</button>`;
}, (ds) => renderAdminReqDay(ds, reqByDate.get(ds) || []));
}
function renderAdminReqDay(ds, dayReqs) {
const d = new Date(ds);
const title = `${d.getMonth() + 1}/${d.getDate()}（${DOW[d.getDay()]}）の希望`;
if (!dayReqs.length) {
$("adm-req-day").innerHTML = `${esc(title)}：希望はありません`;
return;
}
const lines = ["lunch", "dinner", "late"].map((b) => {
const names = dayReqs.filter((r) => r.band === b).map((r) => staffName(r.staff_id)).filter(Boolean);
if (!names.length) return "";
return `${BAND[b].label}（${BAND[b].time}）：${names.join("、")}`;
});
$("adm-req-day").innerHTML = `<b>${esc(title)}</b><br>` + lines.filter(Boolean).map(esc).join("<br>");
}

// ---------- 2. 日別シフト（全員分・名前列 sticky） ----------
async function renderAdminDay() {
const ds = admState.day;
const d = new Date(ds);
const shifts = await DB.listShifts(d.getFullYear(), d.getMonth());
const dayShifts = shifts.filter((s) => s.date === ds);
const AXIS_START = 600, AXIS_END = 1620; // 10:00〜27:00
const toMin = (t) => { const [h, mm] = t.split(":").map(Number); return h * 60 + mm;};
const rows = STAFF.map((s) => {
const mine = dayShifts.filter((x) => x.staff_id === s.id)
.sort((a, b) => toMin(a.start_time || BAND[a.band].start) - toMin(b.start_time || BAND[b.band].start));
const times = mine.map((x) => `${x.start_time || BAND[x.band].start}–${x.end_time || BAND[x.band].end}`).join("／");
const bars = mine.map((x) => {
const st = x.start_time || BAND[x.band].start, en = x.end_time || BAND[x.band].end;
const left = ((toMin(st) - AXIS_START) / (AXIS_END - AXIS_START)) * 100;
const width = Math.max(3, ((toMin(en) - toMin(st)) / (AXIS_END - AXIS_START)) * 100);
return `<div class="bar ${x.band}" style="left:${left}%;width:${width}%"><span class="bar-time">${st}–${en}</span></div>`;
}).join("");
return `<tr${s.id === ME.id? ' class="me"': ""}><td class="adm-name-cell">${esc(s.name)}` +
`${times? `<span class="adm-times">${esc(times)}</span>`: ""}</td>` +
`<td><div class="bar-cell">${bars}</div></td></tr>`;
}).join("");
$("adm-day-chart").innerHTML =
`<div class="adm-day-scroll"><table class="adm-day-table">${rows}</table>` +
`<div class="adm-axis"><span>10時</span><span>14時</span><span>18時</span><span>22時</span><span>27時</span></div></div>` +
`<p class="hint" style="margin-top:8px">${d.getMonth() + 1}月${d.getDate()}日（${DOW[d.getDay()]}）の確定シフト</p>`;
}
$("adm-day-date").addEventListener("change", () => {
admState.day = $("adm-day-date").value || admState.day;
renderAdminDay();
});

// ---------- 3. シフト作成・編集（Airシフト式：スタッフ×日付の月表） ----------
// セル＝その人・その日。上段に確定シフト（色つき）、下段に未確定の希望（枠だけ）を
// 同じセルに並べる。セルをタップすると下に編集パネルが開き、希望はボタン1つで
// 確定にでき、追加は区分ボタン（標準時間）かプルダウンの時刻で入れる。
let admCell = null; // { staffId, date } 選択中のセル
let admGridCache = { shiftMap: new Map(), reqMap: new Map()};
const HOUR_OPTS = []; for (let h = 10; h <= 28; h++) HOUR_OPTS.push(h);
const MIN_OPTS = ["00", "15", "30", "45"];
function timeSelHTML(cls, val) {
const [hh, mm] = String(val || "18:00").split(":");
const hOpts = HOUR_OPTS.map((h) => `<option value="${pad(h)}"${pad(h) === hh? " selected": ""}>${h}</option>`).join("");
const mOpts = MIN_OPTS.map((x) => `<option value="${x}"${x === mm? " selected": ""}>${x}</option>`).join("");
return `<select class="${cls}-h adm-tsel" aria-label="時">${hOpts}</select>:<select class="${cls}-m adm-tsel" aria-label="分">${mOpts}</select>`;
}
function readTimeSel(scope, cls) {
return scope.querySelector(`.${cls}-h`).value + ":" + scope.querySelector(`.${cls}-m`).value;
}
function setTimeSel(scope, cls, val) {
const [hh, mm] = String(val).split(":");
scope.querySelector(`.${cls}-h`).value = hh;
scope.querySelector(`.${cls}-m`).value = mm;
}
async function renderAdminEditor() {
const { y, m} = admState;
const shifts = await DB.listShifts(y, m);
const reqs = (await DB.listAllRequests(y, m)).filter((r) => r.status!== "rejected");
const shiftMap = new Map(), reqMap = new Map();
shifts.forEach((s) => {
const k = s.staff_id + "|" + s.date;
if (!shiftMap.has(k)) shiftMap.set(k, []);
shiftMap.get(k).push(s);
});
reqs.forEach((r) => {
const k = r.staff_id + "|" + r.date;
if (!reqMap.has(k)) reqMap.set(k, []);
reqMap.get(k).push(r);
});
admGridCache = { shiftMap, reqMap};
const days = new Date(y, m + 1, 0).getDate();
const todayDs = fmtDate(new Date());
let head = `<tr><th class="g-name">スタッフ</th>`;
for (let d = 1; d <= days; d++) {
const dt = new Date(y, m, d);
const cls = dt.getDay() === 0? " sun": dt.getDay() === 6? " sat": dt.getDay() === CFG.SHOP.closedWeekday? " closed": "";
head += `<th class="g-day${cls}">${d}<br>${DOW[dt.getDay()]}</th>`;
}
head += "</tr>";
const bandOrder = (a, b) => ["lunch", "dinner", "late"].indexOf(a.band) - ["lunch", "dinner", "late"].indexOf(b.band);
const rows = STAFF.map((s) => {
let tds = `<td class="g-name">${esc(s.short || s.name)}</td>`;
for (let d = 1; d <= days; d++) {
const ds = fmtDate(new Date(y, m, d));
const mine = (shiftMap.get(s.id + "|" + ds) || []).slice().sort(bandOrder);
const haveBands = new Set(mine.map((x) => x.band));
let chips = mine.map((x) =>
`<span class="g-chip ${x.band}">${BAND_SHORT[x.band]} ${(x.start_time || BAND[x.band].start).slice(0, 5)}–${(x.end_time || BAND[x.band].end).slice(0, 5)}</span>`).join("");
chips += (reqMap.get(s.id + "|" + ds) || []).filter((r) =>!haveBands.has(r.band))
.map((r) => `<span class="g-chip req ${r.band}">希望 ${BAND_SHORT[r.band]}</span>`).join("");
const sel = admCell && admCell.staffId === s.id && admCell.date === ds? " sel": "";
tds += `<td class="g-cell${sel}${ds === todayDs? " today": ""}" data-staff="${s.id}" data-date="${ds}">${chips}</td>`;
}
return `<tr>${tds}</tr>`;
}).join("");
$("adm-grid").innerHTML = head + rows;
$("adm-grid").querySelectorAll(".g-cell").forEach((c) =>
c.addEventListener("click", () => {
admCell = { staffId: c.dataset.staff, date: c.dataset.date};
$("adm-grid").querySelectorAll(".g-cell.sel").forEach((x) => x.classList.remove("sel"));
c.classList.add("sel");
renderAdminCellPanel();
}));
renderAdminCellPanel();
}
function renderAdminCellPanel() {
const box = $("adm-cell-panel");
if (!admCell) { box.innerHTML = ""; return;}
const { shiftMap, reqMap} = admGridCache;
const s = STAFF.find((x) => x.id === admCell.staffId);
if (!s) { box.innerHTML = ""; return;}
const ds = admCell.date;
const d = new Date(ds);
const mine = (shiftMap.get(s.id + "|" + ds) || []).slice()
.sort((a, b) => ["lunch", "dinner", "late"].indexOf(a.band) - ["lunch", "dinner", "late"].indexOf(b.band));
const haveBands = new Set(mine.map((x) => x.band));
const reqTodo = (reqMap.get(s.id + "|" + ds) || []).filter((r) =>!haveBands.has(r.band));
let html = `<div class="adm-cell-head"><b>${esc(s.name)}</b>　${d.getMonth() + 1}月${d.getDate()}日（${DOW[d.getDay()]}）</div>`;
if (reqTodo.length) {
html += `<div class="adm-cell-sec">この日の希望（タップで確定）</div><div class="adm-pat-row">` +
reqTodo.map((r) => `<button type="button" class="btn-mini accent" data-confirm-req="${r.band}">${BAND[r.band].label}の希望を確定にする</button>`).join("") + `</div>`;
}
if (mine.length) {
html += `<div class="adm-cell-sec">確定シフト</div>` + mine.map((x) =>
`<div class="adm-shift-row" data-shift="${x.id}">
<span class="tag solid ${x.band}">${BAND[x.band].label}</span>
${timeSelHTML("adm-st", x.start_time || BAND[x.band].start)}<span>〜</span>${timeSelHTML("adm-en", x.end_time || BAND[x.band].end)}
<button type="button" class="btn-mini accent" data-act="save">保存</button>
<button type="button" class="btn-mini danger" data-act="del">削除</button>
</div>`).join("");
}
const addable = ["lunch", "dinner", "late"].filter((b) =>!haveBands.has(b));
if (addable.length) {
html += `<div class="adm-cell-sec">シフトを追加（タップで標準時間）</div><div class="adm-pat-row">` +
addable.map((b) => `<button type="button" class="btn-mini" data-add-band="${b}">${BAND[b].label} ${BAND[b].start}–${BAND[b].end}</button>`).join("") + `</div>`;
html += `<div class="adm-shift-row adm-custom-row">
<select class="adm-new-band" aria-label="区分">${addable.map((b) => `<option value="${b}">${BAND[b].label}</option>`).join("")}</select>
${timeSelHTML("adm-new-st", BAND[addable[0]].start)}<span>〜</span>${timeSelHTML("adm-new-en", BAND[addable[0]].end)}
<button type="button" class="btn-mini" data-act="add-custom">この時間で追加</button>
</div>`;
}
const dayShifts = [...shiftMap.entries()].filter(([k]) => k.endsWith("|" + ds))
.flatMap(([, v]) => v);
if (dayShifts.length) {
html += `<button type="button" class="btn-primary" id="btn-adm-cell-notify" style="margin-top:12px">${d.getMonth() + 1}月${d.getDate()}日の確定をスタッフに通知する</button>`;
}
box.innerHTML = html;
box.querySelectorAll("[data-confirm-req]").forEach((b) =>
b.addEventListener("click", async () => {
await DB.saveShift({ staff_id: s.id, date: ds, band: b.dataset.confirmReq, start_time: null, end_time: null});
toast(`${s.name}さんの${BAND[b.dataset.confirmReq].label}を確定しました`);
renderAdminEditor(); renderAdminDay();
}));
box.querySelectorAll("[data-add-band]").forEach((b) =>
b.addEventListener("click", async () => {
await DB.saveShift({ staff_id: s.id, date: ds, band: b.dataset.addBand, start_time: null, end_time: null});
toast(`${s.name}さんに${BAND[b.dataset.addBand].label}を追加しました`);
renderAdminEditor(); renderAdminDay();
}));
box.querySelectorAll("[data-shift]").forEach((rowEl) => {
const shiftId = rowEl.dataset.shift;
rowEl.querySelector('[data-act="save"]').addEventListener("click", async () => {
await DB.saveShift({ id: shiftId, start_time: readTimeSel(rowEl, "adm-st"), end_time: readTimeSel(rowEl, "adm-en")});
toast("保存しました");
renderAdminEditor(); renderAdminDay();
});
rowEl.querySelector('[data-act="del"]').addEventListener("click", async () => {
if (!confirm("このシフトを削除しますか？")) return;
await DB.deleteShift(shiftId);
toast("削除しました");
renderAdminEditor(); renderAdminDay();
});
});
const custom = box.querySelector(".adm-custom-row");
if (custom) {
const bandSel = custom.querySelector(".adm-new-band");
bandSel.addEventListener("change", () => {
setTimeSel(custom, "adm-new-st", BAND[bandSel.value].start);
setTimeSel(custom, "adm-new-en", BAND[bandSel.value].end);
});
custom.querySelector('[data-act="add-custom"]').addEventListener("click", async () => {
await DB.saveShift({ staff_id: s.id, date: ds, band: bandSel.value,
start_time: readTimeSel(custom, "adm-new-st"), end_time: readTimeSel(custom, "adm-new-en")});
toast(`${s.name}さんのシフトを追加しました`);
renderAdminEditor(); renderAdminDay();
});
}
const notifyBtn = box.querySelector("#btn-adm-cell-notify");
if (notifyBtn) notifyBtn.addEventListener("click", async () => {
const targets = [...new Set(dayShifts.map((x) => x.staff_id))];
const rows = targets.map((sid) => {
const ms = dayShifts.filter((x) => x.staff_id === sid)
.map((x) => `${BAND[x.band].label} ${x.start_time || BAND[x.band].start}–${x.end_time || BAND[x.band].end}`).join("、");
return { id: uid(), staff_id: sid, type: "shift_confirmed",
title: "シフトが確定しました",
body: `${d.getMonth() + 1}月${d.getDate()}日（${DOW[d.getDay()]}） ${ms} で確定しました。`,
created_at: new Date().toISOString()};
});
await DB.addNotifications(rows);
toast(`${targets.length}名に確定のお知らせを送りました`);
});
}
$("btn-adm-month-requests").addEventListener("click", async () => {
const { y, m} = admState;
const reqs = (await DB.listAllRequests(y, m)).filter((r) => r.status!== "rejected");
if (!reqs.length) { toast("今月の希望はありませんでした"); return;}
if (!confirm(`${m + 1}月の希望をすべて確定シフトに反映しますか？（すでに入っている分はそのままです）`)) return;
const shifts = await DB.listShifts(y, m);
const have = new Set(shifts.map((s) => s.staff_id + "|" + s.date + "|" + s.band));
const todo = reqs.filter((r) =>!have.has(r.staff_id + "|" + r.date + "|" + r.band));
for (const r of todo) {
await DB.saveShift({ staff_id: r.staff_id, date: r.date, band: r.band, start_time: null, end_time: null});
}
toast(todo.length? `${todo.length}件の希望を確定シフトに反映しました`: "希望はすべて反映済みでした");
renderAdminEditor(); renderAdminDay();
});

// ---------- 4. 給与一覧と個人明細 ----------
async function renderAdminPayrolls() {
const { y, m} = admState;
admPayrolls = [];
for (const s of STAFF) {
admPayrolls.push({ staff: s, p: await computePayroll(s, y, m)});
}
$("adm-pay-list").innerHTML = admPayrolls.map(({ staff: s, p}, i) =>
`<button type="button" class="adm-pay-row" data-pay-idx="${i}">
<span><span class="pname">${esc(s.name)}</span><br>
<span class="adm-pay-sub">支給 ${fmtYen(p.gross)}／控除 ${fmtYen(p.dedTotal)}／${p.days}日</span></span>
<span class="pnet">${fmtYen(p.net)}</span>
</button>`).join("");
$("adm-pay-list").querySelectorAll("[data-pay-idx]").forEach((b) =>
b.addEventListener("click", () => renderAdminPayDetail(Number(b.dataset.payIdx))));
if (admState.payDetailId) {
const idx = admPayrolls.findIndex((x) => x.staff.id === admState.payDetailId);
if (idx >= 0) renderAdminPayDetail(idx);
else { admState.payDetailId = null; $("adm-pay-detail").innerHTML = "";}
}
}
function renderAdminPayDetail(idx) {
const { staff: s, p} = admPayrolls[idx];
if (!s) return;
admState.payDetailId = s.id;
const row = (label, val) => `<tr><td>${esc(label)}</td><td class="num">${esc(val)}</td></tr>`;
$("adm-pay-detail").innerHTML = `
<div class="card" style="text-align:center">
<div style="font-size:1.2rem;font-weight:900">給料支払明細書（${admState.y}年${admState.m + 1}月分）</div>
<div style="font-size:1.05rem;font-weight:800;margin-top:4px">${esc(s.name)} 殿</div>
</div>
<div class="pay-hero">
<div class="label">差引支給額（お給料）</div>
<div class="amount">${fmtYen(p.net)}</div>
</div>
<div class="card"><h2>勤怠</h2><table class="pay-table">
${row("労働期間", p.period) + row("労働日数", `${p.days}日`) + row("労働時間", fmtHM(p.workMin)) + row("所定時間外労働", fmtHM(p.otMin))}
</table></div>
<div class="card"><h2>支給額</h2><table class="pay-table">
${p.earnings.map((e) => row(e.label, fmtYen(e.amount))).join("")}
<tr class="total"><td>支給合計</td><td class="num">${fmtYen(p.gross)}</td></tr>
</table></div>
<div class="card"><h2>控除額</h2><table class="pay-table">
${p.deductions.map((dd) => row(dd.label, fmtYen(dd.amount))).join("")}
<tr class="total"><td>控除合計</td><td class="num">${fmtYen(p.dedTotal)}</td></tr>
</table></div>`;
$("adm-pay-detail").scrollIntoView({ behavior: "smooth", block: "start"});
}

// ---------- 5. 税理士送付用の一括出力 ----------
const PAYROLL_CSV_COLS = ["氏名", "労働日数", "労働時間", "所定時間外労働",
"基本給", "役職手当", "深夜手当", "みなし残業", "交通費", "ドリンクバック",
"所定時間外賃金", "その他手当", "支給合計",
"健康保険料", "厚生年金", "雇用保険料", "所得税", "子ども・子育て支援金",
"前払金", "住民税", "控除合計", "差引支給額"];
function payrollCsvRow(s, p) {
const earn = (label) => { const e = p.earnings.find((x) => x.label === label); return e? e.amount: 0;};
const known = ["基本給", "役職手当", "深夜手当", "みなし残業", "交通費", "ドリンクバック", "所定時間外賃金"];
const other = p.earnings.filter((e) =>!known.includes(e.label)).reduce((a, e) => a + e.amount, 0);
const ded = (label) => { const d = p.deductions.find((x) => x.label === label); return d? d.amount: 0;};
return [s.name, p.days, fmtHM(p.workMin), fmtHM(p.otMin),
earn("基本給"), earn("役職手当"), earn("深夜手当"), earn("みなし残業"),
earn("交通費"), earn("ドリンクバック"), earn("所定時間外賃金"), other, p.gross,
ded("健康保険料"), ded("厚生年金"), ded("雇用保険料"), ded("所得税"),
ded("子ども・子育て支援金"), ded("前払金"), ded("住民税"), p.dedTotal, p.net];
}
function buildPayrollCsv() {
const escCsv = (v) => { const t = String(v); return /[",\n]/.test(t)? `"${t.replace(/"/g, '""')}"`: t;};
const lines = [PAYROLL_CSV_COLS.join(",")];
admPayrolls.forEach(({ staff: s, p}) => lines.push(payrollCsvRow(s, p).map(escCsv).join(",")));
return lines.join("\r\n");
}
function payrollAllText() {
const L = [`給与データ（${admState.y}年${admState.m + 1}月分）`, "株式会社H&Kグループ", ""];
admPayrolls.forEach(({ staff: s, p}) => {
L.push(`■ ${s.name}`);
L.push(`労働日数：${p.days}日／労働時間：${fmtHM(p.workMin)}／所定時間外労働：${fmtHM(p.otMin)}`);
p.earnings.forEach((e) => L.push(`${e.label}：${fmtYen(e.amount)}`));
L.push(`支給合計：${fmtYen(p.gross)}`);
p.deductions.forEach((d) => L.push(`${d.label}：${fmtYen(d.amount)}`));
L.push(`控除合計：${fmtYen(p.dedTotal)}`);
L.push(`差引支給額：${fmtYen(p.net)}`);
L.push("");
});
return L.join("\n");
}
$("btn-adm-csv").addEventListener("click", () => {
if (!admPayrolls.length) { toast("先に給与一覧を表示してね"); return;}
const blob = new Blob(["\uFEFF" + buildPayrollCsv()], { type: "text/csv;charset=utf-8"});
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = `給与データ_${admState.y}年${admState.m + 1}月分.csv`;
document.body.appendChild(a);
a.click();
a.remove();
setTimeout(() => URL.revokeObjectURL(a.href), 4000);
toast("CSVをダウンロードしました");
});
$("btn-adm-copy-all").addEventListener("click", async () => {
if (!admPayrolls.length) { toast("先に給与一覧を表示してね"); return;}
try { await navigator.clipboard.writeText(payrollAllText()); toast("全員分をコピーしました");}
catch (e) { toast("コピーできませんでした");}
});
$("btn-adm-share-all").addEventListener("click", async () => {
if (!admPayrolls.length) { toast("先に給与一覧を表示してね"); return;}
const text = payrollAllText();
if (navigator.share) {
try { await navigator.share({ title: "給与データ", text});} catch (e) { /* キャンセル時 */}
} else {
try { await navigator.clipboard.writeText(text); toast("共有機能がないためコピーしました");}
catch (e) { toast("共有できませんでした");}
}
});

// ---------- 6. 月の売上入力 ----------
async function renderAdminSales() {
const { y, m} = admState;
const cur = await DB.getMonthlySales(y, m);
$("adm-sales-current").textContent = cur == null? "未登録": fmtYen(cur);
if (document.activeElement!== $("adm-sales-input"))
$("adm-sales-input").value = cur == null? "": cur;
}
$("btn-adm-sales-save").addEventListener("click", async () => {
const raw = $("adm-sales-input").value;
const v = Number(raw);
if (raw === "" ||!Number.isFinite(v) || v < 0) { toast("売上（円）を数字で入れてね"); return;}
await DB.setMonthlySales(admState.y, admState.m, Math.round(v));
toast(`${admState.y}年${admState.m + 1}月の売上を登録しました`);
renderAdminSales();
renderAdminPayrolls(); // ノルマ判定が変わるため給与一覧も更新する
});

// ---------- 7. 打刻の訂正依頼への導線 ----------
$("btn-adm-goto-corrections").addEventListener("click", () => showView("inbox"));

// ============================================================
// 初期化
// ============================================================
if ("serviceWorker" in navigator) {
navigator.serviceWorker.register("sw.js").catch(() => {});
}
setupLogin();
restoreSession().then((ok) => { if (ok) setupPushUI();});
})();
