/* ============================================================
   1ヶ月分シフト表（印刷ビュー）
   - 縦軸：日付（曜日付き）／横軸：スタッフ名のマトリクス
   - 昼のシフトは「昼の部」、夜は勤務時間（例 18:00〜22:00）で表示
   - データは Supabase の shifts / staff テーブルから取得。
     未設定の場合はデモデータでプレビューできます。
   ============================================================ */
(function () {
  "use strict";
  const CFG = window.APP_CONFIG || {};
  const DOW = ["日", "月", "火", "水", "木", "金", "土"];

  // 区分ごとの標準時間（shifts に個別の開始/終了がある場合はそちら優先）
  const BAND_TIME = {
    lunch:  { start: "11:00", end: "15:00", label: "昼の部" },
    dinner: { start: "18:00", end: "22:00", label: null },
    late:   { start: "22:00", end: "27:00", label: null }
  };

  // 名簿（表示順）。Supabase 使用時は staff テーブルが正。
  const ROSTER = [
    "神坂春貴", "柳村奎弥", "沼口健太郎", "山口直也", "黒木一真", "妹尾里佳",
    "神坂凛", "島本蒼", "阿久井真奈美", "吉村汐織", "矢野恵", "福島妙子"
  ];

  const useSupabase = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  const sb = useSupabase ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

  const $month = document.getElementById("print-month");
  const $split = document.getElementById("split-pages");
  const $root = document.getElementById("sheet-root");
  document.getElementById("print-mode-note").textContent =
    useSupabase ? "" : "（現在はデモデータで表示しています）";

  const now = new Date();
  $month.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  $month.addEventListener("change", render);
  $split.addEventListener("change", render);
  document.getElementById("btn-do-print").addEventListener("click", () => window.print());

  // ---------- ユーティリティ ----------
  const pad = (n) => String(n).padStart(2, "0");
  const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

  // ---------- データ取得 ----------
  async function fetchData(year, month) {
    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0);
    if (sb) {
      const [staffRes, shiftRes] = await Promise.all([
        sb.from("staff").select("id, name, sort_order").eq("active", true).order("sort_order"),
        sb.from("shifts").select("staff_id, date, band, start_time, end_time")
          .gte("date", fmtDate(first)).lte("date", fmtDate(last))
      ]);
      if (staffRes.error) throw staffRes.error;
      if (shiftRes.error) throw shiftRes.error;
      const nameById = {};
      staffRes.data.forEach((s) => (nameById[s.id] = s.name));
      return {
        staffNames: staffRes.data.map((s) => s.name),
        shifts: shiftRes.data.map((r) => ({ name: nameById[r.staff_id], date: r.date, band: r.band, start: r.start_time, end: r.end_time }))
      };
    }
    return { staffNames: ROSTER, shifts: demoShifts(year, month) };
  }

  // デモ用シフト（曜日パターンのサンプル。本番では Supabase の確定シフトが入ります）
  function demoShifts(year, month) {
    const out = [];
    const days = new Date(year, month, 0).getDate();
    const add = (name, d, band, start, end) =>
      out.push({ name, date: fmtDate(new Date(year, month - 1, d)), band, start: start || null, end: end || null });
    for (let d = 1; d <= days; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      if (dow === 2) continue; // 火曜定休
      // ランチ（日曜はなし）
      if (dow !== 0) {
        add(dow === 6 ? "神坂春貴" : "黒木一真", d, "lunch");
        add("妹尾里佳", d, "lunch");
      }
      // ディナー
      if (dow === 3) add("神坂春貴", d, "dinner", "18:00", "21:30");
      else add("柳村奎弥", d, "dinner");
      add("神坂凛", d, "dinner");
      // 深夜
      add(dow === 5 || dow === 6 ? "山口直也" : "沼口健太郎", d, "late");
      if (dow === 1 || dow === 3) add("福島妙子", d, "late");
      if (dow === 4 || dow === 5 || dow === 6 || dow === 0) add("矢野恵", d, "late");
      if (dow === 5 || dow === 6) add("吉村汐織", d, "late");
    }
    return out;
  }

  // ---------- セル表示の組み立て ----------
  // 昼は「昼の部」、夜は時間帯。ディナー+深夜のように連続する帯は 18:00〜27:00 に結合。
  function cellHTML(rows) {
    if (!rows || rows.length === 0) return "";
    const parts = [];
    if (rows.some((r) => r.band === "lunch")) parts.push("昼の部");
    const night = rows
      .filter((r) => r.band === "dinner" || r.band === "late")
      .map((r) => ({
        s: r.start || BAND_TIME[r.band].start,
        e: r.end || BAND_TIME[r.band].end
      }))
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

  // ---------- 描画 ----------
  async function render() {
    const [y, m] = $month.value.split("-").map(Number);
    if (!y || !m) return;
    $root.innerHTML = "<p style='text-align:center'>読み込み中…</p>";
    let data;
    try {
      data = await fetchData(y, m);
    } catch (e) {
      $root.innerHTML = "<p style='text-align:center'>データの取得に失敗しました。通信環境を確認してください。</p>";
      return;
    }
    const daysInMonth = new Date(y, m, 0).getDate();
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m - 1, daysInMonth);
    const title =
      `${y}年${m}月${first.getDate()}日〜` +
      (last.getMonth() === first.getMonth() ? `${last.getDate()}日` : `${last.getMonth() + 1}月${last.getDate()}日`) +
      `のシフト`;

    // (date|name) -> shift rows
    const cellMap = new Map();
    data.shifts.forEach((s) => {
      const key = `${s.date}|${s.name}`;
      if (!cellMap.has(key)) cellMap.set(key, []);
      cellMap.get(key).push(s);
    });

    const ranges = $split.checked
      ? [[1, 15], [16, daysInMonth]]
      : [[1, daysInMonth]];

    const blocks = ranges.map(([from, to]) => {
      let rowsHTML = "";
      for (let d = from; d <= to; d++) {
        const date = new Date(y, m - 1, d);
        const dow = date.getDay();
        const closed = dow === CFG.SHOP.closedWeekday;
        const dowCls = dow === 0 ? "sun" : dow === 6 ? "sat" : "";
        const dateStr = fmtDate(date);
        let cells = "";
        if (closed) {
          cells = data.staffNames.map(() => `<td class="cell">定休日</td>`).join("");
        } else {
          cells = data.staffNames
            .map((name) => `<td class="cell">${cellHTML(cellMap.get(`${dateStr}|${name}`))}</td>`)
            .join("");
        }
        rowsHTML +=
          `<tr class="${closed ? "closed" : ""}">` +
          `<td class="date-col ${dowCls}">${d}（${DOW[dow]}）</td>${cells}</tr>`;
      }
      return (
        `<div class="sheet-block">` +
        `<div class="sheet-head"><div class="sheet-title">${title}</div>` +
        `<div class="sheet-company">（株）H&Kグループ辛麺屋物語中町本店</div></div>` +
        `<table class="shift-matrix"><thead><tr><th class="date-col">日付</th>` +
        data.staffNames.map((n) => `<th>${n}</th>`).join("") +
        `</tr></thead><tbody>${rowsHTML}</tbody></table></div>`
      );
    });

    $root.innerHTML =
      `<div class="sheet ${$split.checked ? "page-split" : ""}">` +
      blocks.join("") +
      `<div class="sheet-foot">火曜定休／日曜は夜のみ営業　ランチ 11:00–15:00・ディナー 18:00–22:00・深夜 22:00–27:00（「昼の部」はランチ勤務）</div>` +
      `</div>`;
  }

  render();
})();
