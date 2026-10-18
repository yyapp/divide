const TYPES = [
  {
    key: 'noBorrow',
    label: '받아내림 없는 유형',
    pool: [
      { dividend: 864, divisor: 2 },
      { dividend: 639, divisor: 3 },
      { dividend: 824, divisor: 2 },
      { dividend: 428, divisor: 2 },
      { dividend: 636, divisor: 3 },
    ],
  },
  {
    key: 'borrow',
    label: '받아내림 있는 유형',
    pool: [
      { dividend: 735, divisor: 5 },
      { dividend: 532, divisor: 4 },
      { dividend: 748, divisor: 4 },
      { dividend: 845, divisor: 5 },
      { dividend: 936, divisor: 6 },
    ],
  },
  {
    key: 'zeroTens',
    label: '십의 자리 몫이 0인 유형',
    pool: [
      { dividend: 408, divisor: 4 },
      { dividend: 816, divisor: 8 },
      { dividend: 609, divisor: 3 },
      { dividend: 505, divisor: 5 },
      { dividend: 702, divisor: 7 },
    ],
  },
];

const STORAGE_KEY = 'step-by-step-division-records-v1';
const PLACE_NAMES = ['백의', '십의', '일의'];
const SAMPLE_RECORDS = [
  { label: '예시 01', completed: ['받아내림 없는 유형'], tools: ['가리기'], toolCounts: { '가리기': 1, '곱셈구구': 0, '수모형': 0 }, attempts: 4, hints: 1, helpedSolved: 1, stillStuck: 0, lastHelpResult: 'solved', status: '도움 후 해결' },
  { label: '예시 02', completed: ['받아내림 없는 유형', '받아내림 있는 유형'], tools: ['곱셈구구', '수모형'], toolCounts: { '가리기': 0, '곱셈구구': 2, '수모형': 1 }, attempts: 9, hints: 3, helpedSolved: 1, stillStuck: 1, lastHelpResult: 'solved', status: '진행 중' },
  { label: '예시 03', completed: [], tools: ['수모형'], toolCounts: { '가리기': 0, '곱셈구구': 0, '수모형': 2 }, attempts: 3, hints: 2, helpedSolved: 0, stillStuck: 1, lastHelpResult: 'stuck', status: '도움 필요' },
];

const state = {
  problems: TYPES.map((type) => ({ ...type, ...type.pool[Math.floor(Math.random() * type.pool.length)] })),
  problemIndex: 0,
  stage: 0,
  directMode: true,
  workMode: 'handwriting',
  solvedDigits: [null, null, null],
  directDigits: ['', '', ''],
  stepEntry: '',
  calculationEntries: Array.from({ length: 3 }, () => ({ product: ['', '', ''], remainder: '' })),
  activeHelp: null,
  coverPreviewStage: null,
  coverTransition: false,
  modelAssignments: [],
  modelSignature: '',
  record: null,
  pendingHelpResult: false,
  toastTimer: null,
  resizeCanvas: null,
  autoStepTimer: null,
  advanceTimer: null,
  transitioning: false,
  ocrWorker: null,
  ocrWorkerPromise: null,
  ocrScriptPromise: null,
  ocrTimers: new Map(),
  strokeTarget: null,
  applyingOcr: false,
  ocrRevision: 0,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const studentView = $('#studentView');
const teacherView = $('#teacherView');
const answerForm = $('#answerForm');
const answerFeedback = $('#answerFeedback');
const helpContent = $('#helpContent');
const scratchCanvas = $('#scratchCanvas');

function getHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function nextPracticeLabel() {
  const numbers = getHistory().map((entry) => Number(entry.label.match(/\d+/)?.[0] || 0));
  return `연습 ${String(Math.max(0, ...numbers) + 1).padStart(2, '0')}`;
}

function markActivity() {
  if (!state.record) {
    state.record = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      label: nextPracticeLabel(),
      startedAt: new Date().toISOString(),
      completed: [],
      directTypes: [],
      tools: [],
      toolCounts: { '가리기': 0, '곱셈구구': 0, '수모형': 0 },
      attempts: 0,
      hints: 0,
      helpedSolved: 0,
      stillStuck: 0,
      status: '진행 중',
      lastHelpResult: null,
      activeType: state.problems[state.problemIndex]?.label || TYPES[0].label,
    };
  }
  if (state.record.status !== '오늘 연습 완료') state.record.status = '진행 중';
  state.record.activeType = state.problems[state.problemIndex]?.label || state.record.activeType;
  saveRecord();
}

function saveRecord() {
  if (!state.record) return;
  const history = getHistory();
  const existing = history.findIndex((entry) => entry.id === state.record.id);
  if (existing >= 0) history[existing] = state.record;
  else history.push(state.record);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-80)));
  renderDashboard();
}

function getProblem() {
  return state.problems[state.problemIndex];
}

function quotientDigits(problem) {
  return String(problem.dividend / problem.divisor).padStart(3, '0').split('').map(Number);
}

function currentDivisionValue(problem, targetStage = state.stage) {
  const digits = String(problem.dividend).padStart(3, '0').split('').map(Number);
  let remainder = 0;
  for (let index = 0; index < targetStage; index += 1) {
    const current = remainder * 10 + digits[index];
    remainder = current % problem.divisor;
  }
  return { value: remainder * 10 + digits[targetStage], remainder, digit: digits[targetStage] };
}

