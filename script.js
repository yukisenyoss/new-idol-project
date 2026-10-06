const SUPABASE_URL = "https://ioqdcyvzbtdtcdbpmzkr.supabase.co/";
const SUPABASE_KEY = "sb_publishable_L3FotiOOkBzt_5EMHVjf9g_8CmHgC-W";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);

let currentGroup = null;
let currentProfile = null;
let selectedRole = "staff";
let selectedDay = null;
let editingProductId = null;
let editingScheduleId = null;
let timerDuration = 60;
const memberTimers = {};
let currentCalendarDate = new Date();

const paymentLabels = { cash: "現金", card: "カード", paypay: "PayPay" };

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();

  $("historyYear").innerHTML = "";
  const year = new Date().getFullYear();

  for (let y = year - 2; y <= year + 2; y++) {
    const o = document.createElement("option");
    o.value = y;
    o.textContent = `${y}年`;
    $("historyYear").appendChild(o);
  }

  $("historyYear").value = year;
  $("healthDate").value = localDate();
  setTimerDisplay();
}

function bindEvents() {
  $("groupLoginButton")?.addEventListener("click", verifyGroup);
  $("staffRoleButton")?.addEventListener("click", () => selectRole("staff"));
  $("idolRoleButton")?.addEventListener("click", () => selectRole("idol"));
  $("loginButton")?.addEventListener("click", login);
  $("backToGroupButton")?.addEventListener("click", backToGroup);
  $("logoutButton")?.addEventListener("click", logout);

  document.querySelectorAll("[data-page]").forEach((b) => {
    b.addEventListener("click", () => showPage(b.dataset.page));
  });

  $("confirmSaleButton")?.addEventListener("click", previewSale);
  $("cancelSaleButton")?.addEventListener("click", () =>
    $("saleConfirmModal").classList.add("hidden")
  );
  $("finalizeSaleButton")?.addEventListener("click", finalizeSale);

  $("prevMonthButton")?.addEventListener("click", () => changeMonth(-1));
  $("nextMonthButton")?.addEventListener("click", () => changeMonth(1));
  $("closeDayButton")?.addEventListener("click", closeCalendarDay);
  $("addScheduleButton")?.addEventListener("click", () => openScheduleModal());

  $("cancelScheduleButton")?.addEventListener("click", closeScheduleModal);
  $("saveScheduleButton")?.addEventListener("click", saveSchedule);

  $("addMemberButton")?.addEventListener("click", addMember);
  $("addProductButton")?.addEventListener("click", addProduct);
  $("closeProductModal")?.addEventListener("click", closeProductModal);
  $("saveProductButton")?.addEventListener("click", saveProduct);

  $("healthDate")?.addEventListener("change", loadStaffHealth);
  $("wakeButton")?.addEventListener("click", markWake);

  document.querySelectorAll("[data-health]").forEach((b) => {
    b.addEventListener("click", () => {
      document
        .querySelectorAll("[data-health]")
        .forEach((x) => x.classList.remove("selected"));

      b.classList.add("selected");
    });
  });

  $("saveHealthButton")?.addEventListener("click", saveHealth);
  $("historyYear")?.addEventListener("change", loadSalesHistory);
  $("saveSettingsButton")?.addEventListener("click", saveSettings);
  $("timerPage")?.addEventListener("click", (e) => {
  const button = e.target.closest("[data-timer-member]");
  if (!button) return;

  startMemberTimer(button.dataset.timerMember);
});
}

async function verifyGroup() {
  const code = $("groupCode").value.trim();
  const password = $("groupPassword").value;

  if (!code || !password) {
    return toast("グループIDとパスワードを入力してください。");
  }

  setBusy("groupLoginButton", true);

  const { data, error } = await db.rpc("verify_group", {
    p_group_code: code,
    p_password: password
  });

  setBusy("groupLoginButton", false);

  if (error || !data?.length) {
    return toast("グループIDまたはパスワードが違います。");
  }

  currentGroup = data[0];

  $("loginGroupName").textContent = currentGroup.group_name;
  $("groupLogin").classList.add("hidden");
  $("userLogin").classList.remove("hidden");
  $("username").focus();
}

function selectRole(role) {
  selectedRole = role;

  $("staffRoleButton").classList.toggle("active", role === "staff");
  $("idolRoleButton").classList.toggle("active", role === "idol");
}

