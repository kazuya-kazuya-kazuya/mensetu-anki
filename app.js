// 面接想定問答 暗記ノート — アプリ本体
// データは data.js の window.QA_DATA から読み込む。外部送信は一切行わない。

(function () {
  'use strict';

  const STORAGE_KEY_BASE = 'mensetsu-anki:progress:v1';
  const DECK_STORAGE_KEY = 'mensetsu-anki:deck:v1';

  const DECKS = (window.QA_DATA && window.QA_DATA.decks) || [];

  // 'general'デッキは元々デッキ単位の保存キーを持たなかったため、
  // 既存の進捗を引き継げるように無印のキーのままにする。
  function progressKey(deckId) {
    return deckId === 'general' ? STORAGE_KEY_BASE : `${STORAGE_KEY_BASE}:${deckId}`;
  }

  function loadProgress(deckId) {
    try {
      const raw = localStorage.getItem(progressKey(deckId));
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch (e) {
      console.warn('進捗の読み込みに失敗しました', e);
      return {};
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(progressKey(currentDeck.id), JSON.stringify(progress));
    } catch (e) {
      console.warn('進捗の保存に失敗しました（ブラウザのストレージ制限の可能性があります）', e);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // ---------- デッキ（問答セット）管理 ----------

  let currentDeck = null;
  let allQuestions = [];
  let questionById = new Map();
  let answeredQuestions = [];
  let unansweredQuestions = [];
  let progress = {};

  function loadDeckData(deck) {
    allQuestions = [];
    questionById = new Map();
    deck.categories.forEach((cat) => {
      cat.questions.forEach((q) => {
        const item = { ...q, categoryName: cat.name };
        allQuestions.push(item);
        questionById.set(q.id, item);
      });
    });
    answeredQuestions = allQuestions.filter((q) => q.answer && q.answer.trim() !== '');
    unansweredQuestions = allQuestions.filter((q) => !q.answer || q.answer.trim() === '');
  }

  function resolveInitialDeckId() {
    let saved = null;
    try {
      saved = localStorage.getItem(DECK_STORAGE_KEY);
    } catch (e) {
      // localStorageが使えない環境では無視
    }
    if (saved && DECKS.some((d) => d.id === saved)) return saved;
    return DECKS[0] ? DECKS[0].id : null;
  }

  function selectDeck(deckId, opts) {
    const persist = !opts || opts.persist !== false;
    const deck = DECKS.find((d) => d.id === deckId) || DECKS[0];
    if (!deck) return;

    currentDeck = deck;
    loadDeckData(deck);
    progress = loadProgress(deck.id);

    if (persist) {
      try {
        localStorage.setItem(DECK_STORAGE_KEY, deck.id);
      } catch (e) {
        // 保存できなくても致命的ではない
      }
    }

    if (deckSelect.value !== deck.id) deckSelect.value = deck.id;
    appSub.textContent = `「${deck.label}」の問答をもとにした、個人練習用のノートです`;

    rebuildStudyCategoryOptions();
    studyState.categoryFilter = 'all';
    studyCategorySelect.value = 'all';
    rebuildDeck();
    renderList();
    renderUnanswered();

    tabVideo.hidden = !currentDeck.videoDir;
    if (tabVideo.hidden && tabVideo.classList.contains('is-active')) {
      tabVideo.classList.remove('is-active');
      tabVideo.setAttribute('aria-selected', 'false');
      const studyBtn = document.querySelector('.tab-btn[data-mode="study"]');
      studyBtn.classList.add('is-active');
      studyBtn.setAttribute('aria-selected', 'true');
      panels.forEach((p) => p.classList.toggle('is-active', p.dataset.panel === 'study'));
    }
    if (currentDeck.videoDir) renderVideo();
  }

  // ---------- デッキ切り替えUI ----------

  const deckSelect = document.getElementById('deckSelect');
  const appSub = document.getElementById('appSub');

  DECKS.forEach((deck) => {
    const opt = document.createElement('option');
    opt.value = deck.id;
    opt.textContent = deck.label;
    deckSelect.appendChild(opt);
  });

  deckSelect.addEventListener('change', () => {
    selectDeck(deckSelect.value);
  });

  // ---------- タブ切り替え ----------

  const tabButtons = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.panel');
  const tabVideo = document.getElementById('tabVideo');

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      tabButtons.forEach((b) => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      panels.forEach((p) => {
        p.classList.toggle('is-active', p.dataset.panel === mode);
      });
      if (mode === 'list') renderList();
      if (mode === 'unanswered') renderUnanswered();
      if (mode === 'video') renderVideo();
    });
  });

  // ============================================================
  // 暗記モード
  // ============================================================

  const studyCategorySelect = document.getElementById('studyCategory');
  const studyOnlyUnknown = document.getElementById('studyOnlyUnknown');
  const studyStage = document.getElementById('studyStage');
  const studyJudge = document.getElementById('studyJudge');
  const studyProgressFill = document.getElementById('studyProgressFill');
  const studyProgressText = document.getElementById('studyProgressText');
  const btnShuffle = document.getElementById('btnShuffle');
  const btnResetProgress = document.getElementById('btnResetProgress');
  const btnAgain = document.getElementById('btnAgain');
  const btnKnown = document.getElementById('btnKnown');

  // カテゴリ選択肢を用意（回答が1件も無いカテゴリは暗記対象が無いため注記を付ける）
  function rebuildStudyCategoryOptions() {
    studyCategorySelect.innerHTML = '';

    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = `すべて（${answeredQuestions.length}問）`;
    studyCategorySelect.appendChild(allOption);

    currentDeck.categories.forEach((cat) => {
      const answeredInCat = cat.questions.filter((q) => q.answer && q.answer.trim() !== '').length;
      const opt = document.createElement('option');
      opt.value = cat.name;
      opt.textContent = `${cat.name}（${answeredInCat}問）`;
      if (answeredInCat === 0) opt.disabled = true;
      studyCategorySelect.appendChild(opt);
    });
  }

  const studyState = {
    categoryFilter: 'all',
    deck: [], // question id の配列。先頭が現在のカード
    flipped: false,
  };

  function poolForFilter(categoryFilter) {
    if (categoryFilter === 'all') return answeredQuestions;
    return answeredQuestions.filter((q) => q.categoryName === categoryFilter);
  }

  function rebuildDeck() {
    const pool = poolForFilter(studyState.categoryFilter);
    let filtered = pool;
    if (studyOnlyUnknown.checked) {
      filtered = filtered.filter((q) => progress[q.id] !== 'known');
    }
    studyState.deck = filtered.map((q) => q.id);
    studyState.flipped = false;
    renderStudy();
  }

  function renderStudy() {
    const pool = poolForFilter(studyState.categoryFilter);
    const knownCount = pool.filter((q) => progress[q.id] === 'known').length;
    const total = pool.length;
    const pct = total === 0 ? 0 : Math.round((knownCount / total) * 100);
    studyProgressFill.style.width = `${pct}%`;
    studyProgressText.textContent = total === 0
      ? '回答が用意されている質問がありません'
      : `覚えた ${knownCount} / ${total}問（残り ${studyState.deck.length}問）`;

    if (total === 0) {
      studyStage.innerHTML = `
        <div class="study-empty">
          <div class="big">📭</div>
          <p>このカテゴリにはまだ回答が用意された質問がありません。<br>「未回答リスト」から回答を書き足してみましょう。</p>
        </div>`;
      studyJudge.style.visibility = 'hidden';
      return;
    }

    if (studyState.deck.length === 0) {
      studyStage.innerHTML = `
        <div class="study-empty">
          <div class="big">🎉</div>
          <p>このカテゴリの「未暗記」カードはすべて終わりました。<br>お疲れさまでした。</p>
        </div>`;
      studyJudge.style.visibility = 'hidden';
      return;
    }

    studyJudge.style.visibility = 'visible';
    const id = studyState.deck[0];
    const q = questionById.get(id);

    studyStage.innerHTML = `
      <div class="flash-card ${studyState.flipped ? 'is-flipped' : ''}" id="flashCard" role="button" tabindex="0" aria-label="タップして裏返す">
        <div class="flash-face flash-face-front">
          <div class="flash-meta">
            <span>${escapeHtml(q.categoryName)}</span>
            <span class="flash-no">${q.no ? 'No.' + escapeHtml(q.no) : ''}</span>
          </div>
          <span class="flash-label">質問</span>
          <div class="flash-body">${escapeHtml(q.question)}</div>
          <div class="flash-tap-hint">タップして回答を見る ▸</div>
        </div>
        <div class="flash-face flash-face-back">
          <div class="flash-meta">
            <span>${escapeHtml(q.categoryName)}</span>
            <span class="flash-no">${q.no ? 'No.' + escapeHtml(q.no) : ''}</span>
          </div>
          <span class="flash-label">回答</span>
          <div class="flash-body">${escapeHtml(q.answer)}</div>
          ${q.point ? `<div class="flash-point">💡 ${escapeHtml(q.point)}</div>` : ''}
        </div>
      </div>
    `;

    const cardEl = document.getElementById('flashCard');
    cardEl.addEventListener('click', toggleFlip);
    cardEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleFlip();
      }
    });
  }

  function toggleFlip() {
    studyState.flipped = !studyState.flipped;
    const cardEl = document.getElementById('flashCard');
    if (cardEl) cardEl.classList.toggle('is-flipped', studyState.flipped);
  }

  function judgeCurrent(result) {
    if (studyState.deck.length === 0) return;
    const id = studyState.deck.shift();
    progress[id] = result;
    saveProgress();
    if (result === 'again') {
      studyState.deck.push(id);
    }
    studyState.flipped = false;
    renderStudy();
  }

  studyCategorySelect.addEventListener('change', () => {
    studyState.categoryFilter = studyCategorySelect.value;
    rebuildDeck();
  });

  studyOnlyUnknown.addEventListener('change', rebuildDeck);

  btnShuffle.addEventListener('click', () => {
    shuffleArray(studyState.deck);
    studyState.flipped = false;
    renderStudy();
  });

  btnResetProgress.addEventListener('click', () => {
    const ok = window.confirm(`「${currentDeck.label}」の「覚えた」の記録をすべてリセットします。よろしいですか？`);
    if (!ok) return;
    progress = {};
    saveProgress();
    rebuildDeck();
    renderList();
    renderUnanswered();
  });

  btnAgain.addEventListener('click', () => judgeCurrent('again'));
  btnKnown.addEventListener('click', () => judgeCurrent('known'));

  // ============================================================
  // 一覧モード
  // ============================================================

  const listContainer = document.getElementById('listContainer');
  const btnExpandAll = document.getElementById('btnExpandAll');
  const btnCollapseAll = document.getElementById('btnCollapseAll');

  function renderList() {
    listContainer.innerHTML = '';

    currentDeck.categories.forEach((cat) => {
      const section = document.createElement('div');
      section.className = 'list-category is-open';

      const headerBtn = document.createElement('button');
      headerBtn.className = 'list-category-header';
      headerBtn.setAttribute('aria-expanded', 'true');
      headerBtn.innerHTML = `
        <span>${escapeHtml(cat.name)}</span>
        <span class="list-category-count">${cat.questions.length}問</span>
        <span class="list-category-chevron">▸</span>
      `;

      const body = document.createElement('div');
      body.className = 'list-category-body';

      cat.questions.forEach((q) => {
        const hasAnswer = q.answer && q.answer.trim() !== '';
        const known = progress[q.id] === 'known';
        const qa = document.createElement('div');
        qa.className = 'list-qa';
        qa.innerHTML = `
          <div class="list-qa-no">${q.no ? 'No.' + escapeHtml(q.no) : ''}${known ? ' ・ 覚えた✓' : ''}</div>
          <div class="list-qa-q">${escapeHtml(q.question)}</div>
          <div class="list-qa-a ${hasAnswer ? '' : 'is-empty'}">${
            hasAnswer ? escapeHtml(q.answer) : 'まだ回答が用意されていません'
          }</div>
          ${q.point ? `<div class="list-qa-point">💡 ${escapeHtml(q.point)}</div>` : ''}
        `;
        body.appendChild(qa);
      });

      headerBtn.addEventListener('click', () => {
        const open = section.classList.toggle('is-open');
        headerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });

      section.appendChild(headerBtn);
      section.appendChild(body);
      listContainer.appendChild(section);
    });
  }

  btnExpandAll.addEventListener('click', () => {
    document.querySelectorAll('.list-category').forEach((el) => {
      el.classList.add('is-open');
      el.querySelector('.list-category-header').setAttribute('aria-expanded', 'true');
    });
  });

  btnCollapseAll.addEventListener('click', () => {
    document.querySelectorAll('.list-category').forEach((el) => {
      el.classList.remove('is-open');
      el.querySelector('.list-category-header').setAttribute('aria-expanded', 'false');
    });
  });

  // ============================================================
  // 未回答リスト
  // ============================================================

  const unansweredSummary = document.getElementById('unansweredSummary');
  const unansweredContainer = document.getElementById('unansweredContainer');

  function renderUnanswered() {
    unansweredSummary.textContent = `未回答の質問: ${unansweredQuestions.length}問 / 全${allQuestions.length}問`;
    unansweredContainer.innerHTML = '';

    if (unansweredQuestions.length === 0) {
      unansweredContainer.innerHTML = `
        <div class="unanswered-empty">
          <div class="big" style="font-size:1.6rem;">🎉</div>
          <p>すべての質問に回答が用意されています。</p>
        </div>`;
      return;
    }

    unansweredQuestions.forEach((q) => {
      const item = document.createElement('div');
      item.className = 'unanswered-item';
      item.innerHTML = `
        <div class="unanswered-cat">${escapeHtml(q.categoryName)}${q.no ? ' ・ No.' + escapeHtml(q.no) : ''}</div>
        <div class="unanswered-q">${escapeHtml(q.question)}</div>
      `;
      unansweredContainer.appendChild(item);
    });
  }

  // ============================================================
  // 動画
  // ============================================================

  const videoContainer = document.getElementById('videoContainer');

  function renderVideo() {
    videoContainer.innerHTML = '';
    if (!currentDeck.videoDir) return;

    allQuestions.forEach((q) => {
      const no = String(q.no).padStart(3, '0');
      const src = `${currentDeck.videoDir}/${no}.mp4`;

      const item = document.createElement('div');
      item.className = 'video-item';
      item.innerHTML = `
        <div class="video-item-q">${q.no ? 'No.' + escapeHtml(q.no) + ' ・ ' : ''}${escapeHtml(q.question)}</div>
        <video class="video-player" controls preload="none" src="${escapeHtml(src)}"></video>
      `;
      videoContainer.appendChild(item);
    });
  }

  // ---------- 初期表示 ----------

  selectDeck(resolveInitialDeckId(), { persist: false });
})();