function renderProblem() {
  const problem = getProblem();
  if (!problem) return;
  $('#longDivisor').textContent = problem.divisor;
  $('#stageNumber').textContent = `0${state.stage + 1}`;
  $('#stageTitle').textContent = `${PLACE_NAMES[state.stage]} 자리부터 살펴봐요`;
  const prompts = [
    '백의 자리 수를 나누면 몫이 몇일까요?',
    '남은 수와 십의 자리 수를 이어서 살펴봐요.',
    '남은 수와 일의 자리 수를 이어서 마무리해요.',
  ];
  $('#stageDescription').textContent = prompts[state.stage];
  $('#maskLabel').textContent = state.stage < 2 ? '다음 자리는 가림판 뒤에 있어요' : '모든 자리를 살펴보고 있어요';
  $('#longDivisionLabel').textContent = state.directMode ? '세 자리 문제를 보고 몫을 입력하세요' : '한 자리씩 나누어 몫을 입력하세요';
  $('.problem-card', studentView).classList.toggle('direct-mode', state.directMode);
  $('#toggleDirectMode').setAttribute('aria-expanded', String(!state.directMode));
  $('#toggleDirectMode').innerHTML = state.directMode
    ? '막히면 한 자리씩 단계별로 풀어보기 <span aria-hidden="true">→</span>'
    : '문제 전체를 보고 몫을 한 번에 입력하기 <span aria-hidden="true">→</span>';
  $('#checkAnswerButton').innerHTML = state.directMode ? '정답 확인 <span aria-hidden="true">↗</span>' : '확인하기 <span aria-hidden="true">↗</span>';
  renderPlaceWindow();
  renderVerticalDivision();
  renderAnswerPreview();
  renderCalculationSteps();
  answerFeedback.textContent = '';
  answerFeedback.classList.remove('error');
  if (state.activeHelp) renderHelp();
}

function renderVerticalDivision() {
  const problem = getProblem();
  if (!problem) return;
  const digits = String(problem.dividend).padStart(3, '0').split('');
  const visibleThrough = state.directMode ? 2 : state.stage;
  $('#verticalDividend').innerHTML = digits.map((digit, index) => `<span class="division-digit${index === state.stage && !state.directMode ? ' current-place' : ''}${index > visibleThrough ? ' masked' : ''}">${digit}</span>`).join('');
}

function renderPlaceWindow() {
  const problem = getProblem();
  if (!problem) return;
  const shownStage = state.coverPreviewStage ?? state.stage;
  const digits = String(problem.dividend).padStart(3, '0').split('');
  $('#placeDigits').classList.toggle('cover-transition', state.coverTransition);
  $('#placeDigits').innerHTML = digits.map((digit, index) => {
    const masked = index > shownStage;
    const active = index === shownStage;
    return `<span class="place-column"><span class="place-cell${active ? ' active-place' : ''}${masked ? ' masked' : ''}" aria-label="${PLACE_NAMES[index]} 자리 ${masked ? '가림' : digit}">${digit}</span><span class="place-name">${PLACE_NAMES[index]} 자리</span></span>`;
  }).join('');
}

function renderAnswerPreview() {
  const problem = getProblem();
  if (!problem) return;
  const shown = [0, 1, 2].map((index) => {
    const value = state.directMode ? state.directDigits[index] : (index === state.stage ? state.stepEntry : state.solvedDigits[index]);
    return value === null || value === undefined ? '' : String(value);
  });
  $('#verticalQuotient').innerHTML = shown.map((digit, index) => {
    const editable = state.directMode || index === state.stage;
    const label = `${PLACE_NAMES[index]} 자리 몫`;
    return `<input class="quotient-digit${index === state.stage && !state.directMode ? ' current-place' : ''}${digit === '' ? ' empty' : ''}" id="quotientDigit${index}" type="text" inputmode="numeric" autocomplete="off" maxlength="1" value="${digit}" aria-label="${label}" form="answerForm" data-quotient-index="${index}"${editable ? '' : ' disabled'}>`;
  }).join('');
  $('#verticalQuotient').setAttribute('aria-label', '몫 입력 칸');
}

function setInputMode(direct) {
  state.directMode = direct;
  if (direct && state.directDigits.every((digit) => digit === '')) {
    state.directDigits = state.solvedDigits.map((digit) => digit === null ? '' : String(digit));
  }
  $('.problem-card', studentView).classList.toggle('direct-mode', direct);
  $('#longDivisionLabel').textContent = direct ? '세 자리 문제를 보고 몫을 입력하세요' : '한 자리씩 나누어 몫을 입력하세요';
  const toggle = $('#toggleDirectMode');
  toggle.setAttribute('aria-expanded', String(!direct));
  toggle.innerHTML = direct
    ? '막히면 한 자리씩 단계별로 풀어보기 <span aria-hidden="true">→</span>'
    : '문제 전체를 보고 몫을 한 번에 입력하기 <span aria-hidden="true">→</span>';
  $('#checkAnswerButton').innerHTML = direct ? '정답 확인 <span aria-hidden="true">↗</span>' : '확인하기 <span aria-hidden="true">↗</span>';
  renderVerticalDivision();
  renderAnswerPreview();
  renderCalculationSteps();
  $(`#quotientDigit${direct ? 0 : state.stage}`).focus();
}