async function login() {
  if (!currentGroup) {
    return toast("先にグループ認証をしてください。");
  }

  const username = $("username").value.trim();
  const password = $("password").value;

  if (!username || !password) {
    return toast("ユーザー名とパスワードを入力してください。");
  }

  setBusy("loginButton", true);

  const { data: email, error: emailError } = await db.rpc(
    "get_login_email",
    {
      p_group_code: currentGroup.group_code,
      p_username: username,
      p_role: selectedRole
    }
  );

  if (emailError || !email) {
    setBusy("loginButton", false);
    return toast("ユーザーが見つかりません。");
  }

  const { data: authData, error } =
    await db.auth.signInWithPassword({
      email,
      password
    });

  if (error) {
    setBusy("loginButton", false);
    return toast("ログインできませんでした。");
  }

  const { data: profile, error: profileError } =
    await db
      .from("profiles")
      .select("id,group_id,username,role,display_name")
      .eq("id", authData.user.id)
      .single();

  setBusy("loginButton", false);

  if (
    profileError ||
    profile.group_id !== currentGroup.id ||
    profile.role !== selectedRole
  ) {
    await db.auth.signOut();
    return toast("このグループでは利用できないユーザーです。");
  }

  currentProfile = profile;

  $("userName").textContent = profile.display_name;
  $("appTitle").textContent = currentGroup.group_name;

  $("groupLogin").classList.add("hidden");
  $("userLogin").classList.add("hidden");
  $("app").classList.remove("hidden");

  if (profile.role === "staff") {
    $("staffNav").classList.remove("hidden");
    $("idolNav").classList.add("hidden");

    await loadStaffData();
    showPage("homePage");
  } else {
    $("idolNav").classList.remove("hidden");
    $("staffNav").classList.add("hidden");

    await loadIdolData();
    showPage("idolHomePage");
  }
}

async function logout() {
  await db.auth.signOut();

  currentGroup = null;
  currentProfile = null;

  $("app").classList.add("hidden");
  $("staffNav").classList.add("hidden");
  $("idolNav").classList.add("hidden");
  $("userLogin").classList.add("hidden");
  $("groupLogin").classList.remove("hidden");

  $("password").value = "";
  $("groupPassword").value = "";
  $("username").value = "";



}

function backToGroup() {
  currentGroup = null;

  $("userLogin").classList.add("hidden");
  $("groupLogin").classList.remove("hidden");
}

function showPage(pageId) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.add("hidden"));

  const page = $(pageId);

  if (!page) return;

  page.classList.remove("hidden");

  if (pageId === "salesPage" || pageId === "homePage") {
    loadProducts();
  }

  if (pageId === "historyPage") {
    loadSalesHistory();
  }

  if (pageId === "calendarPage") {
    renderCalendar();
  }

  if (pageId === "timerPage") {
    loadTimerData();
  }

  if (pageId === "membersPage") {
    loadMembers();
  }

  if (pageId === "productsPage") {
    loadProducts();
  }

  if (pageId === "healthStaffPage") {
    loadStaffHealth();
  }

  if (pageId === "settingsPage") {
    loadSettings();
  }

  if (pageId === "idolHealthPage") {
    loadTodayHealth();
  }

  if (pageId === "idolHistoryPage") {
    loadIdolHistory();
  }
}

async function loadStaffData() {
  await Promise.all([
    loadSettings(),
    loadProducts(),
    loadMembers(),
    loadDashboard(),
    renderCalendar()
  ]);
}

async function loadIdolData() {
  await Promise.all([
    loadSettings(),
    loadTodayHealth(),
    renderCalendar()
  ]);

  $("idolGreeting").textContent =
    `${currentProfile.display_name}さん、今日の記録を確認しましょう。`;
}

async function loadSettings() {
  const { data, error } = await db
    .from("settings")
    .select("*")
    .eq("group_id", currentGroup.id)
    .single();

  if (error || !data) return;

  $("eventName").value = data.event_name || "";
  $("timerSeconds").value = data.timer_seconds || 60;

  timerDuration = Number(data.timer_seconds) || 60;

  $("timerDisplay").textContent = timerDuration;

  $("footerEventName").textContent =
    data.event_name || currentGroup.group_name;

  const url = data.timetree_url || "";
  $("timeTreeUrl").value = url;

  const link = $("timeTreeLink");

  if (url) {
    link.href = url;
    link.classList.remove("disabled-link");
  } else {
    link.href = "#";
    link.classList.add("disabled-link");
  }
}

async function saveSettings() {
  if (currentProfile.role !== "staff") return;

  const eventName =
    $("eventName").value.trim() || currentGroup.group_name;

  const seconds = Math.max(
    1,
    Math.min(
      3600,
      Number($("timerSeconds").value) || 60
    )
  );

  const url = $("timeTreeUrl").value.trim();

  const { error } = await db
  .from("settings")
  .upsert(
    {
      group_id: currentGroup.id,
      event_name: eventName,
      timer_seconds: seconds,
      timetree_url: url || null,
      updated_at: new Date().toISOString()
    },
    { onConflict: "group_id" }
  );

  if (error) {
  console.error(error);
  return toast(error.message);
}

  timerDuration = seconds;

  await loadSettings();

  toast("設定を保存しました。");
}

