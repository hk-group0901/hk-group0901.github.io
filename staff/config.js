// ============================================================
// 辛麺屋 物語 スタッフアプリ 設定ファイル
// ------------------------------------------------------------
// Supabase プロジェクトを作成したら、下の2つを書き換えてください。
//   SUPABASE_URL      : プロジェクトURL (例 https://xxxx.supabase.co)
//   SUPABASE_ANON_KEY : anon public キー
// 空のままだと「デモモード」（端末内のサンプルデータ）で動きます。
// 本番運用では必ず Supabase の値を設定してください。
// ============================================================
window.APP_CONFIG = {
  SUPABASE_URL: "https://wdbkdwhtocbdaufxufqs.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndkYmtkd2h0b2NiZGF1Znh1ZnFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU3OTM0NzYsImV4cCI6MjExMTM2OTQ3Nn0.rm6OkozblAMwbzm872VspZaaI_5dXRV6i0fzkjdHzYc",

  // Web Push（VAPID）公開鍵。サーバー側で生成したものを設定します。
  VAPID_PUBLIC_KEY: "BPKkNCoPg7UHA9FLIj53va7GekzPayFW0NcmCywzqClJV773mFOL_ZmWUV2a0k6FangOzYEkoJ8ZGtvMj5nlOXk",

  // 店舗の基本情報
  SHOP: {
    name: "辛麺屋 物語 -monogatari- 中町本店",
    closedWeekday: 2,      // 火曜定休 (0=日,1=月,2=火,...)
    sundayNightOnly: true, // 日曜は夜のみ
    requestDeadlineDay: 20 // シフト希望の締切：毎月20日
  },

  // 給与計算の前提（★税理士確認のうえ、年度ごとに見直してください）
  PAYROLL: {
    defaultHourlyWage: 1085,   // 宮崎県最低賃金ベース（個人別時給は staff.hourly_wage）
    nightPremiumRate: 0.25,    // 深夜割増 22:00-5:00
    overtimePremiumRate: 0.25, // 法定時間外割増（1日8時間超）
    employmentInsuranceRate: 0.0055, // 雇用保険・労働者負担（一般の事業／年度で変わります）
    // 社会保険（加入者のみ）。実際は標準報酬月額で決まるため、ここは概算率。
    // ★協会けんぽの都道府県料率・年度改定に合わせて税理士確認のうえ更新してください。
    healthInsuranceRate: 0.0498,     // 健康保険・本人負担の概算
    pensionRate: 0.0915,             // 厚生年金・本人負担
    childSupportRate: 0.001,         // 子ども・子育て支援金（健康保険とあわせて徴収）
    payDay: 15,                      // 翌月15日払い
  }
};