function setWorkMode(mode) {
  state.workMode = mode;
  const handwriting = mode === 'handwriting';
  if (!handwriting) {
    state.ocrRevision += 1;
    state.ocrTimers.forEach((timer) => clearTimeout(timer));
    state.ocrTimers.clear();
  }
  scratchCanvas.hidden = !handwriting;
  if (handwriting) state.resizeCanvas?.();
  $('#divisionBoard').classList.toggle('numeric-work-mode', !handwriting);
  $('#handwritingTab').classList.toggle('active', handwriting);
  $('#numericTab').classList.toggle('active', !handwriting);
  $('#handwritingTab').setAttribute('aria-selected', String(handwriting));
  $('#numericTab').setAttribute('aria-selected', String(!handwriting));
  $('#workspaceHint').textContent = handwriting
    ? '각 빈 숫자칸에 한 자리씩 쓰면 인식해 채워요. 틀리면 숫자 입력에서 고칠 수 있어요.'
    : '각 자리에서 곱해 빼고 남은 수를 입력해보세요.';
  $('#workModeLabel').textContent = handwriting ? '손글씨 풀이' : '숫자 풀이';
}

function renderCalculationSteps() {
  const problem = getProblem();
  if (!problem) return;
  const digits = String(problem.dividend).padStart(3, '0').split('');
  const visibleStages = state.stage + 1;
  const rows = [];
  for (let step = 0; step < visibleStages; step += 1) {
    const entry = state.calculationEntries[step];
    const productCells = entry.product.map((value, column) => {
      const active = step === 0 ? column === 0 : step === 1 ? column < 2 : column > 0;
      return active
        ? `<input class="calc-digit-input product-digit" type="text" inputmode="numeric" autocomplete="off" maxlength="1" value="${value}" aria-label="곱해 뺄 수 ${PLACE_NAMES[step]} 단계 ${column + 1}" data-calc-step="${step}" data-calc-kind="product" data-calc-column="${column}">`
        : '<span class="calc-digit-spacer"></span>';
    }).join('');
    const remainderCells = [0, 1, 2].map((column) => {
      if (column === step) return `<input class="calc-digit-input remainder-digit" type="text" inputmode="numeric" autocomplete="off" maxlength="1" value="${entry.remainder}" aria-label="빼고 남은 수 ${PLACE_NAMES[step]} 단계" data-calc-step="${step}" data-calc-kind="remainder" data-calc-column="${column}">`;
      if (column === step + 1 && step < 2) return `<span class="bring-down-cell"><span aria-hidden="true">↓</span><strong>${digits[column]}</strong></span>`;
      return '<span class="calc-digit-spacer"></span>';
    }).join('');
    rows.push(`<div class="process-row subtract-row"><span class="process-sign">−</span><div class="calc-digit-grid">${productCells}</div></div><div class="process-row remainder-row"><span class="process-sign"></span><div class="calc-digit-grid">${remainderCells}</div></div>`);
  }
  $('#calculationSteps').innerHTML = rows.join('');
}

function handleCalculationInput(event) {
  const input = event.target.closest('[data-calc-step]');
  if (!input) return;
  const step = Number(input.dataset.calcStep);
  const value = input.value.replace(/[^0-9]/g, '').slice(0, 1);
  input.value = value;
  if (!state.applyingOcr) input.removeAttribute('data-ocr-filled');
  if (input.dataset.calcKind === 'remainder') {
    state.calculationEntries[step].remainder = value;
  } else {
    state.calculationEntries[step].product[Number(input.dataset.calcColumn)] = value;
  }
}

function findHandwritingTarget(x, y) {
  return $$('[data-quotient-index], [data-calc-step]').find((input) => {
    if (input.disabled || !input.getClientRects().length) return false;
    const rect = input.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }) || null;
}

function handwritingTargetKey(target) {
  return target.id || `calc-${target.dataset.calcStep}-${target.dataset.calcKind}-${target.dataset.calcColumn}`;
}

function loadTesseract() {
  if (window.Tesseract?.createWorker) return Promise.resolve(window.Tesseract);
  if (state.ocrScriptPromise) return state.ocrScriptPromise;
  state.ocrScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR library unavailable'));
    script.onerror = () => reject(new Error('OCR library failed to load'));
    document.head.append(script);
  });
  return state.ocrScriptPromise;
}

async function getOcrWorker() {
  if (state.ocrWorker) return state.ocrWorker;
  if (!state.ocrWorkerPromise) {
    state.ocrWorkerPromise = (async () => {
      const tesseract = await loadTesseract();
      $('#workspaceHint').textContent = '손글씨 인식 기능을 준비하고 있어요.';
      const worker = await tesseract.createWorker('eng', 1, {
        logger: (message) => {
          if (message.status === 'loading language traineddata') $('#workspaceHint').textContent = '숫자 인식 자료를 불러오고 있어요.';
        },
      });
      await worker.setParameters({ tessedit_char_whitelist: '0123456789OoIl|SBZAa' });
      state.ocrWorker = worker;
      return worker;
    })().catch((error) => {
      state.ocrWorkerPromise = null;
      throw error;
    });
  }
  return state.ocrWorkerPromise;
}

function clearHandwritingCell(target) {
  const canvasRect = scratchCanvas.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const context = scratchCanvas.getContext('2d');
  const padding = 4;
  context.clearRect(rect.left - canvasRect.left - padding, rect.top - canvasRect.top - padding, rect.width + padding * 2, rect.height + padding * 2);
  target.value = '';
  target.removeAttribute('data-ocr-filled');
  if (target.matches('.quotient-digit')) {
    const index = Number(target.dataset.quotientIndex);
    if (state.directMode) state.directDigits[index] = '';
    else if (state.stage === index) state.stepEntry = '';
  } else {
    const step = Number(target.dataset.calcStep);
    if (target.dataset.calcKind === 'remainder') state.calculationEntries[step].remainder = '';
    else state.calculationEntries[step].product[Number(target.dataset.calcColumn)] = '';
  }
}

