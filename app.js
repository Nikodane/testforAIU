const tests = [
  {
    id: "ict",
    title: "ИКТ",
    description: "Проверь знания по базовым темам ИКТ.",
    cover:
      "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1400&q=80",
    dataKey: "ict",
  },
];

const homeScreen = document.getElementById("homeScreen");
const testScreen = document.getElementById("testScreen");
const resultScreen = document.getElementById("resultScreen");
const testGrid = document.getElementById("testGrid");
const questionList = document.getElementById("questionList");
const timerLabel = document.getElementById("timerLabel");
const questionCounter = document.getElementById("questionCounter");
const correctCounter = document.getElementById("correctCounter");
const testTitle = document.getElementById("testTitle");
const reportCorrect = document.getElementById("reportCorrect");
const reportWrong = document.getElementById("reportWrong");
const reportTime = document.getElementById("reportTime");

const backHomeBtn = document.getElementById("backHomeBtn");
const toHomeBtn = document.getElementById("toHomeBtn");
const restartBtn = document.getElementById("restartBtn");
const restartFromTestBtn = document.getElementById("restartFromTestBtn");
const finishNowBtn = document.getElementById("finishNowBtn");
const modeStepBtn = document.getElementById("modeStepBtn");
const modeListBtn = document.getElementById("modeListBtn");

let activeTest = null;
let activeQuestions = [];
let answers = [];
let answeredCount = 0;
let correctCount = 0;
let currentQuestionIndex = 0;
let elapsedSec = 0;
let timerId = null;
let autoAdvanceId = null;
let finalizeDelayId = null;
let isQuestionTransitioning = false;
let transitionVersion = 0;

// Режим: "step" (по одному, как было) или "list" (длинный список с виртуализацией)
let viewMode = "step";

const AUTO_ADVANCE_MS = 420;
const FINALIZE_DELAY_MS = 340;
const QUESTION_TRANSITION_MS = 220;

// ===== Виртуализация для режима "list" =====
const ESTIMATED_ROW_HEIGHT = 320; // оценка высоты карточки до измерения
const RENDER_BUFFER = 4;          // сколько карточек подгружать вне экрана сверху/снизу
let listSlots = [];               // массив <li> плейсхолдеров с измеренной высотой
let listObserver = null;          // IntersectionObserver
let mountedCards = new Map();     // index -> .question-card (реально вмонтированные)
let resizeObserver = null;        // следит за изменением высоты карточек
let listScrollRaf = 0;

