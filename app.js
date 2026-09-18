const $ = (sel) => document.querySelector(sel);

const state = {
  data: null,
  config: null,
  view: 'today',
  keyB64: null
};

const DAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function bytesFromB64url(value) {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function decryptBytes(payload, keyB64) {
  if (!payload || payload.v !== 1 || payload.alg !== 'A256GCM') {
    throw new Error('不支持的数据格式');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    bytesFromB64url(keyB64),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytesFromB64url(payload.iv) },
    key,
    bytesFromB64url(payload.data)
  ));
}

async function decryptPayload(payload, keyB64) {
  return JSON.parse(new TextDecoder().decode(await decryptBytes(payload, keyB64)));
}

async function openOriginalPdf() {
  if (!state.keyB64) {
    showToast('缺少访问密钥');
    return;
  }

  const win = window.open('', '_blank');
  if (win) {
    try {
      win.document.title = '原版 PDF';
      win.document.body.innerHTML = '<p style="padding:24px;color:#111827">正在解密原版 PDF…</p>';
    } catch (_) {}
  }

  try {
    let response;
    try {
      response = await fetch('./schedule.pdf.enc.json?v=20260918', { cache: 'no-store' });
      if (!response.ok) throw new Error('PDF 数据读取失败');
    } catch (_) {
      response = await fetch('./schedule.pdf.enc.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('PDF 数据读取失败');
    }
    const payload = await response.json();
    const bytes = await decryptBytes(payload, state.keyB64);
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    if (win) win.location.href = blobUrl;
    else window.location.href = blobUrl;
    setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
  } catch (error) {
    if (win) win.close();
    const message = error?.name === 'OperationError'
      ? '密钥不匹配：请用 QQ 完整链接重新打开一次，或到设置里更新访问密钥'
      : (error.message || 'PDF 打开失败');
    showToast(message);
  }
}

function parseISODateUTC(value) {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function formatDateCN(dateStr, options = {}) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    ...options
  }).format(date);
}

function weekdayFromISO(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const dayNum = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayNum === 0 ? 7 : dayNum;
}

function getShanghaiNow() {
  const timeZone = state.data?.meta?.timezone || 'Asia/Shanghai';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    dateStr,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdayFromISO(dateStr)
  };
}

function calcWeek(dateStr, semesterStart) {
  const current = parseISODateUTC(dateStr);
  const start = parseISODateUTC(semesterStart);
  const diffDays = Math.floor((current - start) / 86400000);
  return Math.floor(diffDays / 7) + 1;
}

function minutesOfDay(time) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function inWeeks(course, week) {
  return (course.weeks || []).some(([start, end]) => week >= start && week <= end);
}

function weeksLabel(course) {
  return (course.weeks || [])
    .map(([start, end]) => start === end ? `${start}周` : `${start}–${end}周`)
    .join('、');
}

function coursesFor(week, weekday) {
  return (state.data?.courses || [])
    .filter((course) => course.day === weekday && inWeeks(course, week))
    .sort((a, b) => minutesOfDay(a.start) - minutesOfDay(b.start));
}

function teacherFor(course, week) {
  return course.teacherByWeek?.[String(week)] || course.teacher || '';
}

function teacherLabel(course) {
  if (course.teacher) return course.teacher;
  if (!course.teacherByWeek) return '';
  const groups = {};
  for (const [week, teacher] of Object.entries(course.teacherByWeek)) {
    if (!groups[teacher]) groups[teacher] = [];
    groups[teacher].push(week);
  }
  return Object.entries(groups)
    .map(([teacher, weeks]) => `${weeks.join('/')}周 ${teacher}`)
    .join('；');
}