function makeOcrCrop(target) {
  const canvasRect = scratchCanvas.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const ratioX = scratchCanvas.width / canvasRect.width;
  const ratioY = scratchCanvas.height / canvasRect.height;
  const padding = 5;
  const left = Math.max(0, Math.floor((targetRect.left - canvasRect.left - padding) * ratioX));
  const top = Math.max(0, Math.floor((targetRect.top - canvasRect.top - padding) * ratioY));
  const right = Math.min(scratchCanvas.width, Math.ceil((targetRect.right - canvasRect.left + padding) * ratioX));
  const bottom = Math.min(scratchCanvas.height, Math.ceil((targetRect.bottom - canvasRect.top + padding) * ratioY));
  const width = right - left;
  const height = bottom - top;
  const crop = document.createElement('canvas');
  crop.width = width * 4;
  crop.height = height * 4;
  const context = crop.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, crop.width, crop.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(scratchCanvas, left, top, width, height, 0, 0, crop.width, crop.height);
  return crop;
}

async function recognizeHandwriting(target, revision = state.ocrRevision) {
  if (!target.isConnected || state.workMode !== 'handwriting') return;
  try {
    $('#workspaceHint').textContent = '손글씨 숫자를 읽고 있어요.';
    const worker = await getOcrWorker();
    if (!target.isConnected || state.workMode !== 'handwriting' || revision !== state.ocrRevision) return;
    const { data } = await worker.recognize(makeOcrCrop(target));
    if (!target.isConnected || state.workMode !== 'handwriting' || revision !== state.ocrRevision) return;
    const character = data.text.replace(/\s/g, '').match(/[0-9OoIl|SBZAa]/)?.[0];
    const digit = character ? ({ O: '0', o: '0', Q: '0', I: '1', l: '1', '|': '1', S: '5', s: '5', Z: '2', z: '2', B: '8', A: '4', a: '4' }[character] || character) : '';
    if (!digit || data.confidence < 12) {
      $('#workspaceHint').textContent = '숫자를 읽지 못했어요. 조금 크게 쓰거나 숫자 입력 모드를 이용해 주세요.';
      return;
    }
    target.value = digit;
    target.dataset.ocrFilled = 'true';
    state.applyingOcr = true;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    state.applyingOcr = false;
    $('#workspaceHint').textContent = `숫자 ${digit}를 인식해 입력했어요. 틀리면 다시 쓰거나 숫자 입력 모드에서 고칠 수 있어요.`;
  } catch {
    state.applyingOcr = false;
    $('#workspaceHint').textContent = '손글씨 인식을 불러오지 못했어요. 숫자 입력 모드를 이용해 주세요.';
  }
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function setHelpResult(result) {
  if (!state.activeHelp || !state.record) return;
  if (result === 'solved') {
    state.pendingHelpResult = true;
    state.record.lastHelpResult = 'pending';
  } else {
    state.pendingHelpResult = false;
    state.record.stillStuck += 1;
    state.record.lastHelpResult = 'stuck';
  }
  saveRecord();
  $('#helpCheck').hidden = true;
  showToast(result === 'solved' ? '다음 계산을 스스로 풀면 해결한 것으로 기록할게요.' : '어려웠던 단계로 기록했어요. 선생님이 확인할 수 있어요.');
}

function selectHelp(tool) {
  const names = { cover: '가리기', tables: '곱셈구구', blocks: '수모형' };
  state.activeHelp = tool;
  state.coverPreviewStage = null;
  state.modelSignature = '';
  markActivity();
  const toolName = names[tool];
  state.record.hints += 1;
  state.record.toolCounts[toolName] += 1;
  if (!state.record.tools.includes(toolName)) state.record.tools.push(toolName);
  saveRecord();
  renderHelp();
}

function renderHelp() {
  const problem = getProblem();
  if (!problem) return;
  $$('.help-tab').forEach((tab) => {
    const active = tab.dataset.help === state.activeHelp;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  $('#helpCheck').hidden = !state.activeHelp;
  if (!state.activeHelp) {
    helpContent.innerHTML = '<div class="empty-help"><span class="empty-help-mark" aria-hidden="true">?</span><h3>막히는 순간에 골라보세요</h3><p>도움을 여는 것도 중요한 학습 과정이에요. 정답을 알려주지 않고, 지금 필요한 실마리를 보여줄게요.</p></div>';
    return;
  }
  const current = currentDivisionValue(problem);
  if (state.activeHelp === 'cover') renderCoverHelp(problem);
  if (state.activeHelp === 'tables') renderTablesHelp(problem, current.value);
  if (state.activeHelp === 'blocks') renderBlocksHelp(problem, current.value);
}

function renderCoverHelp(problem) {
  const shownStage = state.coverPreviewStage ?? state.stage;
  const digits = String(problem.dividend).padStart(3, '0').split('');
  const cells = digits.map((digit, index) => `<span class="cover-mini-cell${index > shownStage ? ' covered' : ''}${index === shownStage ? ' selected' : ''}">${digit}<small>${PLACE_NAMES[index]}</small></span>`).join('');
  const nextStage = Math.min(state.stage + 1, 2);
  helpContent.innerHTML = `<div class="tool-explainer"><span class="tool-step-label">${PLACE_NAMES[state.stage]} 자리 살펴보기</span><h3>한 번에 한 자리씩</h3><p>아직 볼 차례가 아닌 자리를 가려두면, 지금 계산할 숫자에 집중할 수 있어요.</p><div class="cover-sim"><div class="cover-mini-row">${cells}</div><span class="cover-mini-caption">가림판이 계산 순서에 맞춰 움직여요</span></div><div class="micro-tip">가려진 숫자를 외우지 않아도 괜찮아요. 한 자리를 마치면 다음 자리가 보여요.</div><button class="mini-action" id="previewCover" type="button">${state.coverPreviewStage === null ? '다음 자리 살짝 미리 보기' : '현재 단계로 돌아오기'} <span aria-hidden="true">→</span></button></div>`;
  $('#previewCover').addEventListener('click', () => {
    state.coverPreviewStage = state.coverPreviewStage === null ? nextStage : null;
    renderPlaceWindow();
    renderHelp();
  });
}

function renderTablesHelp(problem, value) {
  const quotient = Math.floor(value / problem.divisor);
  const lower = Math.max(1, quotient - 1);
  const upper = Math.min(9, quotient + 1);
  const facts = [...new Set([lower, upper])].filter((factor) => factor !== quotient);
  const factMarkup = facts.length
    ? facts.map((factor) => `<div class="fact-row"><span>${problem.divisor} 묶음 ${factor}개</span><strong>${problem.divisor} × ${factor} = ${problem.divisor * factor}</strong></div>`).join('')
    : `<div class="fact-row"><span>${problem.divisor}의 곱셈구구</span><strong>차례로 비교해 봐요</strong></div>`;
  helpContent.innerHTML = `<div class="tool-explainer"><span class="tool-step-label">지금 살펴볼 수 ${value}</span><h3>${problem.divisor}씩 묶어볼까요?</h3><p>나눌 수에 가까운 곱셈구구를 비교해 보세요. 알맞은 몫을 바로 알려주지는 않아요.</p><div class="fact-list">${factMarkup}</div><div class="micro-tip table-tip">${value < problem.divisor ? '아직 한 묶음이 되지 않아요. 다음 자리 숫자를 내려와 함께 살펴보세요.' : '곱한 수가 지금 수보다 크지 않은지 확인해 보세요.'}</div></div>`;
}

function getRemainderBefore(problem, targetStage) {
  const digits = String(problem.dividend).padStart(3, '0').split('').map(Number);
  let remainder = 0;
  for (let index = 0; index < targetStage; index += 1) {
    remainder = (remainder * 10 + digits[index]) % problem.divisor;
  }
  return remainder;
}

function renderBlocksHelp(problem, value) {
  const signature = `${state.problemIndex}-${state.stage}-${value}`;
  if (state.modelSignature !== signature) {
    state.modelSignature = signature;
    state.modelAssignments = Array.from({ length: value }, () => -1);
  }
  const unitLabel = `${PLACE_NAMES[state.stage]} 모형`;
  const pieces = state.modelAssignments.map((group, index) => `<button class="model-unit${group >= 0 ? ' assigned' : ''}" type="button" data-model-unit="${index}" aria-label="${unitLabel} ${index + 1}번, ${group < 0 ? '나누기 전' : `${group + 1}번째 묶음`}" title="눌러서 묶음에 옮기기">${index + 1}</button>`).join('');
  const groups = Array.from({ length: problem.divisor }, (_, group) => {
    const count = state.modelAssignments.filter((assignment) => assignment === group).length;
    return `<div class="model-group"><span>묶음 ${group + 1}</span><div class="model-group-pieces">${state.modelAssignments.map((assignment, index) => assignment === group ? `<button class="model-unit in-group" type="button" data-model-unit="${index}" aria-label="${group + 1}번째 묶음의 모형 ${index + 1}">${index + 1}</button>` : '').join('') || '<i class="empty-slot"></i>'}</div><strong>${count}</strong></div>`;
  }).join('');
  const previousRemainder = getRemainderBefore(problem, state.stage);
  const previousPlace = PLACE_NAMES[Math.max(0, state.stage - 1)];
  const oldModel = state.stage === 1
    ? `<span class="base-hundred">${previousRemainder}백</span>`
    : `<span class="base-ten regroup-old-ten">${previousRemainder}십</span>`;
  const newModel = state.stage === 1
    ? '<span class="base-ten"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>'
    : '<span class="base-unit"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>';
  const regroup = state.stage > 0 && previousRemainder > 0
    ? `<div class="regroup-card" id="regroupCard"><div class="regroup-copy"><strong>${previousPlace} 모형을 바꿔볼까요?</strong><span>남은 ${previousRemainder}개를 ${previousRemainder * 10}개의 ${unitLabel.replace('의 모형', '')} 모형으로 바꾸어요.</span></div><div class="regroup-visual">${oldModel}<span class="regroup-arrow" aria-hidden="true">→</span>${newModel}</div><button class="mini-action" id="animateRegroup" type="button">모형 바꾸기 <span aria-hidden="true">↗</span></button></div>`
    : '';
  helpContent.innerHTML = `<div class="tool-explainer"><span class="tool-step-label">현재 단계 · ${unitLabel}</span><h3>모형을 직접 나눠봐요</h3><p>아래 모형을 눌러 묶음으로 옮겨 보세요. 한 번 더 누르면 나누기 전으로 돌아와요.</p><div class="model-board"><div class="model-board-head"><span>나누기 전</span><strong>${value}개</strong></div><div class="model-pool">${pieces || '<span class="no-pieces">이 자리에서 나눌 모형이 없어요</span>'}</div><div class="model-groups">${groups}</div></div>${regroup}<div class="micro-tip">현재 ${PLACE_NAMES[state.stage]} 자리에서 필요한 모형만 보여줘요.</div></div>`;
  $$('[data-model-unit]', helpContent).forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.modelUnit);
      const current = state.modelAssignments[index];
      state.modelAssignments[index] = current >= problem.divisor - 1 ? -1 : current + 1;
      renderBlocksHelp(problem, value);
    });
  });
  const regroupButton = $('#animateRegroup', helpContent);
  if (regroupButton) {
    regroupButton.addEventListener('click', () => {
      const card = $('#regroupCard', helpContent);
      card.classList.add('regrouping');
      state.coverTransition = true;
      state.coverPreviewStage = Math.max(0, state.stage - 1);
      renderPlaceWindow();
      setTimeout(() => {
        state.coverPreviewStage = state.stage;
        renderPlaceWindow();
      }, 220);
      setTimeout(() => {
        card.classList.remove('regrouping');
        state.coverPreviewStage = null;
        state.coverTransition = false;
        renderPlaceWindow();
      }, 1000);
    });
  }
}

