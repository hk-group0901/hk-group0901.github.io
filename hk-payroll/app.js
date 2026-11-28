/* ============================================================
H&Kグループ 給与アプリ（管理者専用・会社全体）
- 株式会社H&Kグループの給与計算専用アプリ。スタッフ用アプリとは
  完全に別のアプリとして独立している。
- データ連携：勤怠・シフト・スタッフ・月売上はスタッフ用アプリと
  同じ Supabase プロジェクトを読み書きする（同じアカウントで
  ログイン）。給与計算（computePayroll）はスタッフ用アプリと
  同一方式。計算方式を変えるときは両方のアプリをそろえて直すこと。
- 使えるのは role='admin'（神坂春貴）だけ。
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
// デモ用フラグ・デモDB・デモセッションの保存キーはスタッフ用アプリと
// 共通（同じ端末・同じドメインではデモデータもそのまま共有される）。
const forceDemo = localStorage.getItem("hk_payroll_force_demo") === "1";
const hasSupabase =!!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
const DEMO = forceDemo ||!hasSupabase;
// supabase-js の標準ストレージキーを使うため、createClient に
// 独自の storageKey は指定しない。これによりスタッフ用アプリと
// 同じドメインではログインセッションがそのまま引き継がれる。
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
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ============================================================
// デモデータ（スタッフ用アプリの app.js からそのまま移植）
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
localStorage.setItem("hk_payroll_demo_db", JSON.stringify(db));
return db;
}
function loadDemo() {
try {
const raw = localStorage.getItem("hk_payroll_demo_db");
if (raw) return JSON.parse(raw);
} catch (e) { /* ignore */}
return seedDemo();
}
let demoDB = DEMO? loadDemo(): null;
const saveDemo = () => { if (DEMO) localStorage.setItem("hk_payroll_demo_db", JSON.stringify(demoDB));};

// ============================================================
// データ層（demo / supabase の2実装）
// 給与計算に必要な読み取りと、月売上・調整項目の書き込みだけを持つ。
// 読み取り系はスタッフ用アプリの DB と同じ実装。
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
async myAttendanceMonth(staffId, y, m) {
const from = fmtDate(new Date(y, m, 1)), to = fmtDate(new Date(y, m + 1, 0));
if (DEMO) return demoDB.attendance.filter((a) => a.staff_id === staffId && a.date >= from && a.date <= to);
const { data} = await sb.from("attendance").select("*").eq("staff_id", staffId).gte("date", from).lte("date", to);
return data || [];
},
async listShifts(y, m) {
const from = fmtDate(new Date(y, m, 1)), to = fmtDate(new Date(y, m + 1, 0));
if (DEMO) return demoDB.shifts.filter((s) => s.date >= from && s.date <= to);
const { data} = await sb.from("shifts").select("*").gte("date", from).lte("date", to);
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
async listPendingImports() {
const { data } = await sb.from("profile_imports").select("*").eq("used", false).order("created_at", { ascending: false });
return data || [];
},
async markImportUsed(id) {
const { error } = await sb.from("profile_imports").update({ used: true }).eq("id", id);
return error || null;
},
async getStaffPrivate(staffId) {
const { data } = await sb.from("staff_private").select("*").eq("staff_id", staffId).maybeSingle();
return data || null;
},
async upsertStaffPrivate(staffId, myNumber) {
const { error } = await sb.from("staff_private").upsert({ staff_id: staffId, my_number: myNumber, updated_at: new Date().toISOString() }, { onConflict: "staff_id" });
return error || null;
},
async listAllStaff() {
if (DEMO) return demoDB.staff.slice();
const { data } = await sb.from("staff").select("*").order("sort_order");
return data || [];
},
async updateStaff(id, fields) {
if (DEMO) { const s = demoDB.staff.find((x) => x.id === id); if (s) Object.assign(s, fields); saveDemo(); return null; }
const { error } = await sb.from("staff").update(fields).eq("id", id);
return error || null;
},
async insertPayrollHistory(row) {
const { error } = await sb.from("payroll_history").insert(row);
return error || null;
},
async updatePayrollHistory(id, row) {
const { error } = await sb.from("payroll_history").update(row).eq("id", id);
return error || null;
},
async listPayrollHistoryAll() {
const { data } = await sb.from("payroll_history").select("*").order("month", { ascending: false }).order("name");
return data || [];
},
async deletePayrollHistory(id) {
const { error } = await sb.from("payroll_history").delete().eq("id", id);
return error || null;
},
async listPayrollHistory(y, m) {
// 過去の給与実績（以前の給料アプリから取り込んだ確定値）。payroll_history テーブル
if (DEMO) return [];
const monthStr = `${y}-${pad(m + 1)}-01`;
const { data } = await sb.from("payroll_history").select("*").eq("month", monthStr).order("net", { ascending: false });
return data || [];
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
},
async updateStaffFields(staffId, fields) {
// 手入力の調整項目の保存先は、スタッフ用アプリと同じ staff テーブル。
// ドリンクバック等の月次で変わる入力も、現行方式では staff の現在値
// （drink_back / other_allowances / resident_tax / advance_payment）を
// 書き換える。本番は RLS の staff_write_admin（管理者のみ）で許可される。
if (DEMO) {
const s = demoDB.staff.find((x) => x.id === staffId);
if (s) Object.assign(s, fields);
saveDemo(); return;
}
await sb.from("staff").update(fields).eq("id", staffId);
}
};

// ============================================================
// 給与計算（スタッフ用アプリの app.js からそのまま移植）
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

// ============================================================
// セッション（管理者だけが中身を見られる）
// ============================================================
let ME = null; // 自分の staff レコード
let STAFF = []; // 全スタッフ（kiosk行は除く）

// ---------- 画面切り替え（戻るボタンは前の画面へ） ----------
let curView = "home";
const navStack = [];
function activateView(name) {
curView = name;
document.querySelectorAll("#app-shell .view").forEach((v) =>
v.classList.toggle("active", v.id === "view-" + name));
window.scrollTo(0, 0);
}
function showMainView(name) {
if (name !== curView) navStack.push(curView);
activateView(name);
}
function goBack() {
activateView(navStack.pop() || "home");
}
document.querySelectorAll("[data-go]").forEach((b) =>
b.addEventListener("click", () => { navStack.length = 0; activateView("home"); if (b.dataset.go !== "home") showMainView(b.dataset.go); }));
document.querySelectorAll(".back-btn").forEach((b) =>
b.addEventListener("click", goBack));
document.querySelectorAll("[data-nav]").forEach((b) =>
b.addEventListener("click", () => showMainView(b.dataset.nav)));