function courseStatus(course, nowMinutes) {
  const start = minutesOfDay(course.start);
  const end = minutesOfDay(course.end);
  if (nowMinutes < start) return { key: 'upcoming', label: '未开始' };
  if (nowMinutes <= end) return { key: 'ongoing', label: '进行中' };
  return { key: 'ended', label: '已结束' };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderCourseCard(course, week, nowMinutes) {
  const status = courseStatus(course, nowMinutes);
  const teacher = teacherFor(course, week);
  return `
    <article class="course-card is-${status.key}">
      <div class="course-time">
        ${escapeHtml(course.periods)}
        <span>${escapeHtml(course.start)}<br>${escapeHtml(course.end)}</span>
      </div>
      <div class="course-main">
        <h3>${escapeHtml(course.name)}</h3>
        <div class="course-meta">
          <div><b>周次</b> ${escapeHtml(weeksLabel(course))}</div>
          ${teacher ? `<div><b>教师</b> ${escapeHtml(teacher)}</div>` : ''}
          ${course.room ? `<div><b>地点</b> ${escapeHtml(course.room)}</div>` : ''}
        </div>
        <span class="badge ${status.key}">${status.label}</span>
      </div>
    </article>
  `;
}

function renderToday(now) {
  const week = calcWeek(now.dateStr, state.config.semesterStart);
  const courses = week >= 1 && week <= state.config.totalWeeks
    ? coursesFor(week, now.weekday)
    : [];
  const nowMinutes = now.hour * 60 + now.minute;

  if (!Number.isFinite(week)) {
    $('#todayView').innerHTML = `
      <div class="notice">
        <strong>第 1 周日期无效</strong>
        <p>这里填的是“教学周第 1 周的周一”，不是第一门课的日期。吉林大学 2026–2027 第一学期应填 2026-08-31。</p>
        <button class="btn btn-primary" id="quickResetBtn" type="button">恢复默认</button>
      </div>
    `;
    $('#quickResetBtn')?.addEventListener('click', applyDefaults);
    $('#heroStatus').textContent = '请先校准第 1 周日期';
    return;
  }

  if (week < 1) {
    $('#todayView').innerHTML = `
      <div class="notice">
        <strong>还没到教学周</strong>
        <p>当前设置的第 1 周是 ${escapeHtml(state.config.semesterStart)}。如果这不是学校教学周的第一周，请点恢复默认。</p>
        <button class="btn btn-primary" id="quickResetBtn" type="button">恢复默认（2026-08-31）</button>
      </div>
    `;
    $('#quickResetBtn')?.addEventListener('click', applyDefaults);
    $('#heroStatus').textContent = '日期设置可能不对';
    return;
  }

  if (week > state.config.totalWeeks) {
    $('#todayView').innerHTML = `
      <div class="notice">
        <strong>本学期已结束</strong>
        <p>当前已超过第 ${state.config.totalWeeks} 周。</p>
      </div>
    `;
    $('#heroStatus').textContent = '本学期已结束';
    return;
  }

  if (!courses.length) {
    $('#todayView').innerHTML = `
      <div class="empty-state">
        <div>
          <strong>今天没有课</strong>
          <p>第 ${week} 周 · ${escapeHtml(formatDateCN(now.dateStr))}</p>
        </div>
      </div>
    `;
    $('#heroStatus').textContent = '今天没有课';
    return;
  }

  const upcoming = courses.find((course) => minutesOfDay(course.start) > nowMinutes);
  const ongoing = courses.find((course) => minutesOfDay(course.start) <= nowMinutes && minutesOfDay(course.end) >= nowMinutes);
  let statusText = '今天的课已结束';
  if (ongoing) statusText = `正在上：${ongoing.name}`;
  else if (upcoming) statusText = `下一节 ${upcoming.start} · ${upcoming.name}`;

  $('#todayView').innerHTML = `
    <div class="section-label">
      <span>今日课程</span>
      <span>${courses.length} 门</span>
    </div>
    <div class="course-list">
      ${courses.map((course) => renderCourseCard(course, week, nowMinutes)).join('')}
    </div>
  `;
  $('#heroStatus').textContent = statusText;
}

function renderWeek(now) {
  const week = calcWeek(now.dateStr, state.config.semesterStart);
  if (week < 1 || week > state.config.totalWeeks) {
    $('#weekView').innerHTML = '<div class="notice"><strong>不在教学周内</strong><p>暂不显示周视图。</p></div>';
    return;
  }

  const days = [];
  for (let day = 1; day <= 7; day += 1) {
    const courses = coursesFor(week, day);
    const isToday = day === now.weekday;
    days.push(`
      <section class="day-card ${isToday ? 'is-today' : ''}">
        <div class="day-head">
          <h2>${DAY_NAMES[day]}${isToday ? ' · 今天' : ''}</h2>
          <span>${courses.length ? `${courses.length} 门` : '无课'}</span>
        </div>
        ${courses.length ? courses.map((course) => {
          const teacher = teacherFor(course, week);
          return `
            <div class="mini-course">
              <time>${escapeHtml(course.periods)}<br>${escapeHtml(course.start)}</time>
              <div>
                <strong>${escapeHtml(course.name)}</strong>
                <small>${escapeHtml(weeksLabel(course))}${teacher ? ` · ${escapeHtml(teacher)}` : ''}${course.room ? `<br>${escapeHtml(course.room)}` : ''}</small>
              </div>
            </div>
          `;
        }).join('') : ''}
      </section>
    `);
  }
  $('#weekView').innerHTML = `<div class="week-list">${days.join('')}</div>`;
}

function renderAll(now) {
  const allCourses = [...(state.data.courses || [])]
    .sort((a, b) => a.day - b.day || minutesOfDay(a.start) - minutesOfDay(b.start));
  const days = [];
  for (let day = 1; day <= 7; day += 1) {
    const courses = allCourses.filter((course) => course.day === day);
    const isToday = day === now.weekday;
    days.push(`
      <section class="day-card ${isToday ? 'is-today' : ''}">
        <div class="day-head">
          <h2>${DAY_NAMES[day]}${isToday ? ' · 今天' : ''}</h2>
          <span>${courses.length ? `${courses.length} 门` : '无课'}</span>
        </div>
        ${courses.length ? courses.map((course) => `
          <div class="mini-course">
            <time>${escapeHtml(course.periods)}<br>${escapeHtml(course.start)}</time>
            <div>
              <strong>${escapeHtml(course.name)}</strong>
              <small>${escapeHtml(weeksLabel(course))}${teacherLabel(course) ? ` · ${escapeHtml(teacherLabel(course))}` : ''}${course.room ? `<br>${escapeHtml(course.room)}` : ''}</small>
            </div>
          </div>
        `).join('') : ''}
      </section>
    `);
  }
  $('#allView').innerHTML = `
    <div class="section-label">
      <span>本学期全部课程</span>
      <span>${allCourses.length} 门</span>
    </div>
    <div class="week-list">${days.join('')}</div>
  `;
}

function render() {
  if (!state.data || !state.config) return;
  const now = getShanghaiNow();
  const week = calcWeek(now.dateStr, state.config.semesterStart);
  const title = Number.isFinite(week) && week >= 1 && week <= state.config.totalWeeks
    ? `第 ${week} 周 · ${DAY_NAMES[now.weekday]}`
    : '今日课表';

  $('#semesterLabel').textContent = state.data.meta?.subtitle || '教学周识别';
  $('#todayTitle').textContent = title;
  $('#todayDate').textContent = formatDateCN(now.dateStr, { year: 'numeric' });
  $('#heroStatus').textContent = '正在判断今天的课程…';

  renderToday(now);
  renderWeek(now);
  renderAll(now);
}

function loadConfig() {
  const defaults = {
    semesterStart: state.data.meta?.semesterStart || '2026-08-31',
    totalWeeks: Number(state.data.meta?.totalWeeks || 18)
  };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('tt_config') || '{}'); } catch (_) {}
  state.config = { ...defaults, ...saved };
}

