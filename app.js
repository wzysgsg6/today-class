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

async function decryptPayload(payload, keyB64) {
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
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytesFromB64url(payload.iv) },
    key,
    bytesFromB64url(payload.data)
  );
  return JSON.parse(new TextDecoder().decode(plain));
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

  if (week < 1) {
    $('#todayView').innerHTML = `
      <div class="notice">
        <strong>还没到教学周</strong>
        <p>当前日期在第 1 周之前。可以在设置里核对第 1 周开始日期。</p>
      </div>
    `;
    return;
  }

  if (week > state.config.totalWeeks) {
    $('#todayView').innerHTML = `
      <div class="notice">
        <strong>本学期已结束</strong>
        <p>当前已超过第 ${state.config.totalWeeks} 周。</p>
      </div>
    `;
    return;
  }

  if (!courses.length) {
    $('#todayView').innerHTML = `
      <div class="empty-state">
        <div>
          <strong>今天没有课</strong>
          <p>${escapeHtml(DAY_NAMES[now.weekday])} · 第 ${week} 周 · ${escapeHtml(formatDateCN(now.dateStr))}</p>
        </div>
      </div>
    `;
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

function render() {
  if (!state.data || !state.config) return;
  const now = getShanghaiNow();
  const week = calcWeek(now.dateStr, state.config.semesterStart);
  const title = week >= 1 && week <= state.config.totalWeeks
    ? `第 ${week} 周 · ${DAY_NAMES[now.weekday]}`
    : '今日课表';

  $('#semesterLabel').textContent = state.data.meta?.subtitle || '教学周识别';
  $('#todayTitle').textContent = title;
  $('#todayDate').textContent = formatDateCN(now.dateStr, { year: 'numeric' });
  $('#heroStatus').textContent = '正在判断今天的课程…';

  renderToday(now);
  renderWeek(now);
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(semesterStart)) {
    showToast('请选择有效的日期');
    return;
  }
  state.config = { semesterStart, totalWeeks };
  localStorage.setItem('tt_config', JSON.stringify(state.config));
  closeSettings();
  render();
  showToast('已保存');
}

function resetSettings() {
  localStorage.removeItem('tt_config');
  loadConfig();
  openSettings();
  render();
  showToast('已恢复默认');
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.view === view);
  });
  $('#todayView').classList.toggle('hidden', view !== 'today');
  $('#weekView').classList.toggle('hidden', view !== 'week');
}

function bindEvents() {
  $('#settingsBtn').addEventListener('click', openSettings);
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
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

init();