async function enterApp() {
STAFF = (await DB.listStaff()).filter((s) => s.role!== "kiosk");
if (!ME || ME.role!== "admin") { showBlocked(); return; }
$("view-login").classList.remove("active");
$("view-login").style.display = "none";
$("view-blocked").classList.remove("active");
$("view-blocked").style.display = "none";
$("app-shell").style.display = "block";
const now = new Date();
const greet = now.getHours() < 11? "おはようございます": now.getHours() < 17? "こんにちは": "こんばんは";
$("hello-name").textContent = `${greet}、${ME.name}さん`;
$("hello-date").textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${DOW[now.getDay()]}）`;
await renderAll();
await renderHistory();
await renderSettings();
await refreshHistSide();
navStack.length = 0;
activateView("home");
}
function showBlocked() {
// 管理者以外には中身を一切出さない
$("view-login").classList.remove("active");
$("view-login").style.display = "none";
$("app-shell").style.display = "none";
$("view-blocked").style.display = "block";
$("view-blocked").classList.add("active");
if (ME) $("blocked-msg").textContent =
`${ME.name}さんのアカウントでは使えません。このアプリは管理者（神坂さん）専用です。`;
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
localStorage.setItem("hk_payroll_demo_session", ME.id);
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
if (ME && ME.role === "admin") toast("ログインしました");
} catch (err) {
toast("ログインできませんでした。入力を確認してね");
}
});
$("btn-demo-mode").addEventListener("click", () => {
localStorage.setItem("hk_payroll_force_demo", "1");
location.reload();
});
}

async function restoreSession() {
if (DEMO) {
const id = localStorage.getItem("hk_payroll_demo_session");
if (id) { ME = demoDB.staff.find((s) => s.id === id); if (ME) { await enterApp(); return true;}}
return false;
}
// スタッフ用アプリと同じドメイン・同じ Supabase プロジェクトのため、
// 標準ストレージキーのセッションがそのまま見つかる（ログイン引き継ぎ）。
const { data} = await sb.auth.getSession();
if (data.session) {
ME = await DB.staffByAuthUser(data.session.user.id);
if (ME) { await enterApp(); return true;}
}
return false;
}

async function doLogout() {
if (DEMO) localStorage.removeItem("hk_payroll_demo_session");
else await sb.auth.signOut();
location.reload();
}
$("btn-logout").addEventListener("click", doLogout);
$("btn-blocked-logout").addEventListener("click", doLogout);

// ============================================================
// 画面描画
// ============================================================
const view = { y: new Date().getFullYear(), m: new Date().getMonth()};
let payrolls = []; // [{ staff, p }] 表示中の月の全員分
let detailId = null; // 明細を表示中の staff.id

function shiftMonth(delta) {
view.m += delta;
if (view.m < 0) { view.m = 11; view.y--;}
if (view.m > 11) { view.m = 0; view.y++;}
}
$("pay-prev").addEventListener("click", async () => { shiftMonth(-1); await renderAll();});
$("pay-next").addEventListener("click", async () => { shiftMonth(1); await renderAll();});

async function renderAll() {
$("pay-month-title").textContent = `${view.y}年${view.m + 1}月分`;
await renderQuota();
await renderPayrolls();
await renderSales();
}

// ---------- ノルマ状況（山口・沼口） ----------
async function renderQuota() {
const card = $("quota-card");
const q = STAFF.find((s) => s.quota_wage);
if (!q) { card.style.display = "none"; return;}
const threshold = q.quota_threshold || 3000000;
const sales = await DB.getMonthlySales(view.y, view.m);
card.style.display = "block";
if (sales == null) {
$("quota-body").innerHTML =
`<div class="quota-sales">${view.m + 1}月の売上はまだ登録されていません</div>` +
`<div class="hint">ノルマは ${fmtYen(threshold)} です。下の「月の売上」で登録すると判定が出ます。</div>`;
return;
}
const achieved = sales > threshold;
const pct = Math.min(100, Math.floor((sales / threshold) * 100));
$("quota-body").innerHTML = achieved
? `<div class="quota-done">ノルマ達成！${view.m + 1}月は時給 ${fmtYen(q.quota_wage)}（深夜手当込み）</div>
<div class="quota-sales">${view.m + 1}月の売上 ${fmtYen(sales)}</div>
<div class="quota-bar"><div class="quota-fill done" style="width:100%"></div></div>`
: `<div class="quota-sales">${view.m + 1}月の売上 ${fmtYen(sales)}</div>
<div class="quota-rest">ノルマ ${fmtYen(threshold)} まで あと ${fmtYen(threshold - sales)}</div>
<div class="quota-bar"><div class="quota-fill" style="width:${pct}%"></div></div>
<div class="hint">${fmtYen(threshold)} を超えたら、${view.m + 1}月は時給 ${fmtYen(q.quota_wage)}（深夜手当込み）になります</div>`;
}

// ---------- 給与一覧 ----------
async function renderPayrolls() {
payrolls = [];
for (const s of STAFF) {
payrolls.push({ staff: s, p: await computePayroll(s, view.y, view.m)});
}
$("pay-list").innerHTML = payrolls.map(({ staff: s, p}, i) =>
`<button type="button" class="adm-pay-row" data-pay-idx="${i}">
<span><span class="pname">${esc(s.name)}</span><br>
<span class="adm-pay-sub">${p.days}日／${fmtHM(p.workMin)}／支給 ${fmtYen(p.gross)}／控除 ${fmtYen(p.dedTotal)}</span></span>
<span class="pnet">${fmtYen(p.net)}</span>
</button>`).join("");
$("pay-list").querySelectorAll("[data-pay-idx]").forEach((b) =>
b.addEventListener("click", () => renderDetail(Number(b.dataset.payIdx))));
const tGross = payrolls.reduce((a, x) => a + x.p.gross, 0);
const tDed = payrolls.reduce((a, x) => a + x.p.dedTotal, 0);
const tNet = payrolls.reduce((a, x) => a + x.p.net, 0);
const tKara = payrolls.filter((x) => shopGroup(x.staff.shop_name || x.staff.shop) === "kara").reduce((a, x) => a + x.p.gross, 0);
const tBar = payrolls.filter((x) => shopGroup(x.staff.shop_name || x.staff.shop) === "bar").reduce((a, x) => a + x.p.gross, 0);
$("pay-totals").innerHTML =
`<div class="t-row"><span>支給（辛麺屋 物語）</span><span>${fmtYen(tKara)}</span></div>` +
`<div class="t-row"><span>支給（BAR OK ROCK）</span><span>${fmtYen(tBar)}</span></div>` +
`<div class="t-row"><span>支給合計（全員）</span><span>${fmtYen(tGross)}</span></div>` +
`<div class="t-row"><span>控除合計（全員）</span><span>${fmtYen(tDed)}</span></div>` +
`<div class="t-row t-net"><span>差引支給額（全員）</span><span>${fmtYen(tNet)}</span></div>`;
if (detailId) {
const idx = payrolls.findIndex((x) => x.staff.id === detailId);
if (idx >= 0) renderDetail(idx);
else { detailId = null; $("pay-detail").innerHTML = "";}
}
}

// ---------- 個人明細 ----------
function remarksFor(s, p) {
const lines = [`所属店舗：${esc(s.shop_name || "辛麺屋 物語 中町本店")}`];
if (p.crossPay > 0) lines.push(`辛麺屋出勤手当 ${fmtYen(p.crossRate)} × ${p.crossDays}日分を、所定時間外賃金として加算しています。`);
if (p.payType === "salary") lines.push(`社員（月給制）のため、固定給（基本給＋各種手当）で計算しています。`);
if (p.quotaState === "achieved") lines.push(`今月はノルマ達成のため、時給${fmtYen(p.wage)}（深夜手当込み）で計算しています。`);
else if (p.quotaState === "missed") lines.push(`今月の売上はノルマ未達のため、通常時給＋深夜割増で計算しています。`);
else if (p.quotaState === "unknown") lines.push(`今月の売上がまだ集計されていないため、通常時給で仮計算しています。`);
else if (p.nightIncluded) lines.push(`時給は深夜手当込みのため、深夜割増は上乗せしていません。`);
lines.push(`所得税・社会保険料は概算です。`);
return lines;
}
function renderDetail(idx) {
const { staff: s, p} = payrolls[idx];
if (!s) return;
detailId = s.id;
const row = (label, val) => `<tr><td>${esc(label)}</td><td class="num">${esc(val)}</td></tr>`;
const others = (s.other_allowances || []).map((o, i) =>
`<div class="adj-other-row">
<input type="text" data-other-label="${i}" value="${esc(o.label)}" placeholder="手当の名前">
<input type="number" data-other-amount="${i}" value="${o.amount}" min="0" step="1" inputmode="numeric" placeholder="金額">
<button type="button" class="btn-mini danger" data-other-del="${i}">削除</button>
</div>`).join("");
$("pay-detail").innerHTML = `
<div class="card" style="text-align:center">
<div style="font-size:1.2rem;font-weight:900">給料支払明細書（${view.y}年${view.m + 1}月分）</div>
<div style="font-size:1.05rem;font-weight:800;margin-top:4px">${esc(s.name)} 殿</div>
</div>
<div class="pay-hero">
<div class="label">差引支給額（お給料）</div>
<div class="amount">${fmtYen(p.net)}</div>
<div class="hint">支払予定日：${view.m + 2 > 12? 1: view.m + 2}月${PR.payDay}日</div>
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
</table></div>
<div class="card"><h2>備考</h2>
<div class="hint">${remarksFor(s, p).join("<br>")}</div>
<div class="pay-actions">
<button class="btn-share" id="d-copy" type="button">明細をコピー</button>
<button class="btn-share alt" id="d-share" type="button">共有する</button>
</div>
<button class="btn-ghost" id="d-print" type="button">明細を印刷・PDFにする</button>
<p class="hint" style="text-align:center;margin-top:10px">株式会社H&Kグループ</p>
</div>
<div class="card"><h2>調整項目の入力（${esc(s.name)}）</h2>
<div class="field">
<label for="adj-drink">ドリンクバック（円）</label>
<input id="adj-drink" type="number" inputmode="numeric" min="0" step="1" value="${s.drink_back || 0}">
</div>
<div class="field">
<label for="adj-resident">住民税（円）</label>
<input id="adj-resident" type="number" inputmode="numeric" min="0" step="1" value="${s.resident_tax || 0}">
</div>
<div class="field">
<label for="adj-advance">前払金（円）</label>
<input id="adj-advance" type="number" inputmode="numeric" min="0" step="1" value="${s.advance_payment || 0}">
</div>
<div class="field">
<label>その他手当</label>
<div id="adj-others">${others}</div>
<button class="btn-mini accent" id="btn-adj-add" type="button">＋ その他手当を追加</button>
</div>
<button class="btn-primary" id="btn-adj-save" type="button">調整項目を保存する</button>
<p class="hint" style="margin-top:10px">
調整項目はスタッフ用アプリと同じ staff テーブルに保存され、給与計算が使う現在値です。
ドリンクバックは月ごとに変わるので、その月の金額に書き換えてください（過去の月の計算にも同じ値が使われる現行方式です）。
</p>
</div>`;
$("pay-detail").scrollIntoView({ behavior: "smooth", block: "start"});
$("d-copy").addEventListener("click", async () => {
try { await navigator.clipboard.writeText(payslipTextFor(s, p)); toast("明細をコピーしました");}
catch (e) { toast("コピーできませんでした");}
});
$("d-share").addEventListener("click", async () => {
const text = payslipTextFor(s, p);
if (navigator.share) {
try { await navigator.share({ title: "給料支払明細書", text});} catch (e) { /* キャンセル時 */}
} else {
try { await navigator.clipboard.writeText(text); toast("共有機能がないためコピーしました");}
catch (e) { toast("共有できませんでした");}
}
});
$("d-print").addEventListener("click", () => printPayslip(s, p));
$("btn-adj-add").addEventListener("click", () => {
const cur = collectOthers();
cur.push({ label: "", amount: 0 });
s.other_allowances = cur;
renderDetail(idx);
});
$("pay-detail").querySelectorAll("[data-other-del]").forEach((b) =>
b.addEventListener("click", () => {
const cur = collectOthers();
cur.splice(Number(b.dataset.otherDel), 1);
s.other_allowances = cur;
renderDetail(idx);
}));
$("btn-adj-save").addEventListener("click", async () => {
const num = (id) => {
const v = Number($(id).value);
return Number.isFinite(v) && v > 0? Math.round(v): 0;
};
const fields = {
drink_back: num("adj-drink"),
resident_tax: num("adj-resident"),
advance_payment: num("adj-advance"),
other_allowances: collectOthers().filter((o) => o.label !== "" || o.amount > 0)
};
await DB.updateStaffFields(s.id, fields);
Object.assign(s, fields);
toast(`${s.name}さんの調整項目を保存しました`);
await renderPayrolls(); // 金額が変わるため一覧・明細を再計算する
});
}
function collectOthers() {
// その他手当の入力行を [{label, amount}] に集める
const labels = $("pay-detail").querySelectorAll("[data-other-label]");
const amounts = $("pay-detail").querySelectorAll("[data-other-amount]");
const out = [];
labels.forEach((el, i) => {
const amount = Number(amounts[i].value);
out.push({ label: el.value.trim(), amount: Number.isFinite(amount) && amount > 0? Math.round(amount): 0});
});
return out;
}
function payslipTextFor(s, p) {
const L = [];
L.push(`給料支払明細書（${view.y}年${view.m + 1}月分）`);
L.push(`${s.name} 殿`);
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
L.push(`備考：所属店舗 ${s.shop_name || "辛麺屋 物語 中町本店"}`);
L.push("株式会社H&Kグループ");
return L.join("\n");
}
function printPayslip(s, p) {
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
<h1>給料支払明細書（${view.y}年${view.m + 1}月分）</h1>
<div class="name">${esc(s.name)} 殿</div>
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
<div>備考：所属店舗 ${esc(s.shop_name || "辛麺屋 物語 中町本店")}／所得税・社会保険料は概算です</div>
<div class="foot">株式会社H&Kグループ</div>
<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script>
</body></html>`);
w.document.close();
}

