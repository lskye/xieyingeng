/* ============================================================
 * 这是谐音梗 —— 游戏逻辑  game.js
 * ============================================================
 * 谜题图片路径约定（按关卡编号自动查找）：
 *
 *     assets/img/<id>.<ext>
 *
 *   扩展名按 png → jpg → jpeg → webp → gif → svg → avif 依次尝试，
 *   命中即用；同一目录命中过的扩展名会被记住，后续不再重复试错。
 *   若关卡里手动写了 image，则优先使用手写路径。
 *
 * 玩法：
 *   看谜题图 → 参考类别提示自己猜 → 点「提示」看思路
 *   → 点「答案」在图片一侧显示【答案文字】+ 解析，并解锁下一关
 * ============================================================ */

(function () {
  "use strict";

  const STORAGE_KEY = "xieyingeng_progress_v1";

  /* ---------- 图片 / 布局配置 ---------- */
  const IMG = {
    puzzleDir: "assets/img",
    extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"],
    minAspect: 0.6, // 宽/高 的上下限，避免极端比例把页面撑爆
    maxAspect: 1.7,
    fallbackAspect: 4 / 3,
    gap: 16, // 图片与答案列之间的间距（需与 CSS .stage gap 一致）
    answerColWide: 78, // 答案列预留宽度（宽屏）
    answerColNarrow: 64, // 答案列预留宽度（窄屏）
    maxHeightRatio: 0.55, // 图片最大高度占视口的比例
  };

  /* ---------- DOM ---------- */
  const $ = (sel) => document.querySelector(sel);

  const screenHome = $("#screen-home");
  const screenPlay = $("#screen-play");
  const levelGrid = $("#level-grid");
  const homeProgress = $("#home-progress");
  const homeProgressFill = $("#home-progress-fill");
  const homeProgressText = $("#home-progress-text");

  const playLevel = $("#play-level");
  const categoryValue = $("#category-value");
  const puzzleBox = $("#puzzle-box");
  const puzzleImg = $("#puzzle-img");
  const puzzleEmpty = $("#puzzle-empty");
  const answerPanel = $("#answer-panel");
  const answerText = $("#answer-text");
  const hintText = $("#hint-text");
  const answerBlock = $("#answer-block");
  const answerDesc = $("#answer-desc");

  const btnAnswer = $("#btn-answer");
  const btnNext = $("#btn-next");

  /* ---------- 状态 ---------- */
  const state = {
    levelIndex: 0,
    revealed: false,
    token: 0, // 防止快速切关时旧图片回填
    aspect: null, // 当前谜题图的宽高比，用于窗口变化时重新排版
  };

  /* ---------- 进度存档 ---------- */
  let progress = loadProgress();

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && typeof data.viewed === "object") return data;
      }
    } catch (e) {
      /* 忽略损坏的存档 */
    }
    return { viewed: {} };
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (e) {
      /* 隐私模式下可能失败，忽略 */
    }
  }

  function isViewed(levelId) {
    return !!progress.viewed[levelId];
  }

  // 第 1 关默认解锁，之后需查看过上一关的答案
  function isUnlocked(index) {
    if (index <= 0) return true;
    return isViewed(LEVELS[index - 1].id);
  }

  function viewedCount() {
    return LEVELS.filter((lv) => isViewed(lv.id)).length;
  }

  /* ---------- 图片路径解析 ---------- */
  const extCache = {}; // 目录 -> 已命中的扩展名

  function candidatePaths(dir, id, explicit) {
    if (explicit) return [explicit];
    const known = extCache[dir];
    const exts = known
      ? [known, ...IMG.extensions.filter((e) => e !== known)]
      : IMG.extensions;
    return exts.map((ext) => `${dir}/${id}.${ext}`);
  }

  function tryLoad(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ src, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function resolveImage(dir, id, explicit) {
    const list = candidatePaths(dir, id, explicit);
    for (const src of list) {
      const hit = await tryLoad(src);
      if (hit) {
        if (!explicit) extCache[dir] = src.slice(src.lastIndexOf(".") + 1);
        return hit;
      }
    }
    return null;
  }

  /* ---------- 图片框排版 ---------- */
  function clampAspect(w, h) {
    if (!w || !h) return IMG.fallbackAspect;
    const ratio = w / h;
    if (!isFinite(ratio) || ratio <= 0) return IMG.fallbackAspect;
    return Math.min(Math.max(ratio, IMG.minAspect), IMG.maxAspect);
  }

  // 按图片比例摆放：揭晓答案时给答案列让出宽度，图片自动缩小
  function layoutBox() {
    const ratio = state.aspect || IMG.fallbackAspect;
    const stageW = Math.min(window.innerWidth, 560) - 40; // 页面左右各 20px 内边距
    const colW = window.innerWidth < 380 ? IMG.answerColNarrow : IMG.answerColWide;
    const reserve = state.revealed ? IMG.gap + colW : 0;
    const availW = Math.max(130, stageW - reserve);
    const maxH = Math.max(200, window.innerHeight * IMG.maxHeightRatio);

    let w = availW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    puzzleBox.style.width = Math.round(w) + "px";
    puzzleBox.style.height = Math.round(h) + "px";
  }

  function resetBoxSize() {
    puzzleBox.style.width = "";
    puzzleBox.style.height = "";
    state.aspect = null;
  }

  function showLoading() {
    resetBoxSize();
    puzzleImg.hidden = true;
    puzzleImg.removeAttribute("src");
    puzzleEmpty.textContent = "加载中…";
    puzzleEmpty.hidden = false;
  }

  function showImage(hit, alt) {
    state.aspect = clampAspect(hit.width, hit.height);
    layoutBox();
    puzzleImg.src = hit.src;
    puzzleImg.alt = alt;
    puzzleImg.hidden = false;
    puzzleEmpty.hidden = true;
  }

  function showMissing(dir, id, explicit) {
    resetBoxSize();
    puzzleImg.hidden = true;
    puzzleImg.removeAttribute("src");
    puzzleEmpty.textContent =
      "暂未找到图片\n" + candidatePaths(dir, id, explicit).slice(0, 4).join("\n");
    puzzleEmpty.hidden = false;
  }

  /* ---------- 图标（内联 SVG，避免用 emoji 当图标） ---------- */
  const ICON_LOCK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
  const ICON_CHECK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  /* ---------- 首页 ---------- */
  function renderHome() {
    levelGrid.innerHTML = "";
    LEVELS.forEach((level, index) => {
      const unlocked = isUnlocked(index);
      const done = isViewed(level.id);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className =
        "level-cell" + (unlocked ? "" : " locked") + (done ? " solved" : "");
      cell.disabled = !unlocked;

      if (unlocked) {
        cell.innerHTML =
          `<span class="level-num">${level.id}</span>` +
          (done
            ? `<span class="level-check" aria-hidden="true">${ICON_CHECK}</span>`
            : "");
      } else {
        cell.innerHTML = ICON_LOCK;
      }

      cell.setAttribute(
        "aria-label",
        unlocked
          ? `第 ${level.id} 关${done ? "，已完成" : ""}`
          : `第 ${level.id} 关，未解锁`
      );
      if (unlocked) {
        cell.addEventListener("click", () => startLevel(index));
      }
      levelGrid.appendChild(cell);
    });

    const done = viewedCount();
    const total = LEVELS.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    homeProgressText.textContent = `${done} / ${total}`;
    homeProgressFill.style.width = `${pct}%`;
    homeProgress.setAttribute("aria-valuenow", String(pct));
  }

  function showScreen(name) {
    screenHome.classList.toggle("active", name === "home");
    screenPlay.classList.toggle("active", name === "play");
    window.scrollTo(0, 0);
  }

  /* ---------- 开始关卡 ---------- */
  async function startLevel(index) {
    state.levelIndex = index;
    state.revealed = false;
    state.token += 1;
    const token = state.token;
    const level = LEVELS[index];

    playLevel.textContent = `第 ${level.id} 关`;
    categoryValue.textContent = level.category || "—";

    hintText.hidden = true;
    hintText.textContent = "";
    answerPanel.hidden = true;
    answerText.textContent = "";
    answerBlock.hidden = true;
    answerDesc.textContent = "";

    btnAnswer.hidden = false;
    btnNext.hidden = true;

    showScreen("play");
    showLoading();

    const hit = await resolveImage(IMG.puzzleDir, level.id, level.image);
    if (token !== state.token) return; // 已切到别的关卡
    if (hit) showImage(hit, `第 ${level.id} 关谜题`);
    else showMissing(IMG.puzzleDir, level.id, level.image);
  }

  /* ---------- 揭晓答案 ---------- */
  function revealAnswer() {
    if (state.revealed) return;
    const level = LEVELS[state.levelIndex];
    state.revealed = true;

    // 记录进度并解锁下一关
    progress.viewed[level.id] = true;
    saveProgress();

    // 答案文字显示在图片一侧
    answerText.textContent = level.answer || "？";
    answerPanel.hidden = false;

    // 解析
    answerDesc.textContent = level.desc || "";
    answerBlock.hidden = false;

    // 按钮：答案 -> 下一关
    btnAnswer.hidden = true;
    btnNext.hidden = false;
    btnNext.textContent =
      state.levelIndex < LEVELS.length - 1 ? "下一关" : "完成，回首页";

    layoutBox(); // 为答案列让出宽度，图片自动缩小
  }

  /* ---------- 导航 ---------- */
  function goNext() {
    const nextIndex = state.levelIndex + 1;
    if (nextIndex < LEVELS.length && isUnlocked(nextIndex)) {
      startLevel(nextIndex);
    } else {
      goHome();
    }
  }

  function goHome() {
    state.token += 1; // 取消进行中的图片加载
    renderHome();
    showScreen("home");
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    // 窗口尺寸变化时重新排版
    window.addEventListener("resize", () => {
      if (state.aspect || state.revealed) layoutBox();
    });

    $("#btn-back").addEventListener("click", goHome);
    btnAnswer.addEventListener("click", revealAnswer);
    btnNext.addEventListener("click", goNext);

    // 提示：只给思路，不透露答案
    $("#btn-hint").addEventListener("click", () => {
      const level = LEVELS[state.levelIndex];
      hintText.textContent = level.hint || `提示：答案属于「${level.category}」。`;
      hintText.hidden = false;
    });

    $("#btn-reset").addEventListener("click", () => {
      if (confirm("确定要重置所有关卡进度吗？")) {
        progress = { viewed: {} };
        saveProgress();
        renderHome();
      }
    });
  }

  /* ---------- 启动 ---------- */
  function init() {
    if (!Array.isArray(LEVELS) || LEVELS.length === 0) {
      document.body.innerHTML =
        '<p style="color:#fff;font-family:sans-serif;padding:40px">未找到关卡数据，请检查 assets/js/levels.js</p>';
      return;
    }
    bindEvents();
    renderHome();
    showScreen("home");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