function submitStep() {
  if (state.transitioning) return;
  const problem = getProblem();
  const entered = state.stepEntry.trim();
  if (!/^[0-9]$/.test(entered)) {
    answerFeedback.textContent = '세로셈의 표시된 몫 칸에 한 자리 숫자를 써 주세요.';
    answerFeedback.classList.add('error');
    $(`#quotientDigit${state.stage}`).focus();
    return;
  }
  markActivity();
  state.record.attempts += 1;
  const expected = quotientDigits(problem)[state.stage];
  if (Number(entered) !== expected) {
    answerFeedback.textContent = '괜찮아요. 지금 보이는 자리와 도움 도구를 다시 살펴봐요.';
    answerFeedback.classList.add('error');
    saveRecord();
    state.stepEntry = '';
    renderAnswerPreview();
    $(`#quotientDigit${state.stage}`).focus();
    return;
  }
  answerFeedback.textContent = '좋아요. 계산 원리를 따라 잘 풀었어요.';
  answerFeedback.classList.remove('error');
  state.solvedDigits[state.stage] = Number(entered);
  state.stepEntry = '';
  if (state.pendingHelpResult) {
    state.record.helpedSolved += 1;
    state.record.lastHelpResult = 'solved';
    state.pendingHelpResult = false;
  }
  saveRecord();
  const current = getProblem();
  if (state.stage < 2) {
    state.stage += 1;
    state.coverPreviewStage = null;
    state.coverTransition = true;
    state.modelSignature = '';
    renderProblem();
    answerFeedback.textContent = '좋아요. 가림판이 다음 자리로 옮겨갔어요.';
    $(`#quotientDigit${state.stage}`).focus();
    setTimeout(() => {
      state.coverTransition = false;
      renderPlaceWindow();
    }, 600);
    return;
  }
  state.record.completed.push(current.label);
  state.record.activeType = current.label;
  state.record.status = state.problemIndex === 2 ? '오늘 연습 완료' : '진행 중';
  saveRecord();
  renderCompletedProblem();
}

