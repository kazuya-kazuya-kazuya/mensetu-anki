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

    stopContinuousPlayback(false);
    listenAudio.pause();
    clearListenTimer();
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
    rebuildListening();
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
      if (mode === 'listen' && listenUnknown.checked) rebuildListening();
      if (mode !== 'video') stopContinuousPlayback(true);
      if (mode !== 'listen') listenAudio.pause();
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
  const continuousPlayBtn = document.getElementById('continuousPlayBtn');
  const shufflePlayBtn = document.getElementById('shufflePlayBtn');
  const continuousPlayStatus = document.getElementById('continuousPlayStatus');
  let continuousPlayback = false;
  let currentVideoIndex = 0;
  let playbackMode = null;
  let playbackQueue = [];
  let playbackPosition = 0;

  function videoPlayers() {
    return [...videoContainer.querySelectorAll('.video-player')];
  }

  function updateContinuousControls(message) {
    const sequentialActive = continuousPlayback && playbackMode === 'sequential';
    const shuffleActive = continuousPlayback && playbackMode === 'shuffle';
    continuousPlayBtn.textContent = sequentialActive ? '■ 連続再生を停止' : '▶ 連続再生';
    shufflePlayBtn.textContent = shuffleActive ? '■ ランダム再生を停止' : '⤨ ランダム再生';
    continuousPlayBtn.setAttribute('aria-pressed', sequentialActive ? 'true' : 'false');
    shufflePlayBtn.setAttribute('aria-pressed', shuffleActive ? 'true' : 'false');
    continuousPlayStatus.textContent = message || (continuousPlayback
      ? `${shuffleActive ? 'ランダム再生' : '連続再生'} ${playbackPosition + 1}/${playbackQueue.length} ・ No.${allQuestions[currentVideoIndex]?.no || currentVideoIndex + 1}`
      : '選択中の問題から順番に再生します');
  }

  function stopContinuousPlayback(keepPosition) {
    continuousPlayback = false;
    playbackMode = null;
    playbackQueue = [];
    playbackPosition = 0;
    const players = videoPlayers();
    players.forEach((player) => player.pause());
    if (!keepPosition) currentVideoIndex = 0;
    videoContainer.querySelectorAll('.video-item').forEach((item) => item.classList.remove('is-playing'));
    updateContinuousControls();
  }

  async function playVideoAt(index) {
    const players = videoPlayers();
    if (!players.length) return;
    currentVideoIndex = Math.max(0, Math.min(index, players.length - 1));
    players.forEach((player, playerIndex) => {
      if (playerIndex !== currentVideoIndex) player.pause();
    });
    const player = players[currentVideoIndex];
    player.closest('.video-item').scrollIntoView({ behavior: 'smooth', block: 'center' });
    try {
      await player.play();
      updateContinuousControls();
    } catch (error) {
      continuousPlayback = false;
      updateContinuousControls('再生ボタンを押してから、もう一度お試しください');
    }
  }

  continuousPlayBtn.addEventListener('click', () => {
    if (continuousPlayback && playbackMode === 'sequential') {
      stopContinuousPlayback(true);
      return;
    }
    continuousPlayback = true;
    playbackMode = 'sequential';
    playbackQueue = Array.from({ length: allQuestions.length - currentVideoIndex }, (_, index) => currentVideoIndex + index);
    playbackPosition = 0;
    playVideoAt(playbackQueue[playbackPosition]);
  });

  shufflePlayBtn.addEventListener('click', () => {
    if (continuousPlayback && playbackMode === 'shuffle') {
      stopContinuousPlayback(true);
      return;
    }
    continuousPlayback = true;
    playbackMode = 'shuffle';
    playbackQueue = Array.from({ length: allQuestions.length }, (_, index) => index);
    shuffleArray(playbackQueue);
    playbackPosition = 0;
    playVideoAt(playbackQueue[playbackPosition]);
  });

  function renderVideo() {
    stopContinuousPlayback(false);
    videoContainer.innerHTML = '';
    if (!currentDeck.videoDir) return;
    if (currentDeck.videoNotice) {
      const notice = document.createElement('p');
      notice.className = 'voice-credit';
      notice.textContent = currentDeck.videoNotice;
      videoContainer.appendChild(notice);
    }

    if (currentDeck.voiceCredit) {
      const credit = document.createElement('p');
      credit.className = 'voice-credit';
      credit.textContent = `音声：${currentDeck.voiceCredit}`;
      videoContainer.appendChild(credit);
    }

    allQuestions.forEach((q, index) => {
      const no = String(q.no).padStart(3, '0');
      const src = `${currentDeck.videoDir}/${no}.mp4${currentDeck.videoVersion ? `?v=${encodeURIComponent(currentDeck.videoVersion)}` : ''}`;

      const item = document.createElement('div');
      item.className = 'video-item';
      item.innerHTML = `
        <div class="video-item-q">${q.no ? 'No.' + escapeHtml(q.no) + ' ・ ' : ''}${escapeHtml(q.question)}</div>
        <video class="video-player" controls preload="none" src="${escapeHtml(src)}"></video>
      `;
      videoContainer.appendChild(item);

      const player = item.querySelector('.video-player');
      player.addEventListener('play', () => {
        listenAudio.pause();
        currentVideoIndex = index;
        videoPlayers().forEach((other, otherIndex) => {
          if (otherIndex !== index) other.pause();
        });
        videoContainer.querySelectorAll('.video-item').forEach((other) => other.classList.remove('is-playing'));
        item.classList.add('is-playing');
        if (continuousPlayback) updateContinuousControls();
      });
      player.addEventListener('pause', () => item.classList.remove('is-playing'));
      player.addEventListener('ended', () => {
        item.classList.remove('is-playing');
        if (!continuousPlayback) return;
        playbackPosition += 1;
        if (playbackPosition < playbackQueue.length) {
          playVideoAt(playbackQueue[playbackPosition]);
        } else {
          continuousPlayback = false;
          const completedMode = playbackMode;
          playbackMode = null;
          playbackQueue = [];
          playbackPosition = 0;
          currentVideoIndex = 0;
          updateContinuousControls(completedMode === 'shuffle' ? '全問のランダム再生が完了しました' : '全問の連続再生が完了しました');
        }
      });
    });
  }

  // ---------- 聞き流し：同じaudio要素で次の問題へ進む ----------
  const listenAudio = document.getElementById('listenAudio');
  const listenOrder = document.getElementById('listenOrder');
  const listenSpeed = document.getElementById('listenSpeed');
  const listenRepeat = document.getElementById('listenRepeat');
  const listenTimer = document.getElementById('listenTimer');
  const listenUnknown = document.getElementById('listenUnknown');
  const listenQuestion = document.getElementById('listenQuestion');
  const listenPlay = document.getElementById('listenPlay');
  const listenPrev = document.getElementById('listenPrev');
  const listenNext = document.getElementById('listenNext');
  const listenStatus = document.getElementById('listenStatus');
  let listenQueue = [];
  let listenIndex = 0;
  let listenDeadline = 0;
  let listenTimeout = null;
  let listenGeneration = 0;

  function clearListenTimer() {
    clearTimeout(listenTimeout);
    listenDeadline = 0;
    listenTimeout = null;
  }

  function expireListening() {
    listenAudio.pause();
    clearListenTimer();
    listenStatus.textContent = '設定した時間になったので停止しました';
  }

  function armListenTimer() {
    clearListenTimer();
    const delay = Number(listenTimer.value) * 60000;
    if (delay) {
      listenDeadline = Date.now() + delay;
      listenTimeout = setTimeout(expireListening, delay);
    }
  }

  function rebuildListening() {
    listenAudio.pause();
    clearListenTimer();
    listenQueue = currentDeck.videoDir ? answeredQuestions.filter(q => !listenUnknown.checked || progress[q.id] !== 'known') : [];
    if (listenOrder.value === 'shuffle') shuffleArray(listenQueue);
    listenIndex = 0;
    listenQuestion.replaceChildren();
    listenQueue.forEach((q, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = `No.${q.no} ${q.question}`;
      listenQuestion.appendChild(option);
    });
    [listenPlay, listenPrev, listenNext, listenQuestion].forEach(el => { el.disabled = !listenQueue.length; });
    document.getElementById('listenCredit').textContent = currentDeck.voiceCredit ? `音声：${currentDeck.voiceCredit}` : '';
    loadListenTrack();
  }

  function loadListenTrack() {
    listenGeneration += 1;
    listenAudio.pause();
    const q = listenQueue[listenIndex];
    if (!q) {
      listenAudio.removeAttribute('src');
      listenAudio.load();
      listenStatus.textContent = currentDeck.videoDir ? '再生対象がありません。「覚えた」を除く設定を外してください。' : 'この問答セットには音声がありません。二次面接対策などを選んでください。';
      ['listenTitle', 'listenAnswer', 'listenPoint'].forEach(id => { document.getElementById(id).textContent = ''; });
      return;
    }
    listenQuestion.value = String(listenIndex);
    listenStatus.textContent = `${listenIndex + 1} / ${listenQueue.length}問`;
    document.getElementById('listenTitle').textContent = `No.${q.no} ${q.question}`;
    document.getElementById('listenAnswer').textContent = q.answer;
    document.getElementById('listenPoint').textContent = q.point ? `補足：${q.point}` : '';
    listenAudio.src = `${currentDeck.videoDir}/audio/${String(q.no).padStart(3, '0')}.m4a?v=${encodeURIComponent(currentDeck.videoVersion || '1')}`;
    listenAudio.playbackRate = Number(listenSpeed.value);
    if ('mediaSession' in navigator && 'MediaMetadata' in window) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: `No.${q.no} ${q.question}`, artist: currentDeck.label });
    }
  }

  async function startListening() {
    if (!listenQueue.length) return;
    if (listenDeadline && Date.now() >= listenDeadline) { expireListening(); return; }
    stopContinuousPlayback(true);
    if (listenAudio.error) listenAudio.load();
    if (!listenDeadline) armListenTimer();
    const generation = listenGeneration;
    try { await listenAudio.play(); }
    catch (error) {
      if (generation === listenGeneration && error.name !== 'AbortError') {
        listenStatus.textContent = '再生できませんでした。通信状態を確認して再生ボタンを押してください。';
      }
    }
  }

  function moveListening(direction, automatic = false) {
    if (!listenQueue.length) return;
    if (listenDeadline && Date.now() >= listenDeadline) { expireListening(); return; }
    if (automatic && listenRepeat.value === 'one') {
      listenAudio.currentTime = 0;
      startListening();
      return;
    }
    const next = listenIndex + direction;
    if (automatic && next >= listenQueue.length && listenRepeat.value === 'off') {
      listenAudio.pause();
      clearListenTimer();
      listenStatus.textContent = '全問の再生が完了しました';
      return;
    }
    if (next >= listenQueue.length && listenOrder.value === 'shuffle') {
      const last = listenQueue[listenIndex];
      shuffleArray(listenQueue);
      if (listenQueue.length > 1 && listenQueue[0] === last) [listenQueue[0], listenQueue[1]] = [listenQueue[1], listenQueue[0]];
      listenQueue.forEach((q, i) => { listenQuestion.options[i].textContent = `No.${q.no} ${q.question}`; });
    }
    listenIndex = (next + listenQueue.length) % listenQueue.length;
    loadListenTrack();
    startListening();
  }

  listenPlay.addEventListener('click', () => { if (listenAudio.paused) startListening(); else listenAudio.pause(); });
  listenPrev.addEventListener('click', () => moveListening(-1));
  listenNext.addEventListener('click', () => moveListening(1));
  listenQuestion.addEventListener('change', () => { listenIndex = Number(listenQuestion.value); loadListenTrack(); startListening(); });
  listenOrder.addEventListener('change', rebuildListening);
  listenUnknown.addEventListener('change', rebuildListening);
  listenSpeed.addEventListener('change', () => { listenAudio.playbackRate = Number(listenSpeed.value); });
  listenTimer.addEventListener('change', () => { clearListenTimer(); if (!listenAudio.paused) armListenTimer(); });
  listenAudio.addEventListener('ended', () => moveListening(1, true));
  listenAudio.addEventListener('play', () => {
    if (listenDeadline && Date.now() >= listenDeadline) { expireListening(); return; }
    stopContinuousPlayback(true);
    if (!listenDeadline) armListenTimer();
    listenPlay.textContent = 'Ⅱ 一時停止';
    listenStatus.textContent = `${listenIndex + 1} / ${listenQueue.length}問 ・ 再生中`;
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  });
  listenAudio.addEventListener('pause', () => {
    listenPlay.textContent = '▶ 再生';
    if (listenStatus.textContent.includes('再生中')) listenStatus.textContent = `${listenIndex + 1} / ${listenQueue.length}問 ・ 一時停止中`;
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  });
  listenAudio.addEventListener('error', () => {
    if (listenAudio.hasAttribute('src')) listenStatus.textContent = '音声を読み込めませんでした。通信状態を確認して再生し直してください。';
  });
  listenAudio.addEventListener('timeupdate', () => {
    if (listenDeadline && Date.now() >= listenDeadline) expireListening();
  });
  if ('mediaSession' in navigator) {
    const handlers = { play: startListening, pause: () => listenAudio.pause(), previoustrack: () => moveListening(-1), nexttrack: () => moveListening(1) };
    Object.entries(handlers).forEach(([action, handler]) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) { /* 非対応端末 */ }
    });
  }

  // ---------- 初期表示 ----------

  selectDeck(resolveInitialDeckId(), { persist: false });
})();