async function loadProducts() {
  const { data } = await db
    .from("products")
    .select("*")
    .eq("group_id", currentGroup.id)
    .order("name");

  const products = data || [];

  const select = $("saleProduct");

  if (select) {
    select.innerHTML = products.length
      ? products
          .map(
            (p) =>
              `<option value="${p.id}">${escapeHtml(
                p.name
              )}（¥${p.price.toLocaleString()} / 在庫${
                p.stock
              }）</option>`
          )
          .join("")
      : `<option value="">商品がありません</option>`;
  }

  const list = $("productList");

  if (list) {
    list.innerHTML = products.length
      ? products
          .map(
            (p) => `
      <div class="list-row">
        <div>
          <strong>${escapeHtml(p.name)}</strong>
          <span>¥${p.price.toLocaleString()}　/　在庫 ${p.stock}</span>
        </div>

        <div class="row-actions">
          <button type="button" data-edit-product="${p.id}">
            編集
          </button>

          <button type="button" data-delete-product="${p.id}">
            削除
          </button>
        </div>
      </div>`
          )
          .join("")
      : `<div class="empty">商品がありません。</div>`;

    list
      .querySelectorAll("[data-edit-product]")
      .forEach((b) =>
        b.addEventListener("click", () =>
          openProductModal(b.dataset.editProduct)
        )
      );

    list
      .querySelectorAll("[data-delete-product]")
      .forEach((b) =>
        b.addEventListener("click", () =>
          deleteProduct(b.dataset.deleteProduct)
        )
      );
  }
}

async function addProduct() {
  const name = $("newProductName").value.trim();
  const price = Number($("newProductPrice").value);
  const stock = Number($("newProductStock").value);

  if (!name || price < 0 || stock < 0) {
    return toast("商品名・価格・在庫を確認してください。");
  }

const { error } = await db
    .from("products")
    .insert({
      group_id: currentGroup.id,
      name,
      price,
      stock
    });

  if (error) {
    return toast("商品を追加できませんでした。");
  }

  $("newProductName").value = "";
  $("newProductPrice").value = "";
  $("newProductStock").value = "";

  await loadProducts();

  toast("商品を追加しました。");
}

async function openProductModal(id) {
  const { data } = await db
    .from("products")
    .select("*")
    .eq("id", id)
    .single();

  if (!data) return;

  editingProductId = id;

  $("editProductName").value = data.name;
  $("editProductPrice").value = data.price;
  $("editProductStock").value = data.stock;

  $("productModal").classList.remove("hidden");
}

function closeProductModal() {
  editingProductId = null;
  $("productModal").classList.add("hidden");
}

async function saveProduct() {
  if (!editingProductId) return;

  const payload = {
    name: $("editProductName").value.trim(),
    price: Number($("editProductPrice").value),
    stock: Number($("editProductStock").value)
  };

  if (
    !payload.name ||
    payload.price < 0 ||
    payload.stock < 0
  ) {
    return toast("入力内容を確認してください。");
  }

  const { error } = await db
    .from("products")
    .update(payload)
    .eq("id", editingProductId)
    .eq("group_id", currentGroup.id);

  if (error) {
    return toast("商品を更新できませんでした。");
  }

  closeProductModal();

  await loadProducts();

  toast("商品を更新しました。");
}

async function deleteProduct(id) {
  if (!confirm("この商品を削除しますか？")) return;

  const { error } = await db
    .from("products")
    .delete()
    .eq("id", id)
    .eq("group_id", currentGroup.id);

  if (error) {
    return toast(
      "販売履歴がある商品は削除できない場合があります。"
    );
  }

  await loadProducts();

  toast("商品を削除しました。");
}

async function previewSale() {
  const productId = $("saleProduct").value;
  const quantity = Number($("saleQuantity").value);
  const payment = $("salePayment").value;

  if (!productId || quantity < 1) {
    return toast("商品と数量を確認してください。");
  }

  const { data: product } = await db
    .from("products")
    .select("*")
    .eq("id", productId)
    .single();

  if (!product) {
    return toast("商品が見つかりません。");
  }

  if (quantity > product.stock) {
    return toast(`在庫は ${product.stock} 個です。`);
  }

  const total = product.price * quantity;

  $("saleConfirmContent").innerHTML = `
    <dl class="confirm-list">
      <dt>商品</dt>
      <dd>${escapeHtml(product.name)}</dd>

      <dt>数量</dt>
      <dd>${quantity}</dd>

      <dt>単価</dt>
      <dd>¥${product.price.toLocaleString()}</dd>

      <dt>合計</dt>
      <dd>¥${total.toLocaleString()}</dd>

      <dt>支払い</dt>
      <dd>${paymentLabels[payment]}</dd>
    </dl>
  `;

  $("saleConfirmModal").dataset.productId = productId;
  $("saleConfirmModal").dataset.quantity = quantity;
  $("saleConfirmModal").dataset.payment = payment;

  $("saleConfirmModal").classList.remove("hidden");
}