function submitDirect() {
  if (state.transitioning) return;
  const problem = getProblem();
  const entered = state.directDigits.join('').trim();
  if (!/^\d{3}$/.test(entered)) {
    answerFeedback.textContent = '세로셈 위쪽 몫 칸을 모두 채워 주세요.';
    answerFeedback.classList.add('error');
    const firstEmpty = state.directDigits.findIndex((digit) => digit === '');
    $(`#quotientDigit${firstEmpty < 0 ? 0 : firstEmpty}`).focus();
    return;
  }
  markActivity();
  state.record.attempts += 1;
  if (entered !== String(problem.dividend / problem.divisor)) {
    answerFeedback.textContent = '아직 맞지 않아요. 다시 계산하거나 한 자리씩 풀어도 괜찮아요.';
    answerFeedback.classList.add('error');
    saveRecord();
    return;
  }
  const current = getProblem();
  state.record.completed.push(current.label);
  state.record.directTypes.push(current.label);
  state.record.activeType = current.label;
  state.record.status = state.problemIndex === 2 ? '오늘 연습 완료' : '진행 중';
  if (state.pendingHelpResult) {
    state.record.helpedSolved += 1;
    state.record.lastHelpResult = 'solved';
    state.pendingHelpResult = false;
  }
  state.solvedDigits = entered.split('').map(Number);
  saveRecord();
  renderCompletedProblem();
}

function submitAnswer(event) {
  event.preventDefault();
  clearTimeout(state.autoStepTimer);
  answerFeedback.textContent = '';
  answerFeedback.classList.remove('error');
  if (state.directMode) submitDirect();
  else submitStep();
}

function handleQuotientInput(event) {
  const input = event.target.closest('.quotient-digit');
  if (!input) return;
  clearTimeout(state.autoStepTimer);
  const index = Number(input.dataset.quotientIndex);
  const value = input.value.replace(/[^0-9]/g, '').slice(0, 1);
  input.value = value;
  if (!state.applyingOcr) input.removeAttribute('data-ocr-filled');
  if (state.transitioning) return;
  if (state.directMode) {
    state.directDigits[index] = value;
    if (value && index < 2) $(`#quotientDigit${index + 1}`).focus();
  } else if (index === state.stage) {
    state.stepEntry = value;
    if (value) {
      const currentStage = state.stage;
      state.autoStepTimer = setTimeout(() => {
        if (!state.directMode && !state.transitioning && state.stage === currentStage && state.stepEntry === value) answerForm.requestSubmit();
      }, 140);
    }
  }
  answerFeedback.textContent = '';
  answerFeedback.classList.remove('error');
}