// ---------- 税理士送付用の一括出力 ----------
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
payrolls.forEach(({ staff: s, p}) => lines.push(payrollCsvRow(s, p).map(escCsv).join(",")));
return lines.join("\r\n");
}
function payrollAllText() {
const L = [`給与データ（${view.y}年${view.m + 1}月分）`, "株式会社H&Kグループ", ""];
payrolls.forEach(({ staff: s, p}) => {
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
$("btn-csv").addEventListener("click", () => {
if (!payrolls.length) { toast("先に給与一覧を表示してね"); return;}
const blob = new Blob(["\uFEFF" + buildPayrollCsv()], { type: "text/csv;charset=utf-8"});
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = `給与データ_${view.y}年${view.m + 1}月分.csv`;
document.body.appendChild(a);
a.click();
a.remove();
setTimeout(() => URL.revokeObjectURL(a.href), 4000);
toast("CSVをダウンロードしました");
});
$("btn-copy-all").addEventListener("click", async () => {
if (!payrolls.length) { toast("先に給与一覧を表示してね"); return;}
try { await navigator.clipboard.writeText(payrollAllText()); toast("全員分をコピーしました");}
catch (e) { toast("コピーできませんでした");}
});
$("btn-share-all").addEventListener("click", async () => {
if (!payrolls.length) { toast("先に給与一覧を表示してね"); return;}
const text = payrollAllText();
if (navigator.share) {
try { await navigator.share({ title: "給与データ", text});} catch (e) { /* キャンセル時 */}
} else {
try { await navigator.clipboard.writeText(text); toast("共有機能がないためコピーしました");}
catch (e) { toast("共有できませんでした");}
}
});

// ---------- 月の売上入力 ----------
async function renderSales() {
const cur = await DB.getMonthlySales(view.y, view.m);
$("sales-current").textContent = cur == null? "未登録": fmtYen(cur);
if (document.activeElement!== $("sales-input"))
$("sales-input").value = cur == null? "": cur;
}
$("btn-sales-save").addEventListener("click", async () => {
const raw = $("sales-input").value;
const v = Number(raw);
if (raw === "" ||!Number.isFinite(v) || v < 0) { toast("売上（円）を数字で入れてね"); return;}
await DB.setMonthlySales(view.y, view.m, Math.round(v));
toast(`${view.y}年${view.m + 1}月の売上を登録しました`);
await renderQuota();
await renderPayrolls(); // ノルマ判定が変わるため給与一覧も更新する
await renderSales();
});

// ============================================================
// 過去の給与実績（取り込み済みの確定明細）
// ============================================================
const hist = { y: 2026, m: 9 }; // 取り込み最終月（2026年10月）から表示
let histRows = [];
async function renderHistory() {
const card = $("hist-card");
if (DEMO) { card.style.display = "none"; return; }
$("hist-month-title").textContent = `${hist.y}年${hist.m + 1}月分`;
histRows = await DB.listPayrollHistory(hist.y, hist.m);
$("hist-detail").innerHTML = "";
if (!histRows.length) {
$("hist-list").innerHTML = `<p class="hint">この月の実績データはありません。</p>`;
$("hist-totals").innerHTML = "";
return;
}
$("hist-list").innerHTML = histRows.map((r, i) =>
`<button type="button" class="adm-pay-row" data-hist-idx="${i}">
<span><span class="pname">${esc(r.name)}</span><br>
<span class="adm-pay-sub">${esc(r.shop || "")}／支給 ${fmtYen(r.gross)}／控除 ${fmtYen(r.ded_total)}</span></span>
<span class="pnet">${fmtYen(r.net)}</span>
</button>`).join("");
$("hist-list").querySelectorAll("[data-hist-idx]").forEach((b) =>
b.addEventListener("click", () => renderHistDetail(Number(b.dataset.histIdx))));
const tG = histRows.reduce((a, r) => a + r.gross, 0);
const tD = histRows.reduce((a, r) => a + r.ded_total, 0);
const tN = histRows.reduce((a, r) => a + r.net, 0);
const tGK = histRows.filter((r) => shopGroup(r.shop) === "kara").reduce((a, r) => a + r.gross, 0);
const tGB = histRows.filter((r) => shopGroup(r.shop) === "bar").reduce((a, r) => a + r.gross, 0);
$("hist-totals").innerHTML =
`<div class="t-row"><span>支給（辛麺屋 物語）</span><span>${fmtYen(tGK)}</span></div>` +
`<div class="t-row"><span>支給（BAR OK ROCK）</span><span>${fmtYen(tGB)}</span></div>` +
`<div class="t-row"><span>支給合計（全員）</span><span>${fmtYen(tG)}</span></div>` +
`<div class="t-row"><span>控除合計（全員）</span><span>${fmtYen(tD)}</span></div>` +
`<div class="t-row t-net"><span>差引支給額（全員）</span><span>${fmtYen(tN)}</span></div>`;
}
function histTextFor(r) {
const L = [];
L.push(`給料支払明細書（${hist.y}年${hist.m + 1}月分）`);
L.push(`${r.name} 殿`);
L.push("");
L.push(`労働日数：${r.days == null? "―": `${r.days}日`}／労働時間：${r.work_min == null? "―": fmtHM(r.work_min)}／所定時間外労働：${r.ot_min == null? "―": fmtHM(r.ot_min)}`);
L.push("");
Object.entries(r.pay || {}).forEach(([k, v]) => L.push(`${k}：${fmtYen(v)}`));
L.push(`支給合計：${fmtYen(r.gross)}`);
L.push("");
Object.entries(r.ded || {}).forEach(([k, v]) => L.push(`${k}：${fmtYen(v)}`));
L.push(`控除合計：${fmtYen(r.ded_total)}`);
L.push(`差引支給額：${fmtYen(r.net)}`);
L.push(`備考：所属 ${r.shop || "―"}${r.note? `／${r.note}`: ""}`);
L.push("株式会社H&Kグループ");
return L.join("\n");
}
function printHistSlip(r) {
const w = window.open("", "_blank");
if (!w) { toast("ポップアップがブロックされました"); return; }
const trs = (obj, totalLabel, total) =>
Object.entries(obj || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${fmtYen(v)}</td></tr>`).join("") +
`<tr class="total"><td>${totalLabel}</td><td class="num">${fmtYen(total)}</td></tr>`;
const lastDay = new Date(hist.y, hist.m + 1, 0).getDate();
w.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<title>給料支払明細書</title><style>
@page{size:A4 portrait;margin:14mm}
body{font-family:"Hiragino Sans","Noto Sans JP",sans-serif;color:#222;font-size:13px}
h1{font-size:19px;text-align:center;margin:0 0 4px}
.name{font-size:15px;font-weight:700;margin:10px 0}
table{width:100%;border-collapse:collapse;margin:8px 0 14px}
th,td{border:1px solid #888;padding:5px 8px}
th{background:#F2F2F2;text-align:left}
td.num{text-align:right}
tr.total td{font-weight:800;background:#F2F2F2}
h2{font-size:14px;margin:14px 0 4px;border-left:5px solid #111;padding-left:8px}
.net{text-align:center;border:2px solid #222;padding:12px;margin:16px 0}
.net .amt{font-size:26px;font-weight:900}
.foot{text-align:right;margin-top:24px;font-weight:700}
</style></head><body>
<h1>給料支払明細書（${hist.y}年${hist.m + 1}月分）</h1>
<div class="name">${esc(r.name)} 殿</div>
<h2>勤怠</h2>
<table>
<tr><th>労働期間</th><td>${hist.y}年${hist.m + 1}月1日 ～ ${hist.y}年${hist.m + 1}月${lastDay}日</td><th>労働日数</th><td>${r.days == null? "―": `${r.days}日`}</td></tr>
<tr><th>労働時間</th><td>${r.work_min == null? "―": fmtHM(r.work_min)}</td><th>所定時間外労働</th><td>${r.ot_min == null? "―": fmtHM(r.ot_min)}</td></tr>
</table>
<h2>支給額</h2>
<table>${trs(r.pay, "支給合計", r.gross)}</table>
<h2>控除額</h2>
<table>${trs(r.ded, "控除合計", r.ded_total)}</table>
<div class="net">差引支給額　<span class="amt">${fmtYen(r.net)}</span></div>
<div>備考：所属 ${esc(r.shop || "―")}${r.note? `／${esc(r.note)}`: ""}</div>
<div class="foot">株式会社H&Kグループ</div>
<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script>
</body></html>`);
w.document.close();
}
async function shareText(title, text) {
if (navigator.share) {
try { await navigator.share({ title, text }); } catch (e) { /* キャンセル時は何もしない */ }
} else {
try { await navigator.clipboard.writeText(text); toast("共有機能がないためコピーしました"); }
catch (e) { toast("共有できませんでした"); }
}
}
function buildHistCsv() {
const payLabels = [], dedLabels = [];
histRows.forEach((r) => {
Object.keys(r.pay || {}).forEach((k) => { if (!payLabels.includes(k)) payLabels.push(k); });
Object.keys(r.ded || {}).forEach((k) => { if (!dedLabels.includes(k)) dedLabels.push(k); });
});
const cols = ["氏名", "所属", "労働日数", "労働時間", "所定時間外労働",
...payLabels.map((k) => `支給:${k}`), "支給合計", ...dedLabels.map((k) => `控除:${k}`), "控除合計", "差引支給額", "備考"];
const escCsv = (v) => `"${String(v == null? "": v).replace(/"/g, '""')}"`;
const lines = [cols.join(",")];
histRows.forEach((r) => {
const row = [r.name, r.shop || "", r.days == null? "": r.days, r.work_min == null? "": fmtHM(r.work_min), r.ot_min == null? "": fmtHM(r.ot_min),
...payLabels.map((k) => (r.pay || {})[k] == null? "": (r.pay || {})[k]), r.gross,
...dedLabels.map((k) => (r.ded || {})[k] == null? "": (r.ded || {})[k]), r.ded_total, r.net, r.note || ""];
lines.push(row.map(escCsv).join(","));
});
return lines.join("\r\n");
}
$("btn-hist-csv").addEventListener("click", () => {
if (!histRows.length) { toast("この月の実績がありません"); return; }
const blob = new Blob(["\uFEFF" + buildHistCsv()], { type: "text/csv;charset=utf-8" });
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = `給与実績_${hist.y}年${hist.m + 1}月分.csv`;
a.click();
URL.revokeObjectURL(a.href);
toast("CSVを出しました");
});
$("btn-hist-copy").addEventListener("click", async () => {
if (!histRows.length) { toast("この月の実績がありません"); return; }
const text = histRows.map((r) => histTextFor(r)).join("\n\n--------------------\n\n");
try { await navigator.clipboard.writeText(text); toast("全員分をコピーしました"); }
catch (e) { toast("コピーできませんでした"); }
});
$("btn-hist-share").addEventListener("click", async () => {
if (!histRows.length) { toast("この月の実績がありません"); return; }
const text = histRows.map((r) => histTextFor(r)).join("\n\n--------------------\n\n");
await shareText("給与実績", text);
});

function renderHistDetail(idx) {
const r = histRows[idx];
if (!r) return;
const row = (label, val) => `<tr><td>${esc(label)}</td><td class="num">${esc(val)}</td></tr>`;
const items = (obj) => Object.entries(obj || {}).map(([k, v]) => row(k, fmtYen(v))).join("");
$("hist-detail").innerHTML = `
<div class="card">
<div style="text-align:center">
<div style="font-size:1.2rem;font-weight:900">給料支払明細書（${hist.y}年${hist.m + 1}月分・実績）</div>
<div style="font-size:1.05rem;font-weight:800;margin-top:4px">${esc(r.name)} 殿</div>
<div style="font-size:1.3rem;font-weight:900;margin-top:8px">差引支給額 ${fmtYen(r.net)}</div>
</div>
<h2 style="margin-top:16px">勤怠</h2>
<table class="pay-table">
${row("労働日数", r.days == null? "―": `${r.days}日`)}
${row("労働時間", r.work_min == null? "―": fmtHM(r.work_min))}
${row("所定時間外労働", r.ot_min == null? "―": fmtHM(r.ot_min))}
</table>
<h2 style="margin-top:16px">支給額</h2>
<table class="pay-table">
${items(r.pay)}
<tr class="total"><td>支給合計</td><td class="num">${fmtYen(r.gross)}</td></tr>
</table>
<h2 style="margin-top:16px">控除額</h2>
<table class="pay-table">
${items(r.ded)}
<tr class="total"><td>控除合計</td><td class="num">${fmtYen(r.ded_total)}</td></tr>
</table>
${r.note? `<p class="hint" style="margin-top:10px">備考：${esc(r.note)}</p>`: ""}
<div class="pay-actions">
<button class="btn-share" id="hist-copy" type="button">明細をコピー</button>
<button class="btn-share alt" id="hist-share" type="button">共有する</button>
</div>
<button class="btn-ghost" id="hist-print" type="button" style="width:100%">明細を印刷・PDFにする</button>
<div class="pay-actions">
<button class="btn-share" id="hist-edit" type="button">編集する</button>
<button class="btn-share alt" id="hist-del" type="button">削除する</button>
</div>
<button class="btn-ghost" id="hist-close" type="button" style="width:100%;margin-top:12px">閉じる</button>
</div>`;
$("hist-close").addEventListener("click", () => { $("hist-detail").innerHTML = ""; });
$("hist-copy").addEventListener("click", async () => {
try { await navigator.clipboard.writeText(histTextFor(r)); toast("明細をコピーしました"); }
catch (e) { toast("コピーできませんでした"); }
});
$("hist-share").addEventListener("click", () => shareText("給料支払明細書", histTextFor(r)));
$("hist-print").addEventListener("click", () => printHistSlip(r));
$("hist-edit").addEventListener("click", () => { showMainView("manual"); openManualForm(r); });
$("hist-del").addEventListener("click", async () => {
if (!confirm(`${r.name}さんの${hist.y}年${hist.m + 1}月分の実績を削除しますか？`)) return;
const err = await DB.deletePayrollHistory(r.id);
if (err) { toast("削除できませんでした"); return; }
toast("削除しました");
await renderHistory();
await refreshHistSide();
});
$("hist-detail").scrollIntoView({ behavior: "smooth", block: "start" });
}
function shiftHist(delta) {
hist.m += delta;
if (hist.m < 0) { hist.m = 11; hist.y--; }
if (hist.m > 11) { hist.m = 0; hist.y++; }
}
$("hist-prev").addEventListener("click", async () => { shiftHist(-1); await renderHistory(); });
$("hist-next").addEventListener("click", async () => { shiftHist(1); await renderHistory(); });

// ============================================================
// 従業員ページ・賃金台帳・給料の合計
// ============================================================
let histAll = [];
const normName = (n) => (n || "").replace(/\s/g, "");
async function refreshHistSide() {
if (DEMO) { $("people-card").style.display = "none"; $("summary-card").style.display = "none"; document.querySelectorAll(".real-only").forEach((el) => { el.style.display = "none"; }); renderMonths(); renderSlipMonths(); return; }
histAll = await DB.listPayrollHistoryAll();
renderPeople();
renderSummary();
renderMonths();
renderSlipMonths();
}
function peopleIndex() {
const map = new Map();
(allStaff || []).forEach((s) => {
if (s.role === "kiosk") return;
map.set(normName(s.name), { key: normName(s.name), name: s.name, staff: s, rows: [], latest: "" });
});
histAll.forEach((r) => {
const k = normName(r.name);
if (!map.has(k)) map.set(k, { key: k, name: r.name, staff: null, rows: [], latest: "" });
const p = map.get(k);
p.rows.push(r);
if (r.month > p.latest) { p.latest = r.month; p.name = p.staff? p.staff.name: r.name; }
});
const arr = [...map.values()];
arr.sort((a, b) => {
const ao = a.staff? a.staff.sort_order: 999, bo = b.staff? b.staff.sort_order: 999;
if (ao !== bo) return ao - bo;
return b.latest.localeCompare(a.latest);
});
return arr;
}
// 実績のみに名前がある人のうち、現役と分かっている人（神坂さん確認 2026-11-28）
const CURRENT_EXTRA = { "野々口隼斗": "現役（BAR・週末）", "野々口隼人": "現役（BAR・週末）", "黒崎海斗": "現役（BAR・週末）", "黒崎かいと": "現役（BAR・週末）" };
function personBadge(p) {
if (p.staff) return p.staff.active === false? "退職": "在籍中";
return CURRENT_EXTRA[normName(p.name)] || "過去のスタッフ";
}
function personDept(p) {
if (p.staff) return shopGroup(p.staff.shop_name || p.staff.shop);
let kara = 0, bar = 0;
p.rows.forEach((r) => { const g = shopGroup(r.shop); if (g === "kara") kara++; else if (g === "bar") bar++; });
return bar > kara? "bar": kara > 0? "kara": "other";
}
function renderPeople() {
const arr = peopleIndex();
const groups = { kara: [], bar: [], other: [] };
arr.forEach((p, i) => groups[personDept(p)].push([p, i]));
$("people-list").innerHTML = ["kara", "bar", "other"].map((g) => {
if (!groups[g].length) return "";
return `<h3 class="sec-label">${DEPT_LABEL[g]}</h3>` + groups[g].map(([p, i]) => {
const last = p.rows[0];
return `<button type="button" class="adm-pay-row" data-people-idx="${i}">
<span><span class="pname">${esc(p.name)}</span> <span class="badge-mini">${personBadge(p)}</span><br>
<span class="adm-pay-sub">${p.rows.length? `明細 ${p.rows.length}件／直近 ${p.latest.slice(0, 4)}年${Number(p.latest.slice(5, 7))}月 差引 ${fmtYen(last? last.net: 0)}`: "過去の明細なし"}</span></span>
<span class="pnet" style="font-size:1rem;color:var(--ink)">›</span>
</button>`;
}).join("");
}).join("") || `<p class="hint">従業員がいません。</p>`;
$("people-list").querySelectorAll("[data-people-idx]").forEach((b) =>
b.addEventListener("click", () => renderPerson(arr[Number(b.dataset.peopleIdx)])));
}
function ledgerCsv(p) {
const escCsv = (v) => `"${String(v == null? "": v).replace(/"/g, '""')}"`;
const lines = [["氏名", "年月", "労働日数", "労働時間", "所定時間外労働", "支給合計", "控除合計", "差引支給額"].join(",")];
[...p.rows].sort((a, b) => a.month.localeCompare(b.month)).forEach((r) => {
lines.push([p.name, `${r.month.slice(0, 4)}年${Number(r.month.slice(5, 7))}月`, r.days == null? "": r.days,
r.work_min == null? "": fmtHM(r.work_min), r.ot_min == null? "": fmtHM(r.ot_min), r.gross, r.ded_total, r.net].map(escCsv).join(","));
});
return lines.join("\r\n");
}
function printLedger(p) {
const w = window.open("", "_blank");
if (!w) { toast("ポップアップがブロックされました"); return; }
const rows = [...p.rows].sort((a, b) => a.month.localeCompare(b.month));
const trs = rows.map((r) =>
`<tr><td>${r.month.slice(0, 4)}年${Number(r.month.slice(5, 7))}月</td><td class="num">${r.days == null? "―": `${r.days}日`}</td><td class="num">${r.work_min == null? "―": fmtHM(r.work_min)}</td><td class="num">${r.ot_min == null? "―": fmtHM(r.ot_min)}</td><td class="num">${fmtYen(r.gross)}</td><td class="num">${fmtYen(r.ded_total)}</td><td class="num">${fmtYen(r.net)}</td></tr>`).join("");
const tG = rows.reduce((a, r) => a + r.gross, 0), tD = rows.reduce((a, r) => a + r.ded_total, 0), tN = rows.reduce((a, r) => a + r.net, 0);
w.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<title>賃金台帳</title><style>
@page{size:A4 landscape;margin:12mm}
body{font-family:"Hiragino Sans","Noto Sans JP",sans-serif;color:#222;font-size:12px}
h1{font-size:18px;text-align:center;margin:0 0 10px}
.name{font-size:14px;font-weight:700;margin:8px 0}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #888;padding:5px 8px}
th{background:#F2F2F2}
td.num{text-align:right}
tr.total td{font-weight:800;background:#F2F2F2}
.foot{text-align:right;margin-top:20px;font-weight:700}
</style></head><body>
<h1>賃金台帳</h1>
<div class="name">${esc(p.name)} 殿</div>
<table>
<tr><th>年月</th><th>労働日数</th><th>労働時間</th><th>所定時間外</th><th>支給合計</th><th>控除合計</th><th>差引支給額</th></tr>
${trs}
<tr class="total"><td>合計</td><td></td><td></td><td></td><td class="num">${fmtYen(tG)}</td><td class="num">${fmtYen(tD)}</td><td class="num">${fmtYen(tN)}</td></tr>
</table>
<div class="foot">株式会社H&Kグループ</div>
<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script>
</body></html>`);
w.document.close();
}
function renderPerson(p) {
if (!p) return;
const rows = [...p.rows].sort((a, b) => b.month.localeCompare(a.month));
const tG = rows.reduce((a, r) => a + r.gross, 0), tD = rows.reduce((a, r) => a + r.ded_total, 0), tN = rows.reduce((a, r) => a + r.net, 0);
$("person-detail").innerHTML = `
<div class="card" style="margin-top:16px">
<h2>${esc(p.name)} <span class="badge-mini">${personBadge(p)}</span></h2>
${p.staff? `<p class="hint">${esc(p.staff.shop_name || "")}${p.staff.employment_type? `／${esc(p.staff.employment_type)}`: ""}${p.staff.position_title? `／${esc(p.staff.position_title)}`: ""}／入社日：${p.staff.hire_date || "未登録"}${p.staff.retire_date? `／退職日：${p.staff.retire_date}`: ""}${p.staff.job_type? `／${esc(p.staff.job_type)}`: ""}${p.staff.profile_note? `／${esc(p.staff.profile_note)}`: ""}</p>`: ""}
<div class="pay-totals">
<div class="t-row"><span>期間の支給合計（${rows.length}件）</span><span>${fmtYen(tG)}</span></div>
<div class="t-row"><span>期間の控除合計</span><span>${fmtYen(tD)}</span></div>
<div class="t-row t-net"><span>期間の差引合計</span><span>${fmtYen(tN)}</span></div>
</div>
<h3 class="form-h">月ごとの明細（賃金台帳）</h3>
${rows.map((r) =>
`<button type="button" class="adm-pay-row" data-prow="${r.id}">
<span><span class="pname">${r.month.slice(0, 4)}年${Number(r.month.slice(5, 7))}月分</span><br>
<span class="adm-pay-sub">${r.days == null? "": `${r.days}日／`}${r.work_min == null? "": fmtHM(r.work_min)}／支給 ${fmtYen(r.gross)}</span></span>
<span class="pnet">${fmtYen(r.net)}</span>
</button>`).join("") || `<p class="hint">過去の明細はまだありません。</p>`}
<div class="pay-actions">
<button class="btn-share" id="person-print" type="button">台帳を印刷・PDF</button>
<button class="btn-share alt" id="person-csv" type="button">台帳CSVを出す</button>
</div>
${p.staff? `<button class="btn-ghost" id="person-settings" type="button" style="width:100%">この人の設定を開く</button>`: ""}
<button class="btn-ghost" id="person-close" type="button" style="width:100%;margin-top:10px">閉じる</button>
</div>`;
$("person-detail").querySelectorAll("[data-prow]").forEach((b) =>
b.addEventListener("click", async () => {
const r = rows.find((x) => x.id === b.dataset.prow);
if (!r) return;
hist.y = Number(r.month.slice(0, 4)); hist.m = Number(r.month.slice(5, 7)) - 1;
await renderHistory();
const idx = histRows.findIndex((x) => x.id === r.id);
if (idx >= 0) { showMainView("history"); renderHistDetail(idx); setTimeout(() => $("hist-detail").scrollIntoView({ behavior: "smooth", block: "start" }), 60); }
}));
$("person-print").addEventListener("click", () => printLedger(p));
$("person-csv").addEventListener("click", () => {
const blob = new Blob(["\uFEFF" + ledgerCsv(p)], { type: "text/csv;charset=utf-8" });
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = `賃金台帳_${p.name}.csv`;
a.click();
URL.revokeObjectURL(a.href);
toast("CSVを出しました");
});
const setBtn = $("person-settings");
if (setBtn) setBtn.addEventListener("click", () => {
const idx = allStaff.findIndex((x) => x.id === p.staff.id);
if (idx >= 0) { showMainView("settings"); renderSettingsForm(idx); }
});
$("person-close").addEventListener("click", () => { $("person-detail").innerHTML = ""; });
$("person-detail").scrollIntoView({ behavior: "smooth", block: "start" });
}
function shopGroup(shop) {
const t = String(shop || "");
if (t.includes("BAR")) return "bar";
if (t.includes("辛麺")) return "kara";
return "other";
}
const DEPT_LABEL = { kara: "辛麺屋 物語", bar: "BAR OK ROCK", other: "その他" };
function histByMonth() {
const byMonth = new Map();
histAll.forEach((r) => {
const k = r.month.slice(0, 7);
if (!byMonth.has(k)) byMonth.set(k, { count: 0, gross: 0, ded: 0, net: 0 });
const o = byMonth.get(k);
o.count++; o.gross += r.gross; o.ded += r.ded_total; o.net += r.net;
const g = shopGroup(r.shop);
if (g === "kara") { o.karaGross = (o.karaGross || 0) + r.gross; o.karaNet = (o.karaNet || 0) + r.net; }
if (g === "bar") { o.barGross = (o.barGross || 0) + r.gross; o.barNet = (o.barNet || 0) + r.net; }
});
return byMonth;
}
function renderMonths() {
const now = new Date();
const endY = now.getFullYear(), endM = now.getMonth() + 1; // 来月まで
const calc = [];
let y = 2026, m = 10; // 2026年11月から
while (y < endY || (y === endY && m <= endM)) {
calc.push([y, m]);
m++; if (m > 11) { m = 0; y++; }
}
calc.reverse();
$("months-calc").innerHTML = calc.map(([yy, mm]) =>
`<button type="button" class="folder-row" data-calc-y="${yy}" data-calc-m="${mm}">
<span class="folder-ico">▸</span><span class="folder-name">${yy}年${mm + 1}月分</span>
<span class="folder-sub">計算</span><span class="menu-arrow">›</span></button>`).join("");
$("months-calc").querySelectorAll("[data-calc-y]").forEach((b) =>
b.addEventListener("click", async () => {
view.y = Number(b.dataset.calcY); view.m = Number(b.dataset.calcM);
await renderAll();
showMainView("payroll");
}));
const byMonth = histByMonth();
const keys = [...byMonth.keys()].sort().reverse();
$("months-done").innerHTML = keys.map((k) => {
const o = byMonth.get(k);
return `<button type="button" class="folder-row" data-done-k="${k}">
<span class="folder-ico">▸</span><span class="folder-name">${k.slice(0, 4)}年${Number(k.slice(5, 7))}月分</span>
<span class="folder-sub">${o.count}件／差引 ${fmtYen(o.net)}</span><span class="menu-arrow">›</span></button>`;
}).join("") || `<p class="hint">まだありません。</p>`;
$("months-done").querySelectorAll("[data-done-k]").forEach((b) =>
b.addEventListener("click", async () => {
const [yy, mm] = b.dataset.doneK.split("-").map(Number);
hist.y = yy; hist.m = mm - 1;
await renderHistory();
showMainView("history");
}));
}
$("btn-months-manual").addEventListener("click", () => showMainView("manual"));

function renderSummary() {
const byMonth = histByMonth();
const keys = [...byMonth.keys()].sort().reverse();
const tG = histAll.reduce((a, r) => a + r.gross, 0), tD = histAll.reduce((a, r) => a + r.ded_total, 0), tN = histAll.reduce((a, r) => a + r.net, 0);
$("summary-body").innerHTML =
keys.map((k) => {
const o = byMonth.get(k);
return `<div class="t-row" style="padding:10px 0;border-bottom:1px solid var(--line)">
<span>${k.slice(0, 4)}年${Number(k.slice(5, 7))}月（${o.count}件）</span>
<span style="text-align:right">辛麺屋 支給 ${fmtYen(o.karaGross || 0)}<br>BAR 支給 ${fmtYen(o.barGross || 0)}<br>合計 支給 ${fmtYen(o.gross)}／差引 <b>${fmtYen(o.net)}</b></span></div>`;
}).join("") +
`<div class="pay-totals" style="margin-top:12px">
<div class="t-row"><span>辛麺屋 物語の支給合計（全期間）</span><span>${fmtYen(histAll.filter((r) => shopGroup(r.shop) === "kara").reduce((a, r) => a + r.gross, 0))}</span></div>
<div class="t-row"><span>BAR OK ROCKの支給合計（全期間）</span><span>${fmtYen(histAll.filter((r) => shopGroup(r.shop) === "bar").reduce((a, r) => a + r.gross, 0))}</span></div>
<div class="t-row"><span>全期間の支給合計</span><span>${fmtYen(tG)}</span></div>
<div class="t-row"><span>全期間の控除合計</span><span>${fmtYen(tD)}</span></div>
<div class="t-row t-net"><span>全期間の差引合計</span><span>${fmtYen(tN)}</span></div>
</div>
<button class="btn-ghost" id="summary-csv" type="button" style="width:100%;margin-top:12px">月別合計をCSVで出す</button>`;
$("summary-csv").addEventListener("click", () => {
const escCsv = (v) => `"${String(v == null? "": v).replace(/"/g, '""')}"`;
const lines = [["年月", "件数", "辛麺屋支給", "BAR支給", "支給合計", "控除合計", "差引合計"].join(",")];
[...byMonth.keys()].sort().forEach((k) => {
const o = byMonth.get(k);
lines.push([`${k.slice(0, 4)}年${Number(k.slice(5, 7))}月`, o.count, o.karaGross || 0, o.barGross || 0, o.gross, o.ded, o.net].map(escCsv).join(","));
});
const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = "給料の合計_月別.csv";
a.click();
URL.revokeObjectURL(a.href);
toast("CSVを出しました");
});
}
function printAllCalcSlips() {
if (!payrolls.length) { toast("この月の計算データがありません"); return; }
const w = window.open("", "_blank");
if (!w) { toast("ポップアップがブロックされました"); return; }
const trs = (items, totalLabel, total) =>
items.map((i) => `<tr><td>${esc(i.label)}</td><td class="num">${fmtYen(i.amount)}</td></tr>`).join("") +
`<tr class="total"><td>${totalLabel}</td><td class="num">${fmtYen(total)}</td></tr>`;
const slip = ({ staff: s, p }) => `<section>
<h1>給料支払明細書（${view.y}年${view.m + 1}月分）</h1>
<div class="name">${esc(s.name)} 殿</div>
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
<div>備考：所属店舗 ${esc(s.shop_name || "辛麺屋 物語 中町本店")}／所得税・社会保険料は概算です</div>
<div class="foot">株式会社H&Kグループ</div>
</section>`;
w.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<title>給料支払明細書（全員分）</title><style>
@page{size:A4 portrait;margin:14mm}
body{font-family:"Hiragino Sans","Noto Sans JP",sans-serif;color:#222;font-size:13px}
section{page-break-after:always}
section:last-child{page-break-after:auto}
h1{font-size:19px;text-align:center;margin:0 0 4px}
.name{font-size:15px;font-weight:700;margin:10px 0}
table{width:100%;border-collapse:collapse;margin:8px 0 14px}
th,td{border:1px solid #888;padding:5px 8px}
th{background:#F7F2EC;text-align:left}
td.num{text-align:right}
tr.total td{font-weight:800;background:#F7F2EC}
h2{font-size:14px;margin:14px 0 4px;border-left:5px solid #D94036;padding-left:8px}
.net{text-align:center;border:2px solid #222;padding:12px;margin:16px 0}
.net .amt{font-size:26px;font-weight:900}
.foot{text-align:right;margin-top:24px;font-weight:700}
</style></head><body>
${payrolls.map(slip).join("")}
<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script>
</body></html>`);
w.document.close();
}
function renderSlipMonths() {
const now = new Date();
const endY = now.getFullYear(), endM = now.getMonth() + 1;
const calc = [];
let y = 2026, m = 10;
while (y < endY || (y === endY && m <= endM)) {
calc.push([y, m]);
m++; if (m > 11) { m = 0; y++; }
}
calc.reverse();
$("slips-calc").innerHTML = calc.map(([yy, mm]) =>
`<button type="button" class="folder-row" data-scalc-y="${yy}" data-scalc-m="${mm}">
<span class="folder-ico">▸</span><span class="folder-name">${yy}年${mm + 1}月分</span>
<span class="folder-sub">計算</span><span class="menu-arrow">›</span></button>`).join("");
$("slips-calc").querySelectorAll("[data-scalc-y]").forEach((b) =>
b.addEventListener("click", async () => {
view.y = Number(b.dataset.scalcY); view.m = Number(b.dataset.scalcM);
await renderAll();
printAllCalcSlips();
}));
const byMonth = histByMonth();
const keys = [...byMonth.keys()].sort().reverse();
$("slips-done").innerHTML = keys.map((k) => {
const o = byMonth.get(k);
return `<button type="button" class="folder-row" data-sdone-k="${k}">
<span class="folder-ico">▸</span><span class="folder-name">${k.slice(0, 4)}年${Number(k.slice(5, 7))}月分</span>
<span class="folder-sub">${o.count}件</span><span class="menu-arrow">›</span></button>`;
}).join("") || `<p class="hint">まだありません。</p>`;
$("slips-done").querySelectorAll("[data-sdone-k]").forEach((b) =>
b.addEventListener("click", async () => {
const [yy, mm] = b.dataset.sdoneK.split("-").map(Number);
hist.y = yy; hist.m = mm - 1;
await renderHistory();
printAllHistSlips();
}));
}
function printAllHistSlips() {
if (!histRows.length) { toast("この月の実績がありません"); return; }
const w = window.open("", "_blank");
if (!w) { toast("ポップアップがブロックされました"); return; }
const slip = (r) => {
const trs = (obj, tl, t) => Object.entries(obj || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${fmtYen(v)}</td></tr>`).join("") + `<tr class="total"><td>${tl}</td><td class="num">${fmtYen(t)}</td></tr>`;
return `<section>
<h1>給料支払明細書（${hist.y}年${hist.m + 1}月分）</h1>
<div class="name">${esc(r.name)} 殿</div>
<table>
<tr><th>労働日数</th><td>${r.days == null? "―": `${r.days}日`}</td><th>労働時間</th><td>${r.work_min == null? "―": fmtHM(r.work_min)}</td><th>所定時間外</th><td>${r.ot_min == null? "―": fmtHM(r.ot_min)}</td></tr>
</table>
<h2>支給額</h2><table>${trs(r.pay, "支給合計", r.gross)}</table>
<h2>控除額</h2><table>${trs(r.ded, "控除合計", r.ded_total)}</table>
<div class="net">差引支給額　<span class="amt">${fmtYen(r.net)}</span></div>
<div>備考：所属 ${esc(r.shop || "―")}${r.note? `／${esc(r.note)}`: ""}</div>
<div class="foot">株式会社H&Kグループ</div>
</section>`;
};
w.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<title>給料支払明細書まとめ</title><style>
@page{size:A4 portrait;margin:14mm}
body{font-family:"Hiragino Sans","Noto Sans JP",sans-serif;color:#222;font-size:13px}
section{page-break-after:always}
section:last-child{page-break-after:auto}
h1{font-size:19px;text-align:center;margin:0 0 4px}
.name{font-size:15px;font-weight:700;margin:10px 0}
table{width:100%;border-collapse:collapse;margin:8px 0 14px}
th,td{border:1px solid #888;padding:5px 8px}
th{background:#F2F2F2;text-align:left}
td.num{text-align:right}
tr.total td{font-weight:800;background:#F2F2F2}
h2{font-size:14px;margin:14px 0 4px;border-left:5px solid #111;padding-left:8px}
.net{text-align:center;border:2px solid #222;padding:12px;margin:16px 0}
.net .amt{font-size:26px;font-weight:900}
.foot{text-align:right;margin-top:24px;font-weight:700}
</style></head><body>
${histRows.map(slip).join("")}
<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script>
</body></html>`);
w.document.close();
}
$("btn-hist-printall").addEventListener("click", printAllHistSlips);

// ============================================================
// スタッフ設定（プロフィール＋給与設定）
// ============================================================
let allStaff = [];
async function renderSettings() {
if (DEMO) { $("staff-settings-list").innerHTML = `<p class="hint">デモモードでは使えません。</p>`; return; }
allStaff = await DB.listAllStaff();
const setGroups = { kara: [], bar: [], other: [] };
allStaff.forEach((s, i) => setGroups[shopGroup(s.shop_name || s.shop)].push([s, i]));
$("staff-settings-list").innerHTML = ["kara", "bar", "other"].map((g) => {
if (!setGroups[g].length) return "";
return `<h3 class="sec-label">${DEPT_LABEL[g]}</h3>` + setGroups[g].map(([s, i]) =>
`<button type="button" class="adm-pay-row" data-set-idx="${i}">
<span><span class="pname">${esc(s.name)}</span>${s.active? "": "（退職）"}<br>
<span class="adm-pay-sub">${esc(s.shop_name || "")}／${s.pay_type === "salary"? "月給制": "時給制"}／${s.pay_type === "salary"? `基本給 ${fmtYen(s.base_salary || 0)}`: `時給 ${fmtYen(s.hourly_wage)}`}</span></span>
<span class="pnet" style="font-size:1rem;color:var(--ink)">設定 ›</span>
</button>`).join("");
}).join("");
$("staff-settings-list").querySelectorAll("[data-set-idx]").forEach((b) =>
b.addEventListener("click", () => renderSettingsForm(Number(b.dataset.setIdx))));
}
function renderSettingsForm(idx) {
const s = allStaff[idx];
if (!s) return;
const num = (id, label, val, ph) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" inputmode="numeric" min="0" step="1" value="${val == null? "": val}" placeholder="${ph || ""}"></div>`;
const chk = (id, label, on) => `<label class="chk-row"><input type="checkbox" id="${id}" ${on? "checked": ""}> ${label}</label>`;
const others = (s.other_allowances || []).map((o, i) =>
`<div class="adj-other-row">
<input type="text" data-sol="${i}" value="${esc(o.label)}" placeholder="手当の名前">
<input type="number" data-soa="${i}" value="${o.amount}" min="0" step="1" inputmode="numeric" placeholder="金額">
<button type="button" class="btn-mini danger" data-sodel="${i}">削除</button>
</div>`).join("");
$("staff-settings-form").innerHTML = `
<div class="card">
<h2>${esc(s.name)} の設定</h2>
<div id="set-import-banner"></div>
<h3 class="form-h">基本情報</h3>
<div class="field"><label for="set-gender">性別</label>
<select id="set-gender">
<option value="" ${!s.gender? "selected": ""}>未設定</option>
<option value="男性" ${s.gender === "男性"? "selected": ""}>男性</option>
<option value="女性" ${s.gender === "女性"? "selected": ""}>女性</option>
</select></div>
<div class="field"><label for="set-birth">生年月日</label><input id="set-birth" type="date" value="${s.birth_date || ""}"></div>
<div class="field"><label for="set-address">住所</label><input id="set-address" type="text" value="${esc(s.address || "")}" placeholder="住所を入力"></div>
<h3 class="form-h">勤務情報</h3>
<div class="field"><label for="set-shop">所属</label>
<select id="set-shop">
<option value="辛麺屋 物語 中町本店" ${s.shop_name === "辛麺屋 物語 中町本店"? "selected": ""}>辛麺屋 物語 中町本店</option>
<option value="BAR OK ROCK" ${s.shop_name === "BAR OK ROCK"? "selected": ""}>BAR OK ROCK</option>
</select></div>
<div class="field"><label for="set-jobtype">業務の種類</label><input id="set-jobtype" type="text" value="${esc(s.job_type || "")}" placeholder="例：接客、調理、ホール など"></div>
<div class="field"><label for="set-postitle">役職</label><input id="set-postitle" type="text" value="${esc(s.position_title || "")}" placeholder="例：店長、マネージャー など"></div>
<div class="field"><label for="set-emptype">雇用形態</label>
<select id="set-emptype">
<option value="" ${!s.employment_type? "selected": ""}>未設定</option>
<option value="社員" ${s.employment_type === "社員"? "selected": ""}>社員</option>
<option value="アルバイト" ${s.employment_type === "アルバイト"? "selected": ""}>アルバイト</option>
<option value="パート" ${s.employment_type === "パート"? "selected": ""}>パート</option>
<option value="その他" ${s.employment_type === "その他"? "selected": ""}>その他</option>
</select></div>
<div class="field"><label for="set-mynumber">マイナンバー（管理者のみ閲覧可）</label><input id="set-mynumber" type="text" inputmode="numeric" maxlength="12" value="" placeholder="読み込み中…"></div>
<div class="field"><label for="set-hire">入社日（採用日）</label><input id="set-hire" type="date" value="${s.hire_date || ""}"></div>
<div class="field"><label for="set-note">履歴・メモ</label><input id="set-note" type="text" value="${esc(s.profile_note || "")}" placeholder="例：入社前の職歴、週末中心 など"></div>
${chk("set-cook", "調理ができる", !!s.can_cook)}
<h3 class="form-h">退職情報</h3>
<div class="field"><label for="set-retire">退職日</label><input id="set-retire" type="date" value="${s.retire_date || ""}"></div>
${chk("set-active", "在籍している（オフにすると退職扱い）", !!s.active)}
<h3 class="form-h">給与の形</h3>
<div class="field"><label for="set-paytype">給与形態</label>
<select id="set-paytype">
<option value="hourly" ${s.pay_type !== "salary"? "selected": ""}>時給制</option>
<option value="salary" ${s.pay_type === "salary"? "selected": ""}>月給制（社員）</option>
</select></div>
<div id="set-hourly-block">
${num("set-wage", "時給（円）", s.hourly_wage)}
${chk("set-nightinc", "時給に深夜手当込み（深夜割増を上乗せしない）", !!s.night_included)}
${num("set-qwage", "ノルマ達成時の時給（円・空欄ならノルマなし）", s.quota_wage)}
${num("set-qthr", "ノルマの月売上（円）", s.quota_threshold)}
${num("set-cross", "辛麺屋出勤手当（1日あたり・空欄なら対象外）", s.cross_allowance)}
</div>
<div id="set-salary-block">
${num("set-base", "基本給（円）", s.base_salary)}
${num("set-pos", "役職手当（円）", s.position_allowance)}
${num("set-fixednight", "深夜手当・固定（円）", s.fixed_night_allowance)}
${num("set-deemed", "みなし残業（円）", s.deemed_overtime)}
${num("set-transport", "交通費（円）", s.transport_allowance)}
</div>
<h3 class="form-h">手当</h3>
${num("set-drink", "ドリンクバック（円）", s.drink_back)}
<div class="field"><label>その他手当</label><div id="set-others">${others}</div>
<button type="button" class="btn-mini" id="set-other-add">手当を追加</button></div>
<h3 class="form-h">税金・保険</h3>
${chk("set-si", "社会保険に加入（健康保険・厚生年金・子育て支援金を計算）", !!(s.social_insurance != null? s.social_insurance: s.social_insurance_enrolled))}
${num("set-dep", "扶養人数", s.dependents)}
${num("set-restax", "住民税（月額・円）", s.resident_tax)}
${num("set-adv", "前払金（円）", s.advance_payment)}
<button class="btn-primary" id="set-save" type="button" style="width:100%;margin-top:14px">保存する</button>
<button class="btn-ghost" id="set-close" type="button" style="width:100%;margin-top:10px">閉じる</button>
</div>`;
const toggleBlocks = () => {
const sal = $("set-paytype").value === "salary";
$("set-salary-block").style.display = sal? "block": "none";
$("set-hourly-block").style.display = sal? "none": "block";
};
$("set-paytype").addEventListener("change", toggleBlocks);
toggleBlocks();
$("staff-settings-form").querySelectorAll("[data-sodel]").forEach((b) =>
b.addEventListener("click", () => b.closest(".adj-other-row").remove()));
$("set-other-add").addEventListener("click", () => {
const i = $("set-others").children.length;
const div = document.createElement("div");
div.className = "adj-other-row";
div.innerHTML = `<input type="text" data-sol="${i}" value="" placeholder="手当の名前">
<input type="number" data-soa="${i}" value="0" min="0" step="1" inputmode="numeric" placeholder="金額">
<button type="button" class="btn-mini danger">削除</button>`;
div.querySelector("button").addEventListener("click", () => div.remove());
$("set-others").appendChild(div);
});
$("set-close").addEventListener("click", () => { $("staff-settings-form").innerHTML = ""; });
$("set-save").addEventListener("click", async () => {
const v = (id) => { const el = $(id); const n = Number(el.value); return el.value === "" ||!Number.isFinite(n)? null: Math.round(n); };
const v0 = (id) => v(id) || 0;
const othersArr = [];
$("set-others").querySelectorAll(".adj-other-row").forEach((rowEl) => {
const lab = rowEl.querySelector("[data-sol]").value.trim();
const amo = Number(rowEl.querySelector("[data-soa]").value);
if (lab && Number.isFinite(amo)) othersArr.push({ label: lab, amount: Math.round(amo) });
});
const si = $("set-si").checked;
const fields = {
gender: $("set-gender").value || null,
birth_date: $("set-birth").value || null,
address: $("set-address").value.trim() || null,
job_type: $("set-jobtype").value.trim() || null,
position_title: $("set-postitle").value.trim() || null,
employment_type: $("set-emptype").value || null,
retire_date: $("set-retire").value || null,
shop_name: $("set-shop").value,
hire_date: $("set-hire").value || null,
profile_note: $("set-note").value.trim() || null,
can_cook: $("set-cook").checked,
active: $("set-active").checked,
pay_type: $("set-paytype").value,
hourly_wage: v0("set-wage") || 1085,
night_included: $("set-nightinc").checked,
quota_wage: v("set-qwage"),
quota_threshold: v("set-qthr"),
cross_allowance: v("set-cross"),
base_salary: v("set-base"),
position_allowance: v0("set-pos"),
fixed_night_allowance: v0("set-fixednight"),
deemed_overtime: v0("set-deemed"),
transport_allowance: v0("set-transport"),
drink_back: v0("set-drink"),
other_allowances: othersArr,
social_insurance: si,
social_insurance_enrolled: si,
dependents: v0("set-dep"),
resident_tax: v0("set-restax"),
advance_payment: v0("set-adv")
};
const err = await DB.updateStaff(s.id, fields);
if (err) { toast("保存できませんでした。もう一度試してね"); return; }
const mn = $("set-mynumber").value.replace(/[^0-9]/g, "");
const mnErr = await DB.upsertStaffPrivate(s.id, mn || null);
if (mnErr) { toast("設定は保存しましたが、マイナンバーの保存に失敗しました"); return; }
if (window.__pendingImportId) { await DB.markImportUsed(window.__pendingImportId); window.__pendingImportId = null; }
toast(`${s.name}さんの設定を保存しました`);
$("staff-settings-form").innerHTML = "";
STAFF = (await DB.listStaff()).filter((x) => x.role!== "kiosk");
await renderAll();
await renderSettings();
});
DB.listPendingImports().then((imps) => {
const hit = imps.find((x) => (x.for_name || "").replace(/\s/g, "") === s.name.replace(/\s/g, ""));
const box = $("set-import-banner");
if (!hit || !box) return;
box.innerHTML = `<div class="banner warn" style="margin-bottom:12px">履歴書の読み取り結果があります（${esc(hit.for_name)}さん分）。内容を確認してから反映してください。
<button type="button" class="btn-mini" id="set-import-apply" style="margin-left:8px">フォームに反映する</button></div>`;
$("set-import-apply").addEventListener("click", () => {
const f = hit.fields || {};
if (f.gender) $("set-gender").value = f.gender;
if (f.birth_date) $("set-birth").value = f.birth_date;
if (f.address) $("set-address").value = f.address;
if (f.profile_note) $("set-note").value = f.profile_note;
if (f.job_type) $("set-jobtype").value = f.job_type;
box.innerHTML = `<div class="banner" style="margin-bottom:12px">フォームに反映しました。内容を確認して「保存する」を押してください。</div>`;
window.__pendingImportId = hit.id;
});
});
DB.getStaffPrivate(s.id).then((pv) => {
const el = $("set-mynumber");
if (el) { el.value = pv && pv.my_number? pv.my_number: ""; el.placeholder = "12桁の番号"; }
});
$("staff-settings-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ============================================================
// 手入力（過去実績への追加・編集）
// ============================================================
let manEditId = null;
function manItemRow(label, amount) {
return `<div class="adj-other-row man-row">
<input type="text" class="man-label" value="${esc(label || "")}" placeholder="項目名">
<input type="number" class="man-amount" value="${amount == null? "": amount}" step="1" inputmode="numeric" placeholder="金額">
<button type="button" class="btn-mini danger man-del">削除</button>
</div>`;
}
function openManualForm(row) {
if (DEMO) { toast("デモモードでは保存できません"); return; }
manEditId = row? row.id: null;
const ym = row? row.month.slice(0, 7): `${hist.y}-${pad(hist.m + 1)}`;
const payRows = row? Object.entries(row.pay || {}).map(([k, v]) => manItemRow(k, v)).join(""): manItemRow("基本給", "") + manItemRow("深夜手当", "");
const dedRows = row? Object.entries(row.ded || {}).map(([k, v]) => manItemRow(k, v)).join(""): manItemRow("所得税", "") + manItemRow("雇用保険料", "");
const hm = (min) => min == null? ["", ""]: [Math.floor(min / 60), min % 60];
const [wh, wm] = hm(row? row.work_min: null);
const [oh, om] = hm(row? row.ot_min: null);
$("manual-form").innerHTML = `
<div class="card" style="margin-top:16px">
<h2>${row? "明細を編集": "明細を手入力で追加"}</h2>
<div class="field"><label for="man-month">対象月</label><input id="man-month" type="month" value="${ym}"></div>
<div class="field"><label for="man-name">氏名</label><input id="man-name" type="text" value="${esc(row? row.name: "")}" placeholder="例：山田 太郎"></div>
<div class="field"><label for="man-shop">所属</label>
<select id="man-shop">
<option value="辛麺屋物語中町本店" ${row && row.shop === "辛麺屋物語中町本店"? "selected": ""}>辛麺屋 物語 中町本店</option>
<option value="BAR OK ROCK" ${row && row.shop === "BAR OK ROCK"? "selected": ""}>BAR OK ROCK</option>
</select></div>
<div class="field"><label for="man-days">労働日数</label><input id="man-days" type="number" inputmode="numeric" min="0" step="1" value="${row && row.days != null? row.days: ""}"></div>
<div class="field"><label>労働時間</label><div class="hm-row"><input id="man-wh" type="number" inputmode="numeric" min="0" step="1" value="${wh}" placeholder="時間"><span>時間</span><input id="man-wm" type="number" inputmode="numeric" min="0" max="59" step="1" value="${wm}" placeholder="分"><span>分</span></div></div>
<div class="field"><label>所定時間外労働</label><div class="hm-row"><input id="man-oh" type="number" inputmode="numeric" min="0" step="1" value="${oh}" placeholder="時間"><span>時間</span><input id="man-om" type="number" inputmode="numeric" min="0" max="59" step="1" value="${om}" placeholder="分"><span>分</span></div></div>
<h3 class="form-h">支給項目</h3>
<div id="man-pay-rows">${payRows}</div>
<button type="button" class="btn-mini" id="man-pay-add">支給項目を追加</button>
<h3 class="form-h">控除項目</h3>
<div id="man-ded-rows">${dedRows}</div>
<button type="button" class="btn-mini" id="man-ded-add">控除項目を追加</button>
<h3 class="form-h">控除の自動計算</h3>
<label class="chk-row"><input type="checkbox" id="man-si" ${row && row.ded && row.ded["健康保険料"]? "checked": ""}> 社会保険に加入している</label>
<div class="field"><label for="man-dep">扶養人数</label><input id="man-dep" type="number" inputmode="numeric" min="0" step="1" value="0"></div>
<button type="button" class="btn-share" id="man-autoded" style="width:100%">控除を自動計算して控除項目に入れる</button>
<p class="hint" style="margin-top:8px">支給合計から、雇用保険・社会保険・所得税を概算で計算します（住民税・前払金はスタッフ設定の登録値）。計算後はそのまま数字を直せます。氏名がスタッフと一致すると、扶養人数・社会保険・住民税・前払金を設定から自動で入れます。</p>
<div class="field" style="margin-top:14px"><label for="man-note">備考</label><input id="man-note" type="text" value="${esc(row? (row.note || ""): "")}"></div>
<div class="pay-totals" id="man-totals"></div>
<button class="btn-primary" id="man-save" type="button" style="width:100%;margin-top:14px">保存する</button>
<button class="btn-ghost" id="man-close" type="button" style="width:100%;margin-top:10px">やめる</button>
</div>`;
const collect = (boxId) => {
const obj = {};
$(boxId).querySelectorAll(".man-row").forEach((r) => {
const lab = r.querySelector(".man-label").value.trim();
const amo = Number(r.querySelector(".man-amount").value);
if (lab && Number.isFinite(amo)) obj[lab] = (obj[lab] || 0) + Math.round(amo);
});
return obj;
};
const updTotals = () => {
const pay = collect("man-pay-rows"), ded = collect("man-ded-rows");
const g = Object.values(pay).reduce((a, b) => a + b, 0);
const d = Object.values(ded).reduce((a, b) => a + b, 0);
$("man-totals").innerHTML =
`<div class="t-row"><span>支給合計</span><span>${fmtYen(g)}</span></div>` +
`<div class="t-row"><span>控除合計</span><span>${fmtYen(d)}</span></div>` +
`<div class="t-row t-net"><span>差引支給額</span><span>${fmtYen(g - d)}</span></div>`;
};
$("manual-form").addEventListener("input", updTotals);
const bindDel = () => $("manual-form").querySelectorAll(".man-del").forEach((b) => b.onclick = () => { b.closest(".man-row").remove(); updTotals(); });
const addRow = (boxId) => {
const div = document.createElement("div");
div.innerHTML = manItemRow("", "");
$(boxId).appendChild(div.firstElementChild);
bindDel();
};
let manStaff = null;
$("man-name").addEventListener("change", () => {
const nm = $("man-name").value.replace(/\s/g, "");
manStaff = (allStaff || []).find((x) => x.name.replace(/\s/g, "") === nm) || null;
if (manStaff) {
$("man-si").checked = !!(manStaff.social_insurance != null? manStaff.social_insurance: manStaff.social_insurance_enrolled);
$("man-dep").value = manStaff.dependents || 0;
toast(`${manStaff.name}さんの設定を読み込みました`);
}
});
$("man-autoded").addEventListener("click", () => {
const pay = collect("man-pay-rows");
const gross = Object.values(pay).reduce((a, b) => a + b, 0);
if (gross <= 0) { toast("先に支給項目を入れてね"); return; }
const si = $("man-si").checked;
const dep = Math.max(0, Math.round(Number($("man-dep").value) || 0));
const emp = Math.round(gross * PR.employmentInsuranceRate);
const health = si? Math.round(gross * PR.healthInsuranceRate): 0;
const pension = si? Math.round(gross * PR.pensionRate): 0;
const child = si? Math.round(gross * PR.childSupportRate): 0;
const tax = estimateIncomeTax(gross, health + pension + child + emp, dep);
const rows = [];
if (si) { rows.push(["健康保険料", health], ["厚生年金", pension], ["子ども・子育て支援金", child]); }
rows.push(["雇用保険料", emp], ["所得税", tax]);
if (manStaff && manStaff.resident_tax > 0) rows.push(["住民税", manStaff.resident_tax]);
if (manStaff && manStaff.advance_payment > 0) rows.push(["前払金", manStaff.advance_payment]);
$("man-ded-rows").innerHTML = rows.map(([k, v]) => manItemRow(k, v)).join("");
bindDel();
updTotals();
toast("控除を自動計算しました（概算）");
});
$("man-pay-add").addEventListener("click", () => addRow("man-pay-rows"));
$("man-ded-add").addEventListener("click", () => addRow("man-ded-rows"));
bindDel();
updTotals();
$("man-close").addEventListener("click", () => { $("manual-form").innerHTML = ""; manEditId = null; });
$("man-save").addEventListener("click", async () => {
const name = $("man-name").value.trim();
const monthVal = $("man-month").value;
if (!name) { toast("氏名を入れてね"); return; }
if (!monthVal) { toast("対象月を選んでね"); return; }
const pay = collect("man-pay-rows"), ded = collect("man-ded-rows");
const gross = Object.values(pay).reduce((a, b) => a + b, 0);
const dedTotal = Object.values(ded).reduce((a, b) => a + b, 0);
const mins = (hId, mId) => {
const h = Number($(hId).value), m = Number($(mId).value);
if ($(hId).value === "" && $(mId).value === "") return null;
return (Number.isFinite(h)? h: 0) * 60 + (Number.isFinite(m)? m: 0);
};
const rec = {
month: `${monthVal}-01`,
name,
shop: $("man-shop").value,
days: $("man-days").value === ""? null: Math.round(Number($("man-days").value)),
work_min: mins("man-wh", "man-wm"),
ot_min: mins("man-oh", "man-om"),
pay, gross, ded, ded_total: dedTotal, net: gross - dedTotal,
note: $("man-note").value.trim() || null
};
const err = manEditId? await DB.updatePayrollHistory(manEditId, rec): await DB.insertPayrollHistory(rec);
if (err) { toast("保存できませんでした。もう一度試してね"); return; }
toast("保存しました");
$("manual-form").innerHTML = "";
manEditId = null;
const [yy, mm] = monthVal.split("-").map(Number);
hist.y = yy; hist.m = mm - 1;
await renderHistory();
await refreshHistSide();
navStack.length = 0; navStack.push("home", "months");
activateView("history");
});
$("manual-form").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("btn-manual-open").addEventListener("click", () => openManualForm(null));

// ============================================================
// 初期化
// ============================================================
if ("serviceWorker" in navigator) {
navigator.serviceWorker.register("sw.js").catch(() => {});
}
setupLogin();
restoreSession();
})();