function formatTime(totalSec) {
  const safe = Math.max(0, totalSec);
  const minutes = Math.floor(safe / 60).toString().padStart(2, "0");
  const seconds = (safe % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function showScreen(screen) {
  homeScreen.classList.remove("active");
  testScreen.classList.remove("active");
  resultScreen.classList.remove("active");
  screen.classList.add("active");
}

function clearDeferredActions() {
  if (autoAdvanceId) { clearTimeout(autoAdvanceId); autoAdvanceId = null; }
  if (finalizeDelayId) { clearTimeout(finalizeDelayId); finalizeDelayId = null; }
  transitionVersion += 1;
  isQuestionTransitioning = false;
  const card = questionList.querySelector(".question-card");
  if (card) {
    card.classList.remove(
      "is-transitioning", "anim-out-next", "anim-out-prev",
      "anim-in-next", "anim-in-prev",
    );
  }
}

function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

function startTimer() {
  stopTimer();
  timerLabel.textContent = formatTime(elapsedSec);
  timerId = setInterval(() => {
    elapsedSec += 1;
    timerLabel.textContent = formatTime(elapsedSec);
  }, 1000);
}

function updateHeaderState() {
  questionCounter.textContent = `${answeredCount} / ${activeQuestions.length}`;
  correctCounter.textContent = `${correctCount}`;
}

function releaseInteractionState(target) {
  const source = target instanceof Element ? target : null;
  const button = source ? source.closest("button") : null;
  if (!button) return;
  requestAnimationFrame(() => {
    if (document.activeElement === button) button.blur();
  });
}

function clampIndex(index) {
  if (!activeQuestions.length) return 0;
  if (index < 0) return 0;
  if (index >= activeQuestions.length) return activeQuestions.length - 1;
  return index;
}

function findNextUnanswered(fromIndex) {
  for (let i = fromIndex + 1; i < activeQuestions.length; i += 1) {
    if (answers[i] === null) return i;
  }
  for (let i = 0; i <= fromIndex; i += 1) {
    if (answers[i] === null) return i;
  }
  return -1;
}

// ===================== STEP MODE =====================
function ensureQuestionCard() {
  let card = questionList.querySelector(".question-card");
  if (card) return card;

  card = document.createElement("article");
  card.className = "question-card";

  const number = document.createElement("span");
  number.className = "question-number";

  const title = document.createElement("h3");
  title.className = "question-title";

  const options = document.createElement("div");
  options.className = "option-list";

  const nav = document.createElement("div");
  nav.className = "question-nav";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "ghost-btn nav-btn";
  prevBtn.dataset.nav = "prev";
  prevBtn.textContent = "Назад";

  const status = document.createElement("p");
  status.className = "question-position";

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "ghost-btn nav-btn";
  nextBtn.dataset.nav = "next";
  nextBtn.textContent = "Далее";

  nav.append(prevBtn, status, nextBtn);
  card.append(number, title, options, nav);
  questionList.replaceChildren(card);

  return card;
}

function syncOptionButtons(optionsHost, question, questionIndex, selectedOption) {
  const isAnswered = selectedOption !== null;

  while (optionsHost.children.length > question.options.length) {
    optionsHost.lastElementChild.remove();
  }

  question.options.forEach((option, optionIndex) => {
    let btn = optionsHost.children[optionIndex];
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      optionsHost.appendChild(btn);
    }
    btn.className = "option-btn";
    btn.textContent = option;
    btn.dataset.questionIndex = String(questionIndex);
    btn.dataset.optionIndex = String(optionIndex);

    if (!isAnswered) return;

    btn.classList.add("locked");
    if (optionIndex === question.answer) { btn.classList.add("correct"); return; }
    if (optionIndex === selectedOption) btn.classList.add("wrong");
  });
}

function patchQuestionCard(card, index) {
  const question = activeQuestions[index];
  if (!question) { questionList.innerHTML = ""; return; }

  card.querySelector(".question-number").textContent = `${index + 1}`;
  card.querySelector(".question-title").textContent = question.text;
  card.querySelector(".question-position").textContent = `Вопрос ${index + 1} из ${activeQuestions.length}`;
  card.querySelector('[data-nav="prev"]').disabled = index === 0;
  card.querySelector('[data-nav="next"]').disabled = index === activeQuestions.length - 1;

  syncOptionButtons(card.querySelector(".option-list"), question, index, answers[index]);
}

function animateQuestionSwap(card, direction, onSwap) {
  if (isQuestionTransitioning) return;

  const version = transitionVersion;
  isQuestionTransitioning = true;
  card.classList.add("is-transitioning");

  const outClass = direction >= 0 ? "anim-out-next" : "anim-out-prev";
  const inClass = direction >= 0 ? "anim-in-next" : "anim-in-prev";
  let outDone = false;
  let inDone = false;

  const finish = () => {
    if (version !== transitionVersion) return;
    if (!outDone || !inDone) return;
    card.classList.remove("is-transitioning");
    isQuestionTransitioning = false;
  };

  const startIn = () => {
    if (version !== transitionVersion) return;
    onSwap();
    card.classList.remove(outClass);
    card.classList.add(inClass);
    requestAnimationFrame(() => card.classList.remove(inClass));

    const onInEnd = (event) => {
      if (version !== transitionVersion) return;
      if (event.target !== card || event.propertyName !== "opacity") return;
      card.removeEventListener("transitionend", onInEnd);
      inDone = true; finish();
    };
    card.addEventListener("transitionend", onInEnd);
    setTimeout(() => {
      if (version !== transitionVersion) return;
      if (!inDone) { inDone = true; finish(); }
    }, QUESTION_TRANSITION_MS + 60);
  };

  const onOutEnd = (event) => {
    if (version !== transitionVersion) return;
    if (event.target !== card || event.propertyName !== "opacity") return;
    card.removeEventListener("transitionend", onOutEnd);
    outDone = true; startIn();
  };
  card.addEventListener("transitionend", onOutEnd);

  requestAnimationFrame(() => {
    if (version !== transitionVersion) return;
    card.classList.add(outClass);
  });

  setTimeout(() => {
    if (version !== transitionVersion) return;
    if (!outDone) {
      card.removeEventListener("transitionend", onOutEnd);
      outDone = true; startIn();
    }
  }, QUESTION_TRANSITION_MS + 60);
}

function renderCurrentQuestion(direction = 0, animate = false) {
  const index = clampIndex(currentQuestionIndex);
  currentQuestionIndex = index;
  const card = ensureQuestionCard();

  if (animate && direction !== 0) {
    animateQuestionSwap(card, direction, () => patchQuestionCard(card, index));
    return;
  }
  patchQuestionCard(card, index);
}

function queueAutoAdvance() {
  if (viewMode !== "step") return;
  if (autoAdvanceId || answeredCount === activeQuestions.length) return;

  autoAdvanceId = setTimeout(() => {
    autoAdvanceId = null;
    const nextUnanswered = findNextUnanswered(currentQuestionIndex);
    if (nextUnanswered === -1) return;
    goToQuestion(nextUnanswered);
  }, AUTO_ADVANCE_MS);
}

function goToQuestion(nextIndex) {
  if (isQuestionTransitioning) return;
  const normalized = clampIndex(nextIndex);
  if (normalized === currentQuestionIndex) return;
  const direction = normalized > currentQuestionIndex ? 1 : -1;
  currentQuestionIndex = normalized;
  renderCurrentQuestion(direction, true);
}

// ===================== LIST MODE (виртуализация) =====================
function buildListSkeleton() {
  // Уничтожаем предыдущие наблюдатели
  if (listObserver) { listObserver.disconnect(); listObserver = null; }
  if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
  mountedCards = new Map();
  listSlots = [];

  questionList.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (let i = 0; i < activeQuestions.length; i += 1) {
    const slot = document.createElement("div");
    slot.className = "question-slot";
    slot.dataset.index = String(i);
    slot.style.minHeight = ESTIMATED_ROW_HEIGHT + "px";
    listSlots.push(slot);
    frag.appendChild(slot);
  }
  questionList.appendChild(frag);

  // ResizeObserver для удержания высоты слота равной фактической высоте карточки
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const card = entry.target;
        const idx = Number(card.dataset.index);
        const slot = listSlots[idx];
        if (!slot) continue;
        const h = Math.ceil(entry.contentRect.height);
        if (h > 0) slot.style.minHeight = h + "px";
      }
    });
  }

  // IntersectionObserver — рендерим карточку, когда слот близко к viewport
  const rootMargin = `${ESTIMATED_ROW_HEIGHT * RENDER_BUFFER}px 0px`;
  listObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const idx = Number(entry.target.dataset.index);
      if (entry.isIntersecting) {
        mountListCard(idx);
      } else {
        // Размонтируем только если уже отвечено и далеко от экрана — экономим RAM
        // Для простоты и стабильности высот: оставляем смонтированными.
      }
    }
  }, { root: null, rootMargin, threshold: 0 });

  listSlots.forEach((slot) => listObserver.observe(slot));
}