function renderCompletedProblem() {
  const problemCard = $('.problem-card', studentView);
  const workArea = $('.work-area', studentView);
  const isLast = state.problemIndex === 2;
  if (!isLast) {
    state.transitioning = true;
    answerFeedback.textContent = '잘했어요. 다음 문제로 넘어갈게요.';
    $('#checkAnswerButton').disabled = true;
    state.advanceTimer = setTimeout(() => {
      state.problemIndex += 1;
      state.stage = 0;
      state.solvedDigits = [null, null, null];
      state.directDigits = ['', '', ''];
      state.stepEntry = '';
      state.activeHelp = null;
      state.modelSignature = '';
      state.directMode = true;
      state.transitioning = false;
      clearWorkspaces();
      renderProblem();
      $('#checkAnswerButton').disabled = false;
      const finalInput = $('#quotientDigit0');
      if (finalInput) finalInput.focus();
    }, 650);
    return;
  }
  problemCard.hidden = true;
  let doneCard = $('#problemDone', workArea);
  if (!doneCard) {
    doneCard = document.createElement('section');
    doneCard.id = 'problemDone';
    doneCard.className = 'complete-card card';
    workArea.append(doneCard);
  }
  doneCard.innerHTML = '<span class="complete-seal" aria-hidden="true">✓</span><h2>오늘의 연습을 마쳤어요</h2><p>세 가지 유형을 모두 풀어봤어요. 풀이 과정과 도움 기록을 확인할 수 있어요.</p>';
}

function getRecordView(record) {
  if (record.status === '오늘 연습 완료') return '오늘 연습 완료';
  if (record.lastHelpResult === 'stuck' || (!('lastHelpResult' in record) && record.stillStuck > 0)) return '도움 필요';
  if (record.lastHelpResult === 'solved') return '도움 후 해결';
  if (record.helpedSolved > 0) return '도움 후 해결';
  return '진행 중';
}

function renderDashboard() {
  const history = getHistory();
  const records = history.length ? history.slice().reverse() : SAMPLE_RECORDS;
  const demoMode = history.length === 0;
  const totalAttempts = records.reduce((sum, entry) => sum + entry.attempts, 0);
  const helpCount = records.reduce((sum, entry) => sum + (entry.hints ?? entry.tools.reduce((toolSum, name) => toolSum + (entry.toolCounts?.[name] || 0), 0)), 0);
  const resolved = records.reduce((sum, entry) => sum + entry.helpedSolved, 0);
  const averageAttempts = records.length ? (totalAttempts / records.length).toFixed(1).replace(/\.0$/, '') : '0';
  $('#metricStarted').textContent = records.length;
  $('#metricHints').textContent = helpCount;
  $('#metricSolved').textContent = resolved;
  $('#metricAttempts').textContent = averageAttempts;
  $('#sampleNote').textContent = demoMode
    ? '예시 기록은 화면 미리보기를 위한 샘플입니다. 학생 풀이 기록이 생기면 실제 기록이 표시됩니다.'
    : '익명 연습 번호로 기록하며, 개인정보는 입력하거나 저장하지 않습니다. 기록은 이 기기에 누적됩니다.';
  renderTypeChart(records, demoMode);
  renderToolUsage(records);
  renderRecords(records);
}

function renderTypeChart(records, demoMode) {
  const chart = $('#typeChart');
  chart.innerHTML = TYPES.map((type) => {
    const done = records.filter((record) => record.completed.includes(type.label)).length;
    const working = records.filter((record) => !record.completed.includes(type.label) && record.activeType === type.label && record.status !== '오늘 연습 완료').length;
    const untouched = Math.max(0, records.length - done - working);
    const total = Math.max(records.length, 1);
    return `<div class="chart-row"><span class="chart-row-label">${type.label.replace(' 유형', '')}</span><div class="stacked-track" aria-label="완료 ${done}, 진행 중 ${working}, 시작 전 ${untouched}"><span class="bar-done" style="width:${(done / total) * 100}%"></span><span class="bar-working" style="width:${(working / total) * 100}%"></span><span class="bar-untouched" style="width:${(untouched / total) * 100}%"></span></div><span class="chart-row-total">${done}/${records.length}</span></div>`;
  }).join('');
  if (demoMode) chart.setAttribute('aria-label', '화면 예시 데이터로 만든 유형별 풀이 현황');
  else chart.removeAttribute('aria-label');
}

function renderToolUsage(records) {
  const names = ['가리기', '곱셈구구', '수모형'];
  const counts = Object.fromEntries(names.map((name) => [name, records.reduce((sum, record) => sum + (record.toolCounts?.[name] || record.tools.filter((tool) => tool === name).length), 0)]));
  const maxCount = Math.max(1, ...Object.values(counts));
  $('#toolUsage').innerHTML = names.map((name) => `<div class="tool-usage-row"><span class="tool-usage-name">${name}</span><div class="tool-usage-track"><span style="width:${(counts[name] / maxCount) * 100}%"></span></div><span class="tool-usage-count">${counts[name]}</span></div>`).join('');
}

function renderRecords(records) {
  $('#recordsBody').innerHTML = records.length ? records.slice(0, 8).map((record) => {
    const tools = record.tools.length ? record.tools.join(' · ') : '아직 없음';
    const completed = record.completed.length ? record.completed.map((type) => `${type.replace(' 유형', '')}${record.directTypes?.includes(type) ? ' (바로 입력)' : ''}`).join(' · ') : '아직 없음';
    const status = getRecordView(record);
    const className = status === '도움 필요' ? 'stuck' : status === '진행 중' ? 'active' : '';
    return `<tr><td><span class="student-id">${record.label}</span></td><td>${completed}</td><td><span class="record-tools">${tools}</span></td><td>${record.attempts}회</td><td><span class="state-pill ${className}">${status}</span></td></tr>`;
  }).join('') : '<tr><td class="empty-row" colspan="5">아직 풀이 기록이 없습니다.</td></tr>';
}

