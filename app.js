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
const answerStrip = document.getElementById("answerStrip");
const testTitle = document.getElementById("testTitle");
const reportCorrect = document.getElementById("reportCorrect");
const reportWrong = document.getElementById("reportWrong");
const reportTime = document.getElementById("reportTime");

const backHomeBtn = document.getElementById("backHomeBtn");
const toHomeBtn = document.getElementById("toHomeBtn");
const restartBtn = document.getElementById("restartBtn");
const restartFromTestBtn = document.getElementById("restartFromTestBtn");

let activeTest = null;
let activeQuestions = [];
let answers = [];
let answerHistory = [];
let elapsedSec = 0;
let timerId = null;

function formatTime(totalSec) {
  const safe = Math.max(0, totalSec);
  const minutes = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (safe % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function showScreen(screen) {
  homeScreen.classList.remove("active");
  testScreen.classList.remove("active");
  resultScreen.classList.remove("active");
  screen.classList.add("active");
}

function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

function startTimer() {
  stopTimer();
  timerLabel.textContent = formatTime(elapsedSec);

  timerId = setInterval(() => {
    elapsedSec += 1;
    timerLabel.textContent = formatTime(elapsedSec);
  }, 1000);
}

function countCorrect() {
  return answers.reduce((acc, value, index) => {
    if (value === null) {
      return acc;
    }
    return acc + (value === activeQuestions[index].answer ? 1 : 0);
  }, 0);
}

function countAnswered() {
  return answers.filter((value) => value !== null).length;
}

function updateStrip() {
  const cells = answerStrip.querySelectorAll(".strip-cell");
  cells.forEach((cell, i) => {
    cell.classList.remove("correct", "wrong");
    if (i >= answerHistory.length) {
      return;
    }
    if (answerHistory[i]) {
      cell.classList.add("correct");
      return;
    }
    cell.classList.add("wrong");
  });
}

function updateHeaderState() {
  const answered = countAnswered();
  const total = activeQuestions.length;
  const correct = countCorrect();

  questionCounter.textContent = `${answered} / ${total}`;
  correctCounter.textContent = `${correct}`;
  updateStrip();
}

function renderQuestions() {
  questionList.innerHTML = "";
  answerStrip.innerHTML = "";

  activeQuestions.forEach((question, index) => {
    const card = document.createElement("article");
    card.className = "question-card";
    card.id = `question-${index + 1}`;

    const number = document.createElement("span");
    number.className = "question-number";
    number.textContent = `${index + 1}`;

    const title = document.createElement("h3");
    title.className = "question-title";
    title.textContent = question.text;

    const options = document.createElement("div");
    options.className = "option-list";

    question.options.forEach((option, optionIndex) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option-btn";
      btn.textContent = option;
      btn.dataset.questionIndex = String(index);
      btn.dataset.optionIndex = String(optionIndex);
      btn.addEventListener("click", () => selectAnswer(index, optionIndex));
      options.appendChild(btn);
    });

    card.append(number, title, options);
    questionList.appendChild(card);

    const stripCell = document.createElement("span");
    stripCell.className = "strip-cell";
    answerStrip.appendChild(stripCell);
  });
}

function lockQuestion(index) {
  const questionCard = document.getElementById(`question-${index + 1}`);
  if (!questionCard) {
    return;
  }
  questionCard.querySelectorAll(".option-btn").forEach((btn) => {
    btn.classList.add("locked");
  });
}

function colorQuestion(index, selectedOption) {
  const question = activeQuestions[index];
  const questionCard = document.getElementById(`question-${index + 1}`);

  if (!questionCard) {
    return;
  }

  questionCard.querySelectorAll(".option-btn").forEach((btn) => {
    const optionIndex = Number(btn.dataset.optionIndex);
    btn.classList.remove("correct", "wrong");

    if (optionIndex === question.answer) {
      btn.classList.add("correct");
      return;
    }

    if (optionIndex === selectedOption && selectedOption !== question.answer) {
      btn.classList.add("wrong");
    }
  });
}

function selectAnswer(questionIndex, optionIndex) {
  if (answers[questionIndex] !== null) {
    return;
  }

  answers[questionIndex] = optionIndex;
  const isCorrect = optionIndex === activeQuestions[questionIndex].answer;
  answerHistory.push(isCorrect);

  colorQuestion(questionIndex, optionIndex);
  lockQuestion(questionIndex);
  updateHeaderState();

  if (countAnswered() === activeQuestions.length) {
    finalizeTest();
  }
}

function finalizeTest() {
  stopTimer();
  const correct = countCorrect();
  const total = activeQuestions.length;
  const wrong = total - correct;

  reportCorrect.textContent = `${correct}`;
  reportWrong.textContent = `${wrong}`;
  reportTime.textContent = `Время: ${formatTime(elapsedSec)}`;

  showScreen(resultScreen);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getQuestionsForTest(test) {
  const bank = window.TEST_BANK || {};
  const payload = bank[test.dataKey];
  if (!payload || !Array.isArray(payload.questions)) {
    return [];
  }
  return payload.questions;
}

function startTest(testId) {
  activeTest = tests.find((test) => test.id === testId);
  if (!activeTest) {
    return;
  }

  activeQuestions = getQuestionsForTest(activeTest);
  if (activeQuestions.length === 0) {
    alert("Для этого теста нет вопросов. Проверь файл data/tests.");
    return;
  }

  answers = new Array(activeQuestions.length).fill(null);
  answerHistory = [];
  elapsedSec = 0;
  testTitle.textContent = activeTest.title;

  showScreen(testScreen);
  renderQuestions();
  updateHeaderState();
  startTimer();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function restartCurrentTest() {
  if (!activeTest) {
    return;
  }
  startTest(activeTest.id);
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
    launch.addEventListener("click", () => startTest(test.id));

    const countChip = document.createElement("span");
    countChip.className = "chip question-chip";
    countChip.textContent = `Вопросов: ${getQuestionsForTest(test).length}`;

    meta.append(launch, countChip);
    body.append(heading, description, meta);
    card.append(cover, body);
    testGrid.appendChild(card);
  });
}

backHomeBtn.addEventListener("click", () => {
  stopTimer();
  showScreen(homeScreen);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

toHomeBtn.addEventListener("click", () => {
  showScreen(homeScreen);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

restartBtn.addEventListener("click", restartCurrentTest);
restartFromTestBtn.addEventListener("click", restartCurrentTest);

renderHome();