function mountListCard(index) {
  if (mountedCards.has(index)) return;
  const slot = listSlots[index];
  if (!slot) return;

  const card = document.createElement("article");
  card.className = "question-card";
  card.dataset.index = String(index);

  const number = document.createElement("span");
  number.className = "question-number";

  const title = document.createElement("h3");
  title.className = "question-title";

  const options = document.createElement("div");
  options.className = "option-list";

  const status = document.createElement("p");
  status.className = "question-position list-position";

  card.append(number, title, options, status);
  patchListCard(card, index);

  slot.style.minHeight = ""; // освобождаем — пусть карточка задаёт высоту
  slot.appendChild(card);
  mountedCards.set(index, card);

  if (resizeObserver) resizeObserver.observe(card);
}

function patchListCard(card, index) {
  const question = activeQuestions[index];
  if (!question) return;
  card.querySelector(".question-number").textContent = `${index + 1}`;
  card.querySelector(".question-title").textContent = question.text;
  card.querySelector(".list-position").textContent = `Вопрос ${index + 1} из ${activeQuestions.length}`;
  syncOptionButtons(card.querySelector(".option-list"), question, index, answers[index]);
}

function refreshMountedListCard(index) {
  const card = mountedCards.get(index);
  if (!card) return;
  patchListCard(card, index);
}