async function finalizeSale() {
  const modal = $("saleConfirmModal");

  const productId = modal.dataset.productId;
  const quantity = Number(modal.dataset.quantity);
  const payment = modal.dataset.payment;

  const { error } = await db.rpc("register_sale", {
    p_product_id: productId,
    p_quantity: quantity,
    p_payment_method: payment
  });

  if (error) {
    return toast(
      error.message || "売上を確定できませんでした。"
    );
  }

  modal.classList.add("hidden");

  $("saleQuantity").value = 1;

  await loadProducts();
  await loadDashboard();

  toast("売上を確定しました。");
}

async function loadSalesHistory() {
  const year =
    Number($("historyYear").value) ||
    new Date().getFullYear();

  const start = `${year}-01-01T00:00:00`;
  const end = `${year + 1}-01-01T00:00:00`;

  const [a, b] = await Promise.all([
    db
      .from("sales")
      .select("*")
      .eq("group_id", currentGroup.id)
      .gte("sold_at", start)
      .lt("sold_at", end),

    db
      .from("sales_archive")
      .select("*")
      .eq("group_id", currentGroup.id)
      .gte("sold_at", start)
      .lt("sold_at", end)
  ]);

  const rows = [
    ...(a.data || []),
    ...(b.data || [])
  ].sort(
    (x, y) =>
      new Date(y.sold_at) -
      new Date(x.sold_at)
  );

  const total = rows.reduce(
    (s, r) => s + r.total_amount,
    0
  );

  const qty = rows.reduce(
    (s, r) => s + r.quantity,
    0
  );

  $("annualSales").textContent =
    `¥${total.toLocaleString()}`;

  $("annualQuantity").textContent =
    qty.toLocaleString();

  const groups = {};

  rows.forEach((r) => {
    const d = new Date(r.sold_at);

    const key =
      `${d.getFullYear()}-${String(
        d.getMonth() + 1
      ).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;

    (groups[key] ||= []).push(r);
  });

  $("historyList").innerHTML =
    Object.entries(groups)
      .map(([date, items]) => {
        const dayTotal = items.reduce(
          (s, r) => s + r.total_amount,
          0
        );

        const dayQty = items.reduce(
          (s, r) => s + r.quantity,
          0
        );

        return `
          <article class="history-day">
            <h3>${date}</h3>

            ${items
              .map(
                (r) => `
                <div class="list-row">
                  <div>
                    <strong>${escapeHtml(
                      r.product_name
                    )}</strong>

                    <span>
                      ${r.quantity}個 ×
                      ¥${r.unit_price.toLocaleString()}
                      /
                      ${
                        paymentLabels[
                          r.payment_method
                        ] || r.payment_method
                      }
                    </span>
                  </div>

                  <strong>
                    ¥${r.total_amount.toLocaleString()}
                  </strong>
                </div>
              `
              )
              .join("")}

            <div class="day-total">
              合計 ¥${dayTotal.toLocaleString()}
              / ${dayQty}個
            </div>
          </article>
        `;
      })
      .join("") ||
    `<div class="empty">この年の売上はありません。</div>`;
}

async function loadDashboard() {
  const today =
    `${localDate()}T00:00:00`;

  const tomorrow =
    `${localDate(
      new Date(Date.now() + 86400000)
    )}T00:00:00`;

  const { data } = await db
    .from("sales")
    .select("total_amount,quantity")
    .eq("group_id", currentGroup.id)
    .gte("sold_at", today)
    .lt("sold_at", tomorrow);

  const rows = data || [];

  $("dashboardSales").textContent =
    `¥${rows
      .reduce(
        (s, r) => s + r.total_amount,
        0
      )
      .toLocaleString()}`;

  $("dashboardQuantity").textContent =
    rows
      .reduce(
        (s, r) => s + r.quantity,
        0
      )
      .toLocaleString();
}

async function loadMembers() {
  const { data } = await db
    .from("members")
    .select("*")
    .eq("group_id", currentGroup.id)
    .order("name");

  const list = $("memberList");
  const members = data || [];

  window.timerMembers = members;

  list.innerHTML = members.length
    ? members
        .map(
          (m) =>
            `<div class="list-row">
              <strong>${escapeHtml(m.name)}</strong>

              <button
                type="button"
                data-delete-member="${m.id}"
              >
                削除
              </button>
            </div>`
        )
        .join("")
    : `<div class="empty">メンバーがいません。</div>`;

  list
    .querySelectorAll("[data-delete-member]")
    .forEach((b) =>
      b.addEventListener("click", () =>
        deleteMember(b.dataset.deleteMember)
      )
    );

  renderMemberTimers();
}

async function addMember() {
  const name = $("newMemberName").value.trim();

  if (!name) {
    return toast("メンバー名を入力してください。");
  }

  const { error } = await db
    .from("members")
    .insert({
      group_id: currentGroup.id,
      name
    });

  if (error) {
    return toast("メンバーを追加できませんでした。");
  }

  $("newMemberName").value = "";

  await loadMembers();

  toast("メンバーを追加しました。");
}

async function deleteMember(id) {
  if (!confirm("このメンバーを削除しますか？")) {
    return;
  }

  const { error } = await db
    .from("members")
    .delete()
    .eq("id", id)
    .eq("group_id", currentGroup.id);

  if (error) {
    return toast("メンバーを削除できませんでした。");
  }

  await loadMembers();
}

async function loadTimerData() {
  await loadMembers();
  await loadSettings();
}

function startMemberTimer(memberId) {
  const timer = memberTimers[memberId];

  if (!timer || timer.running) return;

  timer.value = timerDuration;
  timer.running = true;

  renderMemberTimers();

  timer.interval = setInterval(() => {
    timer.value -= 1;

    const display = $(`timer-${memberId}`);
    if (display) display.textContent = timer.value;

    if (timer.value <= 0) {
      clearInterval(timer.interval);

      timer.interval = null;
      timer.running = false;
      timer.value = timerDuration;

      renderMemberTimers();

      toast("タイマー終了");
    }
  }, 1000);
}

function renderMemberTimers() {
  const list = $("memberTimerList");
  if (!list) return;

  list.innerHTML = "";

  if (!window.timerMembers?.length) {
    list.innerHTML = "<p>メンバーがいません。</p>";
    return;
  }

  window.timerMembers.forEach((member) => {
    if (!memberTimers[member.id]) {
      memberTimers[member.id] = {
        value: timerDuration,
        running: false,
        interval: null
      };
    }

    const timer = memberTimers[member.id];

    const card = document.createElement("div");
    card.className = "timer-panel";

    card.innerHTML = `
      <h3>${escapeHtml(member.name)}</h3>

      <div class="timer-display" id="timer-${member.id}">
        ${timer.value}
      </div>

      <button
        class="primary-button timer-start"
        type="button"
        data-timer-member="${member.id}"
        ${timer.running ? "disabled" : ""}
      >
        開始
      </button>
    `;

    list.appendChild(card);
  });
}


async function renderCalendar() {
  const y = currentCalendarDate.getFullYear();
  const m = currentCalendarDate.getMonth();

  $("calendarMonth").textContent =
    `${y}年${m + 1}月`;

  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);

  const startOffset =
    (first.getDay() + 6) % 7;

  const total =
    Math.ceil(
      (startOffset + last.getDate()) / 7
    ) * 7;

  const startDate =
    new Date(y, m, 1 - startOffset);

  const endDate =
    new Date(
      y,
      m,
      1 - startOffset + total
    );

  const { data } = await db
    .from("schedules")
    .select(
      "id,type,title,event_date,start_time,end_time,location,created_by"
    )
    .eq("group_id", currentGroup.id)
    .gte(
      "event_date",
      dateOnly(startDate)
    )
    .lt(
      "event_date",
      dateOnly(endDate)
    )
    .order("event_date")
    .order("start_time");

  const rows = data || [];

  const unavailableIds = rows
    .filter((r) => r.type === "unavailable")
    .map((r) => r.created_by);

  const { data: people } =
    unavailableIds.length
      ? await db
          .from("profiles")
          .select("id,display_name")
          .in("id", unavailableIds)
      : { data: [] };

  const names = Object.fromEntries(
    (people || []).map((p) => [
      p.id,
      p.display_name
    ])
  );

  rows.forEach((r) => {
    r.creatorName =
      names[r.created_by] || "参加不可";
  });

  const byDate = {};

  rows.forEach((r) => {
    (byDate[r.event_date] ||= []).push(r);
  });

  const labels = [
    "月",
    "火",
    "水",
    "木",
    "金",
    "土",
    "日"
  ];

  let html = labels
    .map(
      (x) =>
        `<div class="calendar-weekday">${x}</div>`
    )
    .join("");

  for (let i = 0; i < total; i++) {
    const d = new Date(startDate);

    d.setDate(
      startDate.getDate() + i
    );

    const key = dateOnly(d);
    const outside = d.getMonth() !== m;
    const items = byDate[key] || [];

    html += `
      <button
        type="button"
        class="calendar-cell ${
          outside ? "outside" : ""
        }"
        data-date="${key}"
      >
        <span class="calendar-date">
          ${d.getDate()}
        </span>

        ${items
          .slice(0, 4)
          .map(calendarItem)
          .join("")}

        ${
          items.length > 4
            ? `<span class="calendar-more">
                +${items.length - 4}件
              </span>`
            : ""
        }
      </button>
    `;
  }

  $("calendarGrid").innerHTML = html;

  $("calendarGrid")
    .querySelectorAll("[data-date]")
    .forEach((b) =>
      b.addEventListener("click", () =>
        openCalendarDay(b.dataset.date)
      )
    );
}

function calendarItem(r) {
  if (r.type === "unavailable") {
    return `
      <span class="calendar-item unavailable">
        🚫 ${escapeHtml(
          r.creatorName || "参加不可"
        )}
      </span>
    `;
  }

  const time = r.start_time
    ? r.start_time.slice(0, 5)
    : "";

  return `
    <span class="calendar-item event">
      🎤 ${escapeHtml(r.title)}
      ${time ? ` ${time}` : ""}
    </span>
  `;
}

function changeMonth(delta) {
  currentCalendarDate.setMonth(
    currentCalendarDate.getMonth() + delta
  );

  renderCalendar();
}

async function openCalendarDay(date) {
  selectedDay = date;

  $("calendarDayTitle").textContent =
    formatDate(date);

  $("calendarDayPanel").classList.remove(
    "hidden"
  );

  await renderCalendarDayDetails();
}

async function renderCalendarDayDetails() {
  if (!selectedDay) return;

  const { data } = await db
    .from("schedules")
    .select(
      "id,type,title,event_date,start_time,end_time,location,created_by"
    )
    .eq("group_id", currentGroup.id)
    .eq("event_date", selectedDay)
    .order("start_time");

  const rows = data || [];

  const unavailableCreators = rows
    .filter((r) => r.type === "unavailable")
    .map((r) => r.created_by);

  const { data: profiles } =
    unavailableCreators.length
      ? await db
          .from("profiles")
          .select("id,display_name")
          .in(
            "id",
            unavailableCreators
          )
      : { data: [] };

  const names = Object.fromEntries(
    (profiles || []).map((p) => [
      p.id,
      p.display_name
    ])
  );

  $("calendarDayDetails").innerHTML =
    rows.length
      ? rows
          .map(
            (r) => `
            <article class="schedule-detail">

              <div>
                <strong>
                  ${
                    r.type === "unavailable"
                      ? "🚫 参加できない"
                      : "🎤 " +
                        escapeHtml(r.title)
                  }
                </strong>
              </div>

              ${
                r.type === "unavailable"
                  ? `
                    <p>
                      ${escapeHtml(
                        names[r.created_by] ||
                          "メンバー"
                      )}
                    </p>
                  `
                  : `
                    <p>
                      ${
                        r.start_time
                          ? `開始 ${r.start_time.slice(
                              0,
                              5
                            )}`
                          : ""
                      }

                      ${
                        r.end_time
                          ? ` / 終了 ${r.end_time.slice(
                              0,
                              5
                            )}`
                          : ""
                      }
                    </p>

                    <p>
                      ${escapeHtml(
                        r.location || ""
                      )}
                    </p>
                  `
              }

              ${
                canEditSchedule(r)
                  ? `
                    <div class="row-actions">

                      <button
                        type="button"
                        data-edit-schedule="${r.id}"
                      >
                        編集
                      </button>

                      <button
                        type="button"
                        data-delete-schedule="${r.id}"
                      >
                        削除
                      </button>

                    </div>
                  `
                  : ""
              }

            </article>
          `
          )
          .join("")
      : `<div class="empty">この日の予定はありません。</div>`;

  $("calendarDayDetails")
    .querySelectorAll("[data-edit-schedule]")
    .forEach((b) =>
      b.addEventListener("click", () =>
        openScheduleModal(
          b.dataset.editSchedule
        )
      )
    );

  $("calendarDayDetails")
    .querySelectorAll("[data-delete-schedule]")
    .forEach((b) =>
      b.addEventListener("click", () =>
        deleteSchedule(
          b.dataset.deleteSchedule
        )
      )
    );
}

function canEditSchedule(r) {
  if (currentProfile.role === "staff") {
    return r.type !== "unavailable";
  }

  return (
    r.type === "unavailable" &&
    r.created_by === currentProfile.id
  );
}

function closeCalendarDay() {
  selectedDay = null;

  $("calendarDayPanel").classList.add(
    "hidden"
  );
}

async function openScheduleModal(id = null) {
  editingScheduleId = id;

  $("scheduleModal").classList.remove(
    "hidden"
  );

  const unavailable =
    currentProfile.role === "idol";

  $("scheduleType").innerHTML =
    currentProfile.role === "staff"
      ? `
        <option value="event">
          ライブ・イベント
        </option>

        <option value="other">
          その他の予定
        </option>
      `
      : `
        <option value="unavailable">
          参加できない
        </option>
      `;

  if (id) {
    const { data } = await db
      .from("schedules")
      .select("*")
      .eq("id", id)
      .single();

    if (!data) {
      return closeScheduleModal();
    }

    $("scheduleType").value =
      data.type;

    $("scheduleTitle").value =
      data.title || "";

    $("scheduleDate").value =
      data.event_date;

    $("scheduleStart").value =
      data.start_time || "";

    $("scheduleEnd").value =
      data.end_time || "";

    $("scheduleLocation").value =
      data.location || "";
  } else {
    $("scheduleType").value =
      unavailable
        ? "unavailable"
        : "event";

    $("scheduleTitle").value = "";

    $("scheduleDate").value =
      selectedDay || localDate();

    $("scheduleStart").value = "";
    $("scheduleEnd").value = "";
    $("scheduleLocation").value = "";
  }

  toggleScheduleFields();

  $("scheduleType").onchange =
    toggleScheduleFields;
}

function toggleScheduleFields() {
  const unavailable =
    $("scheduleType").value ===
    "unavailable";

  $("scheduleTitle")
    .parentElement.classList.toggle(
      "hidden",
      unavailable
    );

  $("scheduleStart")
    .parentElement.classList.toggle(
      "hidden",
      unavailable
    );

  $("scheduleEnd")
    .parentElement.classList.toggle(
      "hidden",
      unavailable
    );

  $("scheduleLocation")
    .parentElement.classList.toggle(
      "hidden",
      unavailable
    );
}

function closeScheduleModal() {
  editingScheduleId = null;

  $("scheduleModal").classList.add(
    "hidden"
  );
}

async function saveSchedule() {
  const type =
    $("scheduleType").value;

  const date =
    $("scheduleDate").value;

  if (!date) {
    return toast("日付を入力してください。");
  }

  if (
    currentProfile.role === "idol" &&
    type !== "unavailable"
  ) {
    return toast(
      "アイドルは参加不可のみ登録できます。"
    );
  }

  const payload = {
    group_id: currentGroup.id,
    created_by: currentProfile.id,
    type,

    title:
      type === "unavailable"
        ? null
        : $("scheduleTitle")
            .value
            .trim(),

    event_date: date,

    start_time:
      type === "unavailable"
        ? null
        : $("scheduleStart").value ||
          null,

    end_time:
      type === "unavailable"
        ? null
        : $("scheduleEnd").value ||
          null,

    location:
      type === "unavailable"
        ? null
        : $("scheduleLocation")
            .value
            .trim() || null
  };

  if (
    type !== "unavailable" &&
    !payload.title
  ) {
    return toast("予定名を入力してください。");
  }

  let result;

  if (editingScheduleId) {
    result = await db
      .from("schedules")
      .update(payload)
      .eq("id", editingScheduleId);
  } else {
    result = await db
      .from("schedules")
      .insert(payload);
  }

  if (result.error) {
    return toast("予定を保存できませんでした。");
  }

  closeScheduleModal();

  await renderCalendar();

  if (selectedDay) {
    await renderCalendarDayDetails();
  }

  toast("予定を保存しました。");
}

async function deleteSchedule(id) {
  if (!confirm("この予定を削除しますか？")) {
    return;
  }

  const { error } = await db
    .from("schedules")
    .delete()
    .eq("id", id);

  if (error) {
    return toast("予定を削除できませんでした。");
  }

  await renderCalendar();
  await renderCalendarDayDetails();
}

async function loadStaffHealth() {
  const date =
    $("healthDate").value ||
    localDate();

  const { data: idols } =
    await db
      .from("profiles")
      .select("id,display_name")
      .eq("group_id", currentGroup.id)
      .eq("role", "idol")
      .order("display_name");

  const ids =
    (idols || []).map(
      (i) => i.id
    );

  const { data: records } =
    ids.length
      ? await db
          .from("health_records")
          .select("*")
          .in("idol_id", ids)
          .eq("record_date", date)
      : { data: [] };

  const map = Object.fromEntries(
    (records || []).map((r) => [
      r.idol_id,
      r
    ])
  );

  $("staffHealthList").innerHTML =
    (idols || [])
      .map((i) => {
        const r = map[i.id];

        const wakeText = r?.wake_time
          ? `起床 ${new Date(
              r.wake_time
            ).toLocaleTimeString(
              "ja-JP",
              {
                hour: "2-digit",
                minute: "2-digit"
              }
            )}`
          : "未起床";

        return `
          <article
            class="health-card ${
              !r?.wake_time
                ? "not-awake"
                : r.health === "良くない"
                ? "bad"
                : ""
            }"
          >

            <strong>
              ${escapeHtml(
                i.display_name
              )}
            </strong>

            <span>
              ${wakeText}
            </span>

            <span>
              ${r?.health || "未入力"}
            </span>

            ${
              r?.memo
                ? `<p>${escapeHtml(
                    r.memo
                  )}</p>`
                : ""
            }

          </article>
        `;
      })
      .join("") ||
    `<div class="empty">アイドルがいません。</div>`;
}

async function loadTodayHealth() {
  const { data } = await db
    .from("health_records")
    .select("*")
    .eq(
      "idol_id",
      currentProfile.id
    )
    .eq(
      "record_date",
      localDate()
    )
    .maybeSingle();

  $("wakeTime").textContent =
    data?.wake_time
      ? new Date(
          data.wake_time
        ).toLocaleTimeString(
          "ja-JP",
          {
            hour: "2-digit",
            minute: "2-digit"
          }
        )
      : "未起床";

  document
    .querySelectorAll("[data-health]")
    .forEach((b) =>
      b.classList.toggle(
        "selected",
        b.dataset.health ===
          data?.health
      )
    );

  $("healthMemo").value =
    data?.memo || "";

  $("idolTodaySummary").innerHTML = `
    <div class="summary-line">
      起床：
      ${
        data?.wake_time
          ? new Date(
              data.wake_time
            ).toLocaleTimeString(
              "ja-JP",
              {
                hour: "2-digit",
                minute: "2-digit"
              }
            )
          : "未起床"
      }
    </div>

    <div class="summary-line">
      体調：
      ${escapeHtml(
        data?.health || "未入力"
      )}
    </div>
  `;
}

async function markWake() {
  await upsertHealth({
    wake_time:
      new Date().toISOString()
  });

  await loadTodayHealth();

  toast("起床時刻を記録しました。");
}

async function saveHealth() {
  const button =
    document.querySelector(
      "[data-health].selected"
    );

  if (!button) {
    return toast(
      "体調を選択してください。"
    );
  }

  await upsertHealth({
    health:
      button.dataset.health,

    memo:
      $("healthMemo")
        .value
        .trim() || null
  });

  await loadTodayHealth();

  toast("体調を保存しました。");
}

async function upsertHealth(changes) {
  const base = {
    group_id: currentGroup.id,
    idol_id: currentProfile.id,
    record_date: localDate(),
    ...changes,
    updated_at:
      new Date().toISOString()
  };

  const { error } = await db
    .from("health_records")
    .upsert(
      base,
      {
        onConflict:
          "idol_id,record_date"
      }
    );

  if (error) {
    toast(
      "体調データを保存できませんでした。"
    );
  }
}

async function loadIdolHistory() {
  const { data } = await db
    .from("health_records")
    .select("*")
    .eq(
      "idol_id",
      currentProfile.id
    )
    .order("record_date", {
      ascending: false
    })
    .limit(90);

  $("idolHistoryList").innerHTML =
    (data || [])
      .map(
        (r) => `
          <article class="history-day">

            <h3>
              ${r.record_date}
            </h3>

            <div class="list-row">
              <span>起床</span>

              <strong>
                ${
                  r.wake_time
                    ? new Date(
                        r.wake_time
                      ).toLocaleTimeString(
                        "ja-JP",
                        {
                          hour: "2-digit",
                          minute: "2-digit"
                        }
                      )
                    : "未起床"
                }
              </strong>
            </div>

            <div class="list-row">
              <span>体調</span>

              <strong>
                ${escapeHtml(
                  r.health ||
                    "未入力"
                )}
              </strong>
            </div>

            ${
              r.memo
                ? `<p>${escapeHtml(
                    r.memo
                  )}</p>`
                : ""
            }

          </article>
        `
      )
      .join("") ||
    `<div class="empty">履歴がありません。</div>`;
}

function localDate(date = new Date()) {
  const y = date.getFullYear();

  const m = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const d = String(
    date.getDate()
  ).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

function dateOnly(date) {
  return localDate(date);
}

function formatDate(s) {
  const [y, m, d] =
    s.split("-").map(Number);

  return `${y}年${m}月${d}日`;
}

function toast(msg) {
  const t = $("toast");

  t.textContent = msg;

  t.classList.add("show");

  clearTimeout(toast.timer);

  toast.timer = setTimeout(
    () =>
      t.classList.remove("show"),
    2600
  );
}

function setBusy(id, busy) {
  const b = $(id);

  if (b) {
    b.disabled = busy;

    b.dataset.originalText ||=
      b.textContent;

    b.textContent = busy
      ? "処理中…"
      : b.dataset.originalText;
  }
}

function escapeHtml(v = "") {
  return String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[c])
  );
}