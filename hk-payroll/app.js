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
$("pay-totals").innerHTML =
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
// 初期化
// ============================================================
if ("serviceWorker" in navigator) {
navigator.serviceWorker.register("sw.js").catch(() => {});
}
setupLogin();
restoreSession();
})();