// ===================== ОБЩАЯ ОБРАБОТКА =====================
function handleQuestionListClick(event) {
  const optionBtn = event.target.closest(".option-btn");
  if (optionBtn && questionList.contains(optionBtn)) {
    if (viewMode === "step" && isQuestionTransitioning) return;
    const questionIndex = Number(optionBtn.dataset.questionIndex);
    const optionIndex = Number(optionBtn.dataset.optionIndex);
    selectAnswer(questionIndex, optionIndex);
    releaseInteractionState(optionBtn);
    return;
  }

  if (viewMode !== "step") return;

  const navBtn = event.target.closest("[data-nav]");
  if (!navBtn || !questionList.contains(navBtn) || navBtn.disabled) return;
  if (isQuestionTransitioning) return;

  if (autoAdvanceId) { clearTimeout(autoAdvanceId); autoAdvanceId = null; }

  if (navBtn.dataset.nav === "prev") goToQuestion(currentQuestionIndex - 1);
  else if (navBtn.dataset.nav === "next") goToQuestion(currentQuestionIndex + 1);
  releaseInteractionState(navBtn);
}

function selectAnswer(questionIndex, optionIndex) {
  if (viewMode === "step" && questionIndex !== currentQuestionIndex) {
    currentQuestionIndex = clampIndex(questionIndex);
    renderCurrentQuestion(0, false);
  }

  if (answers[questionIndex] !== null) return;

  answers[questionIndex] = optionIndex;
  answeredCount += 1;

  const isCorrect = optionIndex === activeQuestions[questionIndex].answer;
  if (isCorrect) correctCount += 1;
  updateHeaderState();

  if (viewMode === "step") {
    renderCurrentQuestion(0, false);
  } else {
    refreshMountedListCard(questionIndex);
  }

  if (answeredCount === activeQuestions.length) {
    if (finalizeDelayId) clearTimeout(finalizeDelayId);
    finalizeDelayId = setTimeout(() => {
      finalizeDelayId = null;
      finalizeTest();
    }, FINALIZE_DELAY_MS);
    return;
  }

  queueAutoAdvance();
}

function finalizeTest() {
  clearDeferredActions();
  stopTimer();
  const total = activeQuestions.length;
  const wrong = total - correctCount;

  reportCorrect.textContent = `${correctCount}`;
  reportWrong.textContent = `${wrong}`;
  reportTime.textContent = `Время: ${formatTime(elapsedSec)}`;

  showScreen(resultScreen);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const r = Math.floor(Math.random() * (i + 1));
    [items[i], items[r]] = [items[r], items[i]];
  }
  return items;
}

function prepareQuestionForSession(question) {
  if (!question || !Array.isArray(question.options) || question.options.length === 0) return null;
  const optionPairs = question.options.map((option, originalIndex) => ({ option, originalIndex }));
  shuffleInPlace(optionPairs);
  const remappedAnswerIndex = optionPairs.findIndex((e) => e.originalIndex === question.answer);
  if (remappedAnswerIndex === -1) return null;
  return {
    text: question.text,
    options: optionPairs.map((e) => e.option),
    answer: remappedAnswerIndex,
  };
}

function createRandomizedQuestionSet(sourceQuestions) {
  const sessionQuestions = [];
  sourceQuestions.forEach((q) => {
    const prepared = prepareQuestionForSession(q);
    if (prepared) sessionQuestions.push(prepared);
  });
  return shuffleInPlace(sessionQuestions);
}

function getQuestionsForTest(test) {
  const bank = window.TEST_BANK || {};
  const payload = bank[test.dataKey];
  if (!payload || !Array.isArray(payload.questions)) return [];
  return payload.questions;
}

function applyViewMode() {
  modeStepBtn.classList.toggle("is-active", viewMode === "step");
  modeListBtn.classList.toggle("is-active", viewMode === "list");
  modeStepBtn.setAttribute("aria-selected", viewMode === "step" ? "true" : "false");
  modeListBtn.setAttribute("aria-selected", viewMode === "list" ? "true" : "false");
  questionList.classList.toggle("is-list-mode", viewMode === "list");
  if (finishNowBtn) finishNowBtn.hidden = viewMode !== "list";
}

function renderActiveMode(preserveScroll = false) {
  clearDeferredActions();
  // Полностью обнулим обзёрверы режима списка
  if (listObserver) { listObserver.disconnect(); listObserver = null; }
  if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
  mountedCards = new Map();
  listSlots = [];

  if (viewMode === "step") {
    questionList.innerHTML = "";
    renderCurrentQuestion(0, false);
  } else {
    buildListSkeleton();
  }
  applyViewMode();
  if (!preserveScroll) {
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }
}