function setView(view) {
  const showTeacher = view === 'teacher';
  studentView.hidden = showTeacher;
  teacherView.hidden = !showTeacher;
  $('#studentNav').classList.toggle('active', !showTeacher);
  $('#teacherNav').classList.toggle('active', showTeacher);
  $('#studentNav').setAttribute('aria-current', String(!showTeacher));
  $('#teacherNav').setAttribute('aria-current', String(showTeacher));
  if (showTeacher) renderDashboard();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearWorkspaces() {
  const context = scratchCanvas.getContext('2d');
  context.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
  state.ocrRevision += 1;
  state.calculationEntries = Array.from({ length: 3 }, () => ({ product: ['', '', ''], remainder: '' }));
  state.ocrTimers.forEach(clearTimeout);
  state.ocrTimers.clear();
  state.strokeTarget = null;
  renderCalculationSteps();
}

function clearRecognizedInputs() {
  $$('input[data-ocr-filled="true"]', $('#divisionBoard')).forEach((input) => {
    input.value = '';
    input.removeAttribute('data-ocr-filled');
    if (input.matches('.quotient-digit')) {
      const index = Number(input.dataset.quotientIndex);
      if (state.directMode) state.directDigits[index] = '';
      else if (state.stage === index) state.stepEntry = '';
    } else {
      const step = Number(input.dataset.calcStep);
      if (input.dataset.calcKind === 'remainder') state.calculationEntries[step].remainder = '';
      else state.calculationEntries[step].product[Number(input.dataset.calcColumn)] = '';
    }
  });
  renderAnswerPreview();
  renderCalculationSteps();
}

function initCanvas() {
  const context = scratchCanvas.getContext('2d');
  let drawing = false;
  let previous = null;
  const resize = () => {
    const bounds = scratchCanvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const ratio = window.devicePixelRatio || 1;
    const image = document.createElement('canvas');
    image.width = scratchCanvas.width;
    image.height = scratchCanvas.height;
    if (image.width && image.height) image.getContext('2d').drawImage(scratchCanvas, 0, 0);
    scratchCanvas.width = Math.round(bounds.width * ratio);
    scratchCanvas.height = Math.round(bounds.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineWidth = 2.1;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#3f5d48';
    if (image.width && image.height) context.drawImage(image, 0, 0, bounds.width, bounds.height);
  };
  state.resizeCanvas = resize;
  const point = (event) => {
    const bounds = scratchCanvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  scratchCanvas.addEventListener('pointerdown', (event) => {
    drawing = true;
    previous = point(event);
    state.strokeTarget = findHandwritingTarget(event.clientX, event.clientY);
    if (state.strokeTarget) {
      const key = handwritingTargetKey(state.strokeTarget);
      clearTimeout(state.ocrTimers.get(key));
      if (state.strokeTarget.dataset.ocrFilled === 'true') clearHandwritingCell(state.strokeTarget);
    }
    scratchCanvas.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(previous.x + .1, previous.y + .1);
    context.stroke();
  });
  scratchCanvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const next = point(event);
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    previous = next;
  });
  const stop = (recognize) => {
    drawing = false;
    previous = null;
    const target = state.strokeTarget;
    state.strokeTarget = null;
    if (!recognize || !target) return;
    const key = handwritingTargetKey(target);
    const revision = state.ocrRevision;
    clearTimeout(state.ocrTimers.get(key));
    state.ocrTimers.set(key, setTimeout(() => {
      state.ocrTimers.delete(key);
      recognizeHandwriting(target, revision);
    }, 500));
  };
  scratchCanvas.addEventListener('pointerup', () => stop(true));
  scratchCanvas.addEventListener('pointercancel', () => stop(false));
  $('#clearWork').addEventListener('click', () => {
    if (state.workMode === 'handwriting') {
      state.ocrRevision += 1;
      state.ocrTimers.forEach((timer) => clearTimeout(timer));
      state.ocrTimers.clear();
      context.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
      clearRecognizedInputs();
      $('#workspaceHint').textContent = '각 빈 숫자칸에 한 자리씩 쓰면 인식해 채워요. 틀리면 숫자 입력에서 고칠 수 있어요.';
    }
    else {
      state.calculationEntries = Array.from({ length: 3 }, () => ({ product: ['', '', ''], remainder: '' }));
      renderCalculationSteps();
    }
  });
  resize();
  window.addEventListener('resize', resize);
}

function init() {
  const now = new Date();
  $('#todayDate').textContent = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(now);
  answerForm.addEventListener('submit', submitAnswer);
  $('#verticalQuotient').addEventListener('input', handleQuotientInput);
  $('#verticalQuotient').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const index = Number(event.target.dataset.quotientIndex);
      if (state.directMode && index < 2) $(`#quotientDigit${index + 1}`).focus();
      else answerForm.requestSubmit();
    }
  });
  $('#toggleDirectMode').addEventListener('click', () => setInputMode(!state.directMode));
  $('#handwritingTab').addEventListener('click', () => setWorkMode('handwriting'));
  $('#numericTab').addEventListener('click', () => setWorkMode('numeric'));
  $('#calculationSteps').addEventListener('input', handleCalculationInput);
  $$('.help-tab').forEach((tab) => tab.addEventListener('click', () => selectHelp(tab.dataset.help)));
  $$('[data-help-result]').forEach((button) => button.addEventListener('click', () => setHelpResult(button.dataset.helpResult)));
  $('#studentNav').addEventListener('click', () => setView('student'));
  $('#teacherNav').addEventListener('click', () => setView('teacher'));
  renderProblem();
  renderHelp();
  renderDashboard();
  setWorkMode(state.workMode);
  initCanvas();
}

init();