function openSettings() {
  $('#semesterStartInput').value = state.config.semesterStart;
  $('#totalWeeksInput').value = state.config.totalWeeks;
  $('#keyInput').value = state.keyB64 || '';
  $('#settingsSheet').classList.remove('hidden');
}

function closeSettings() {
  $('#settingsSheet').classList.add('hidden');
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 1800);
}

function saveSettings() {
  const semesterStart = $('#semesterStartInput').value;
  const totalWeeks = Math.min(30, Math.max(1, Number($('#totalWeeksInput').value) || 18));
  const keyValue = $('#keyInput').value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(semesterStart)) {
    showToast('请选择有效的日期');
    return;
  }
  state.config = { semesterStart, totalWeeks };
  localStorage.setItem('tt_config', JSON.stringify(state.config));
  if (keyValue && keyValue !== state.keyB64) {
    state.keyB64 = keyValue;
    localStorage.setItem('tt_key', keyValue);
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    params.set('k', keyValue);
    history.replaceState(null, '', `${location.pathname}${location.search}#${params.toString()}`);
    closeSettings();
    showToast('密钥已保存，正在重新加载');
    setTimeout(() => location.reload(), 500);
    return;
  }
  closeSettings();
  render();
  showToast('已保存');
}

function applyDefaults() {
  localStorage.removeItem('tt_config');
  loadConfig();
  render();
  showToast('已恢复默认');
}

function resetSettings() {
  applyDefaults();
  openSettings();
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.view === view);
  });
  $('#todayView').classList.toggle('hidden', view !== 'today');
  $('#weekView').classList.toggle('hidden', view !== 'week');
  $('#allView').classList.toggle('hidden', view !== 'all');
}

function bindEvents() {
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#pdfBtn').addEventListener('click', openOriginalPdf);
  $('#closeSettingsBtn').addEventListener('click', closeSettings);
  $('#saveSettingsBtn').addEventListener('click', saveSettings);
  $('#resetSettingsBtn').addEventListener('click', resetSettings);
  $('#settingsSheet').addEventListener('click', (event) => {
    if (event.target === $('#settingsSheet')) closeSettings();
  });
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  });
}

async function init() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const keyFromHash = hash.get('k');
  if (keyFromHash) localStorage.setItem('tt_key', keyFromHash);
  state.keyB64 = keyFromHash || localStorage.getItem('tt_key');

  if (!state.keyB64) {
    $('#todayView').innerHTML = '<div class="notice"><strong>缺少访问密钥</strong><p>请从完整链接打开本页。</p></div>';
    $('#heroStatus').textContent = '缺少访问密钥';
    $('#pdfBtn')?.classList.add('hidden');
    return;
  }

  try {
    const response = await fetch('./data.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('读取数据失败');
    const payload = await response.json();
    state.data = await decryptPayload(payload, state.keyB64);
    loadConfig();
    bindEvents();
    setView('today');
    render();
  } catch (error) {
    console.error(error);
    $('#todayView').innerHTML = `<div class="notice"><strong>课表读取失败</strong><p>${escapeHtml(error.message || '请检查链接后重试')}</p></div>`;
    $('#heroStatus').textContent = '读取失败';
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js?v=5').catch(() => {});
  });
}

init();