function startTest(testId, mode) {
  clearDeferredActions();
  activeTest = tests.find((t) => t.id === testId);
  if (!activeTest) return;

  activeQuestions = createRandomizedQuestionSet(getQuestionsForTest(activeTest));
  if (activeQuestions.length === 0) {
    alert("Для этого теста нет вопросов. Проверь файл data/tests.");
    return;
  }

  answers = new Array(activeQuestions.length).fill(null);
  answeredCount = 0;
  correctCount = 0;
  currentQuestionIndex = 0;
  elapsedSec = 0;
  testTitle.textContent = activeTest.title;
  if (mode === "list" || mode === "step") viewMode = mode;

  showScreen(testScreen);
  renderActiveMode();
  updateHeaderState();
  startTimer();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function restartCurrentTest() {
  if (!activeTest) return;
  startTest(activeTest.id, viewMode);
}

function renderHome() {
  testGrid.innerHTML = "";

  tests.forEach((test) => {
    const card = document.createElement("article");
    card.className = "test-card";

    const cover = document.createElement("div");
    cover.className = "test-cover";
    cover.style.backgroundImage = `url("${test.cover}")`;

    const body = document.createElement("div");
    body.className = "test-body";

    const heading = document.createElement("h3");
    heading.textContent = test.title;

    const description = document.createElement("p");
    description.textContent = test.description;

    const meta = document.createElement("div");
    meta.className = "test-meta";

    const launch = document.createElement("button");
    launch.type = "button";
    launch.className = "primary-btn home-launch";
    launch.textContent = "Открыть тест";
    launch.addEventListener("click", () => startTest(test.id, "step"));

    const launchList = document.createElement("button");
    launchList.type = "button";
    launchList.className = "ghost-btn home-launch home-launch-list";
    launchList.textContent = "Открыть списком";
    launchList.addEventListener("click", () => startTest(test.id, "list"));

    const countChip = document.createElement("span");
    countChip.className = "chip question-chip";
    countChip.textContent = `Вопросов: ${getQuestionsForTest(test).length}`;

    meta.append(launch, launchList, countChip);
    body.append(heading, description, meta);
    card.append(cover, body);
    testGrid.appendChild(card);
  });
}

questionList.addEventListener("click", handleQuestionListClick);

backHomeBtn.addEventListener("click", () => {
  clearDeferredActions();
  stopTimer();
  showScreen(homeScreen);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

toHomeBtn.addEventListener("click", () => {
  clearDeferredActions();
  stopTimer();
  showScreen(homeScreen);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

restartBtn.addEventListener("click", restartCurrentTest);
restartFromTestBtn.addEventListener("click", restartCurrentTest);

if (finishNowBtn) {
  finishNowBtn.addEventListener("click", () => {
    if (!activeQuestions.length) return;
    finalizeTest();
  });
}

modeStepBtn.addEventListener("click", () => {
  if (viewMode === "step" || !activeQuestions.length) { applyViewMode(); return; }
  viewMode = "step";
  // в step показываем первый неотвеченный или текущий
  const next = findNextUnanswered(-1);
  if (next !== -1) currentQuestionIndex = next;
  renderActiveMode();
});

modeListBtn.addEventListener("click", () => {
  if (viewMode === "list" || !activeQuestions.length) { applyViewMode(); return; }
  viewMode = "list";
  renderActiveMode();
});

renderHome();
applyViewMode();

/* ============= АВТО-СКРЫТИЕ STICKY-ПАНЕЛИ НА МОБИЛЬНОМ ============= */
(function setupStickyAutoHide() {
  const panel = document.querySelector(".sticky-panel");
  if (!panel) return;

  const mq = window.matchMedia("(max-width: 560px)");
  let lastY = window.scrollY || 0;
  let ticking = false;
  let accDown = 0;
  let accUp = 0;
  const HIDE_AFTER = 36; // px вниз — спрятать
  const SHOW_AFTER = 18; // px вверх — показать

  function onScroll() {
    if (!mq.matches) {
      if (panel.classList.contains("is-hidden")) panel.classList.remove("is-hidden");
      return;
    }
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY || 0;
      const dy = y - lastY;
      lastY = y;

      // Возле верха — всегда показываем
      if (y < 80) {
        panel.classList.remove("is-hidden");
        accDown = 0; accUp = 0;
        ticking = false;
        return;
      }

      if (dy > 0) {
        accDown += dy; accUp = 0;
        if (accDown > HIDE_AFTER) panel.classList.add("is-hidden");
      } else if (dy < 0) {
        accUp += -dy; accDown = 0;
        if (accUp > SHOW_AFTER) panel.classList.remove("is-hidden");
      }
      ticking = false;
    });
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  mq.addEventListener("change", () => {
    if (!mq.matches) panel.classList.remove("is-hidden");
  });
})();
