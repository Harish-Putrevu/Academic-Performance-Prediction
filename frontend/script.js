(function () {
  'use strict';

  const API_BASE = (function () {
    try {
      const loc = window.location;
      if ((loc.protocol === 'http:' || loc.protocol === 'https:') && loc.port === '5050') {
        return loc.origin + '/api';
      }
    } catch (_) {}
    return 'http://localhost:5050/api';
  })();

  const STORAGE_KEY = 'spp_user';
  let currentSubjects = [];
  let currentSummary = null;
  let showPanelFn = null;
  let currentNotifications = [];
  let charts = {
    attendance: null,
    marks: null,
    radar: null,
    ring: null,
  };

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function getPath() {
    const path = window.location.pathname.split('/').pop();
    return path || 'index.html';
  }

  function getStoredUser() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveSession(user, token) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        token,
      })
    );
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function authHeaders() {
    const user = getStoredUser();
    const headers = { 'Content-Type': 'application/json' };
    if (user && user.token) headers.Authorization = 'Bearer ' + user.token;
    return headers;
  }

  function showEl(el, show) {
    if (!el) return;
    el.classList.toggle('hidden', !show);
  }

  function setAlert(el, message, isError) {
    if (!el) return;
    if (!message) {
      showEl(el, false);
      return;
    }
    el.textContent = message;
    el.classList.remove('alert--error', 'alert--success');
    el.classList.add(isError ? 'alert--error' : 'alert--success');
    showEl(el, true);
  }

  function showToast(msg) {
    let t = document.getElementById('spp-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'spp-toast';
      t.style.cssText =
        'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0b1229;color:#e2ecff;padding:10px 18px;border-radius:10px;font-size:14px;z-index:2000;box-shadow:0 8px 30px rgba(31,77,255,.35);opacity:0;transition:opacity .3s';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => {
      t.style.opacity = '1';
    });
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      t.style.opacity = '0';
    }, 2600);
  }

  function gradeFromScore(score) {
    if (score >= 90) return 'O';
    if (score >= 80) return 'A+';
    if (score >= 70) return 'A';
    if (score >= 60) return 'B+';
    if (score >= 50) return 'B';
    return 'C';
  }

  function performanceText(grade) {
    const map = {
      O: 'Outstanding Performance',
      'A+': 'Excellent Performance',
      A: 'Very Good Performance',
      'B+': 'Good Performance',
      B: 'Satisfactory Performance',
      C: 'Needs Improvement',
    };
    return map[grade] || 'Needs Improvement';
  }

  function normalizeSubject(s) {
    const attendance = Number.isFinite(Number(s.attendance)) ? Number(s.attendance) : 0;
    const internalMarks = Number.isFinite(Number(s.internalMarks))
      ? Number(s.internalMarks)
      : Number(s.marks || 0) * 0.6;
    const predictedExternalScore = Number.isFinite(Number(s.predictedExternalScore))
      ? Number(s.predictedExternalScore)
      : Math.round((internalMarks / 60) * 26);
    const totalScore = Number.isFinite(Number(s.totalScore))
      ? Number(s.totalScore)
      : Math.min(100, internalMarks + predictedExternalScore);
    return {
      name: String(s.name || 'Unknown Subject').trim(),
      attendance: Math.max(0, Math.min(100, attendance)),
      internalMarks: Math.max(0, Math.min(60, internalMarks)),
      predictedExternalScore: Math.max(0, Math.min(40, predictedExternalScore)),
      totalScore: Math.max(0, Math.min(100, totalScore)),
    };
  }

  function summarizeSubjects(subjects) {
    if (!subjects.length) {
      return { avgAtt: 0, avgMarks: 0, grade: 'C', risk: 'High' };
    }
    const avgAtt = subjects.reduce((sum, s) => sum + s.attendance, 0) / subjects.length;
    const avgMarks = subjects.reduce((sum, s) => sum + s.totalScore, 0) / subjects.length;
    const grade = gradeFromScore((avgAtt + avgMarks) / 2);
    let risk = 'Low';
    if (avgAtt < 75 || avgMarks < 60) risk = 'Medium';
    if (avgAtt < 65 || avgMarks < 50) risk = 'High';
    return { avgAtt, avgMarks, grade, risk };
  }

  function handleNotificationClick(type) {
    if (!showPanelFn) return;
    if (type === 'attendance') showPanelFn('attendance');
    else if (type === 'marks') showPanelFn('marks');
    else if (type === 'prediction') showPanelFn('prediction');
    else showPanelFn('notifications');
  }
  window.handleNotificationClick = handleNotificationClick;

  function recommendationLinks(subject, index) {
    const ytPool = [
      'https://www.youtube.com/watch?v=3JZ_D3ELwOQ',
      'https://www.youtube.com/watch?v=H14bBuluwB8',
      'https://www.youtube.com/watch?v=8hly31xKli0',
      'https://www.youtube.com/watch?v=rfscVS0vtbw',
      'https://www.youtube.com/watch?v=ua-CiDNNj30',
      'https://www.youtube.com/watch?v=PlxWf493en4',
    ];
    const articlePool = [
      'https://www.geeksforgeeks.org/software-engineering/',
      'https://www.geeksforgeeks.org/machine-learning/',
      'https://www.geeksforgeeks.org/cloud-computing/',
      'https://www.geeksforgeeks.org/natural-language-processing-overview/',
      'https://www.geeksforgeeks.org/data-science-tutorial/',
      'https://www.geeksforgeeks.org/compiler-design-tutorials/',
    ];

    if (subject === 'Compiler Design') {
      return {
        youtube: 'https://www.youtube.com/watch?v=1CPpAqfPtoU&list=PLAaj_wcMtpVJy5dVm9OmlY5eLDHP6UPN8',
        article: 'https://www.geeksforgeeks.org/compiler-design-tutorials/',
      };
    }

    return {
      youtube: ytPool[index % ytPool.length],
      article: articlePool[index % articlePool.length],
    };
  }

  function renderRecommendations(subjects) {
    const host = document.getElementById('recommendations-grid');
    if (!host) return;
    host.innerHTML = subjects
      .map((s, idx) => {
        const links = recommendationLinks(s.name, idx);
        return (
          '<article class="recommend-card">' +
          '<h3 class="recommend-title">' +
          escapeHtml(s.name) +
          '</h3>' +
          '<p class="recommend-label">Suggested Resources</p>' +
          '<a class="recommend-link" target="_blank" rel="noopener noreferrer" href="' +
          escapeHtml(links.youtube) +
          '"><i class="fab fa-youtube"></i> YouTube Video</a>' +
          '<a class="recommend-link" target="_blank" rel="noopener noreferrer" href="' +
          escapeHtml(links.article) +
          '"><i class="fas fa-book"></i> Article (GeeksforGeeks)</a>' +
          '</article>'
        );
      })
      .join('');
  }

  function initPasswordToggles() {
    document.querySelectorAll('.toggle-pass').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.getAttribute('data-target'));
        if (!input) return;
        const icon = btn.querySelector('i');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        if (icon) {
          icon.classList.toggle('fa-eye', !show);
          icon.classList.toggle('fa-eye-slash', show);
        }
      });
    });
  }

  function initLogin() {
    const form = document.getElementById('login-form');
    if (!form) return;
    const err = document.getElementById('login-error');
    const btn = document.getElementById('login-submit');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setAlert(err, '');
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      if (!email || !password) {
        setAlert(err, 'Please enter email and password.', true);
        return;
      }
      btn.classList.add('loading');
      btn.disabled = true;
      try {
        const res = await fetch(API_BASE + '/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setAlert(err, data.message || 'Login failed.', true);
          return;
        }
        saveSession(data.user, data.token);
        window.location.href = 'dashboard.html' +
          ((data.user.role === 'professor' || data.user.role === 'admin') ? '?panel=admin' : '');
      } catch (_) {
        setAlert(err, 'Cannot reach server on port 5050.', true);
      } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
      }
    });
  }

  function initRegister() {
    const form = document.getElementById('register-form');
    if (!form) return;
    const err = document.getElementById('register-error');
    const ok = document.getElementById('register-success');
    const btn = document.getElementById('register-submit');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setAlert(err, '');
      setAlert(ok, '', false);

      const name = document.getElementById('register-name').value.trim();
      const email = document.getElementById('register-email').value.trim();
      const password = document.getElementById('register-password').value;
      const confirm = document.getElementById('register-confirm').value;

      if (!name || !email || !password) {
        setAlert(err, 'Please fill all fields.', true);
        return;
      }
      if (password.length < 6) {
        setAlert(err, 'Password must be at least 6 characters.', true);
        return;
      }
      if (password !== confirm) {
        setAlert(err, 'Passwords do not match.', true);
        return;
      }

      btn.classList.add('loading');
      btn.disabled = true;
      try {
        const res = await fetch(API_BASE + '/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setAlert(err, data.message || 'Registration failed.', true);
          return;
        }
        saveSession(data.user, data.token);
        setAlert(ok, 'Account created! Redirecting...', false);
        setTimeout(() => {
          window.location.href = 'dashboard.html';
        }, 800);
      } catch (_) {
        setAlert(err, 'Cannot reach server on port 5050.', true);
      } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
      }
    });
  }

  function upsertChart(key, config) {
    if (typeof Chart === 'undefined') return;
    const canvasIdMap = {
      attendance: 'chart-attendance',
      marks: 'chart-marks',
      radar: 'chart-radar',
      ring: 'chart-overall-ring',
    };
    const ctx = document.getElementById(canvasIdMap[key]);
    if (!ctx) return;
    if (charts[key]) charts[key].destroy();
    charts[key] = new Chart(ctx, config);
  }

  function renderCharts(subjects, summary) {
    upsertChart('attendance', {
      type: 'bar',
      data: {
        labels: subjects.map((s) => s.name),
        datasets: [
          {
            label: 'Attendance %',
            data: subjects.map((s) => s.attendance),
            borderRadius: 12,
            backgroundColor: subjects.map((s) =>
              s.attendance < 75 ? 'rgba(239,68,68,.8)' : 'rgba(56,189,248,.8)'
            ),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            grid: { color: 'rgba(148,163,184,.25)' },
            ticks: { color: '#d6e2ff' },
          },
          x: {
            ticks: { color: '#d6e2ff' },
            grid: { color: 'rgba(148,163,184,.12)' },
          },
        },
      },
    });

    const internalTotal = subjects.reduce((sum, s) => sum + s.internalMarks, 0);
    const externalTotal = subjects.reduce((sum, s) => sum + s.predictedExternalScore, 0);

    upsertChart('marks', {
      type: 'pie',
      data: {
        labels: ['Internal (out of 60)', 'Predicted External (out of 40)'],
        datasets: [
          {
            data: [internalTotal, externalTotal],
            backgroundColor: ['#38bdf8', '#8b5cf6'],
            borderColor: ['#0f172a', '#0f172a'],
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: '#d6e2ff' } } },
      },
    });

    upsertChart('radar', {
      type: 'radar',
      data: {
        labels: subjects.map((s) => s.name),
        datasets: [
          {
            label: 'Total Score',
            data: subjects.map((s) => s.totalScore),
            borderColor: '#22d3ee',
            backgroundColor: 'rgba(34,211,238,.25)',
            pointBackgroundColor: '#22d3ee',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#d6e2ff' } } },
        scales: {
          r: {
            min: 0,
            max: 100,
            ticks: { color: '#d6e2ff', backdropColor: 'transparent' },
            grid: { color: 'rgba(148,163,184,.25)' },
            angleLines: { color: 'rgba(148,163,184,.25)' },
            pointLabels: { color: '#e4ebff' },
          },
        },
      },
    });

    upsertChart('ring', {
      type: 'doughnut',
      data: {
        labels: ['Overall Score', 'Remaining'],
        datasets: [
          {
            data: [summary.avgMarks, Math.max(0, 100 - summary.avgMarks)],
            backgroundColor: ['#34d399', 'rgba(148,163,184,.25)'],
            borderWidth: 0,
            cutout: '72%',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: true },
        },
      },
    });
  }

  function renderSummary(subjects) {
    const summary = summarizeSubjects(subjects);
    currentSummary = summary;
    const avgAttEl = document.getElementById('stat-avg-att');
    const avgMarksEl = document.getElementById('stat-avg-marks');
    const gradeEl = document.getElementById('stat-grade');
    const riskEl = document.getElementById('stat-risk');
    const riskChip = document.getElementById('risk-chip');

    if (avgAttEl) avgAttEl.textContent = summary.avgAtt.toFixed(1) + '%';
    if (avgMarksEl) avgMarksEl.textContent = summary.avgMarks.toFixed(1);
    if (gradeEl) gradeEl.textContent = summary.grade;
    if (riskEl) riskEl.textContent = summary.risk;

    if (riskChip) {
      riskChip.classList.remove('risk-low', 'risk-medium', 'risk-high');
      if (summary.risk === 'Low') riskChip.classList.add('risk-low');
      else if (summary.risk === 'Medium') riskChip.classList.add('risk-medium');
      else riskChip.classList.add('risk-high');
    }

    const improvedGrade = gradeFromScore(Math.min(100, summary.avgMarks + 10));
    const baseLine = document.getElementById('expected-base');
    const improvedLine = document.getElementById('expected-improved');
    if (baseLine) baseLine.textContent = 'If current trend continues → Grade ' + summary.grade;
    if (improvedLine) improvedLine.textContent = 'If improved by +10 marks → Grade ' + improvedGrade;

    renderCharts(subjects, summary);
  }

  function renderNotifications(subjects) {
    const alerts = [];
    subjects.forEach((s) => {
      if (s.attendance < 75) {
        alerts.push({ type: 'attendance', text: '⚠ Low attendance in ' + s.name });
      }
      if (s.totalScore < 60) {
        alerts.push({ type: 'marks', text: '📉 Low marks in ' + s.name });
      }
    });

    const weakest = subjects
      .slice()
      .sort((a, b) => (a.totalScore + a.attendance) - (b.totalScore + b.attendance))[0];
    alerts.push({ type: 'prediction', text: '📅 Upcoming internal exams next week' });
    alerts.push({
      type: 'prediction',
      text: '🔥 Improve ' + (weakest ? weakest.name : 'your weak subject') + ' to reach A grade',
    });

    if (!alerts.length) {
      alerts.push({ type: 'general', text: '✅ No critical alerts. You are on a stable performance trend.' });
    }

    currentNotifications = alerts;

    const list = document.getElementById('notifications-list');
    const dropdown = document.getElementById('notif-dropdown');
    const count = document.getElementById('notif-count');
    if (list) {
      list.innerHTML = alerts
        .map(
          (x, idx) =>
            '<li class="suggestion-item notif-action" data-notif-index="' +
            idx +
            '"><span class="s-icon"><i class="fas fa-bell"></i></span><span>' +
            escapeHtml(x.text) +
            '</span></li>'
        )
        .join('');
    }
    if (dropdown) {
      dropdown.innerHTML = alerts
        .map(
          (x, idx) =>
            '<button type="button" class="notif-item notif-action" data-notif-index="' +
            idx +
            '">' +
            escapeHtml(x.text) +
            '</button>'
        )
        .join('');
    }

    document.querySelectorAll('.notif-action').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = Number(el.getAttribute('data-notif-index'));
        const item = currentNotifications[idx];
        handleNotificationClick(item?.type || 'general');
        showEl(document.getElementById('notif-dropdown'), false);
      });
    });

    if (count) {
      const c = alerts[0]?.text?.startsWith('✅') ? 0 : alerts.length;
      count.textContent = String(c);
      showEl(count, c > 0);
    }
  }

  async function callOverallAI(userId, subjects) {
    const block = document.getElementById('overall-ai-block');
    if (!block) return;
    block.innerHTML = 'Running AI analysis...';
    try {
      const res = await fetch(API_BASE + '/ai/overall', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ userId, subjects }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Overall AI analysis failed');

      block.innerHTML = [
        '<p><strong>Strengths:</strong> ' + escapeHtml((data.strengths || []).join(', ') || 'N/A') + '</p>',
        '<p><strong>Weak Subjects:</strong> ' + escapeHtml((data.weakSubjects || []).join(', ') || 'None') + '</p>',
        '<p><strong>GPA Estimate:</strong> ' + escapeHtml(data.gpaEstimate || 'N/A') + '</p>',
        '<p><strong>Improvement Plan:</strong> ' +
          escapeHtml((data.improvementPlan || []).slice(0, 2).join(' | ') || 'N/A') +
          '</p>',
        '<p><strong>Motivation:</strong> ' + escapeHtml(data.motivationalInsight || 'Keep going.') + '</p>',
      ].join('');
    } catch (err) {
      block.innerHTML = '<p>' + escapeHtml(err.message || 'Unable to fetch AI summary.') + '</p>';
    }
  }

  function subjectRiskClass(subject) {
    if (subject.totalScore >= 80 && subject.attendance >= 85) return 'subject-card--strong';
    if (subject.totalScore < 60 || subject.attendance < 75) return 'subject-card--weak';
    return 'subject-card--avg';
  }

  function bindSubjectModal() {
    const modal = document.getElementById('subject-modal');
    document.getElementById('subject-modal-close')?.addEventListener('click', () => showEl(modal, false));
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) showEl(modal, false);
    });
  }

  async function openSubjectInsight(subject) {
    const modal = document.getElementById('subject-modal');
    const box = document.getElementById('subject-modal-content');
    if (!modal || !box) return;
    showEl(modal, true);
    box.innerHTML = '<p>Generating AI subject analysis...</p>';
    try {
      const res = await fetch(API_BASE + '/ai/subject-analysis', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          subject: subject.name,
          attendance: subject.attendance,
          internalMarks: subject.internalMarks,
          marks: subject.totalScore,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Failed to fetch subject analysis');

      box.innerHTML = [
        '<p><strong>You need ~' + escapeHtml(String(data.expectedScore || 0)) + '/40 in externals to reach 90+ total.</strong></p>',
        '<h3>Weaknesses</h3>',
        '<ul>' + (data.weaknesses || []).map((w) => '<li>' + escapeHtml(w) + '</li>').join('') + '</ul>',
        '<h3>Study Strategy</h3>',
        '<ul>' + (data.strategy || []).map((s) => '<li>' + escapeHtml(s) + '</li>').join('') + '</ul>',
        '<h3>Mini Quiz</h3>',
        '<ol>' + (data.quizQuestions || []).map((q) => '<li>' + escapeHtml(q) + '</li>').join('') + '</ol>',
      ].join('');
    } catch (err) {
      box.innerHTML = '<p>' + escapeHtml(err.message || 'Subject analysis failed') + '</p>';
    }
  }

  function renderSubjectHeatmap(subjects) {
    const host = document.getElementById('subject-heatmap');
    if (!host) return;
    host.innerHTML = subjects
      .map((s, index) => {
        const requiredExternal = Math.max(0, Math.ceil(90 - s.internalMarks));
        return (
          '<button type="button" class="subject-card ' +
          subjectRiskClass(s) +
          '" data-subject-index="' +
          index +
          '">' +
          '<span class="subject-name">' +
          escapeHtml(s.name) +
          '</span>' +
          '<span class="subject-meta">Attendance: ' +
          escapeHtml(s.attendance.toFixed(1)) +
          '%</span>' +
          '<span class="subject-meta">Internal: ' +
          escapeHtml(s.internalMarks.toFixed(1)) +
          '/60</span>' +
          '<span class="subject-meta">Pred External: ' +
          escapeHtml(s.predictedExternalScore.toFixed(1)) +
          '/40</span>' +
          '<span class="subject-meta">Total: ' +
          escapeHtml(s.totalScore.toFixed(1)) +
          '/100</span>' +
          '<span class="subject-tip">Need ~' +
          escapeHtml(String(requiredExternal)) +
          '/40 for 90+</span>' +
          '</button>'
        );
      })
      .join('');

    host.querySelectorAll('[data-subject-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-subject-index'));
        const subject = currentSubjects[idx];
        if (subject) openSubjectInsight(subject);
      });
    });
  }

  function renderDashboardState(user) {
    renderSummary(currentSubjects);
    renderSubjectHeatmap(currentSubjects);
    renderNotifications(currentSubjects);
    renderRecommendations(currentSubjects);
    callOverallAI(user.id, currentSubjects);
  }

  async function fetchMyData(user) {
    const res = await fetch(API_BASE + '/student/my/' + encodeURIComponent(user.id), {
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Failed to load your data');
    return data;
  }

  function setupPanelNavigation(isProfessor) {
    const panels = document.querySelectorAll('.acad-panel');
    const navBtns = document.querySelectorAll('.acad-nav-btn[data-panel]');
    const pageTitle = document.getElementById('acad-page-title');
    const adminBtn = document.querySelector('.acad-nav-btn[data-panel="admin"]');
    if (!isProfessor && adminBtn) adminBtn.classList.add('hidden');

    function showPanel(name) {
      if (name === 'admin' && !isProfessor) name = 'dashboard';
      panels.forEach((p) => showEl(p, p.dataset.panel === name));
      navBtns.forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
      const activeBtn = document.querySelector('.acad-nav-btn[data-panel="' + name + '"]');
      if (activeBtn && pageTitle) pageTitle.textContent = activeBtn.dataset.title || name;
      if (name === 'admin' && isProfessor) loadDashboardAdminStudents();
    }

    navBtns.forEach((btn) => {
      btn.addEventListener('click', () => showPanel(btn.dataset.panel));
    });

    const initialPanel = new URLSearchParams(window.location.search).get('panel') || 'dashboard';
    showPanel(initialPanel);
    showPanelFn = showPanel;

    return { showPanel };
  }

  async function initDashboard() {
    const user = getStoredUser();
    if (!user || !user.token) {
      window.location.href = 'login.html';
      return;
    }

    const isProfessor = user.role === 'professor' || user.role === 'admin';
    const userNameEl = document.getElementById('acad-user-name');
    const welcomeEl = document.getElementById('acad-welcome-line');
    if (userNameEl) userNameEl.textContent = user.name || 'Student';
    if (welcomeEl) welcomeEl.textContent = 'Welcome back - ' + (user.name || 'Student');

    bindSubjectModal();
    setupProfessorModal();
    setupPanelNavigation(isProfessor);

    const bell = document.getElementById('notif-bell');
    const dropdown = document.getElementById('notif-dropdown');
    bell?.addEventListener('click', () => {
      if (!dropdown) return;
      showEl(dropdown, dropdown.classList.contains('hidden'));
    });

    document.addEventListener('click', (e) => {
      if (!dropdown || !bell) return;
      if (!dropdown.contains(e.target) && e.target !== bell && !bell.contains(e.target)) {
        showEl(dropdown, false);
      }
    });

    const logoutModal = document.getElementById('logout-modal');
    document.getElementById('acad-logout')?.addEventListener('click', () => showEl(logoutModal, true));
    document.getElementById('logout-cancel')?.addEventListener('click', () => showEl(logoutModal, false));
    document.getElementById('logout-confirm')?.addEventListener('click', () => {
      clearSession();
      window.location.href = 'login.html';
    });
    logoutModal?.addEventListener('click', (e) => {
      if (e.target === logoutModal) showEl(logoutModal, false);
    });

    document.getElementById('regenerate-demo-btn')?.addEventListener('click', async () => {
      try {
        const res = await fetch(API_BASE + '/student/demo/generate', {
          method: 'POST',
          headers: authHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Failed generating demo data');
        currentSubjects = (data.subjects || []).map(normalizeSubject);
        renderDashboardState(user);
        showToast('Demo data regenerated');
      } catch (err) {
        showToast(err.message || 'Network error while regenerating demo data');
      }
    });

    document.getElementById('prediction-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('dash-error');
      setAlert(err, '');

      const attendance = Number(document.getElementById('input-attendance').value);
      const internalMarks = Number(document.getElementById('input-marks').value);
      const previousGrade = document.getElementById('input-prev-grade').value;

      if (attendance < 0 || attendance > 100 || internalMarks < 0 || internalMarks > 60 || !previousGrade) {
        setAlert(err, 'Provide valid attendance, internal marks (0-60), and previous grade.', true);
        return;
      }

      const btn = document.getElementById('submit-predict');
      btn.classList.add('loading');
      btn.disabled = true;
      try {
        const res = await fetch(API_BASE + '/student/submit', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ attendance, internalMarks, previousGrade }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Prediction failed');

        document.getElementById('result-grade').textContent = data.predictedGrade;
        document.getElementById('result-performance').textContent =
          data.performanceText || performanceText(data.predictedGrade);
        showEl(document.getElementById('section-result'), true);

        if (currentSummary) {
          const improvedGrade = gradeFromScore(Math.min(100, currentSummary.avgMarks + 10));
          document.getElementById('expected-base').textContent =
            'If current trend continues → Grade ' + data.predictedGrade;
          document.getElementById('expected-improved').textContent =
            'If improved by +10 marks → Grade ' + improvedGrade;
        }
      } catch (err2) {
        setAlert(err, err2.message || 'Prediction request failed', true);
      } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
      }
    });

    document.getElementById('ai-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('ai-input');
      const box = document.getElementById('ai-chat-window');
      const message = input.value.trim();
      if (!message || !box) return;

      box.insertAdjacentHTML('beforeend', '<div class="chat-msg chat-msg--user">' + escapeHtml(message) + '</div>');
      box.scrollTop = box.scrollHeight;
      input.value = '';

      try {
        const res = await fetch(API_BASE + '/ai/chat', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            message,
            userId: user.id,
            studentData: { subjects: currentSubjects },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'AI request failed');
        box.insertAdjacentHTML(
          'beforeend',
          '<div class="chat-msg chat-msg--ai">' + escapeHtml(data.reply || 'No response') + '</div>'
        );
        box.scrollTop = box.scrollHeight;
      } catch (chatErr) {
        box.insertAdjacentHTML(
          'beforeend',
          '<div class="chat-msg chat-msg--ai">' + escapeHtml(chatErr.message || 'AI chat failed') + '</div>'
        );
        box.scrollTop = box.scrollHeight;
      }
    });

    try {
      const data = await fetchMyData(user);
      currentSubjects = (data.student?.subjects || []).map(normalizeSubject);
      if (!currentSubjects.length) {
        const regen = await fetch(API_BASE + '/student/demo/generate', {
          method: 'POST',
          headers: authHeaders(),
        });
        const rdata = await regen.json().catch(() => ({}));
        if (regen.ok) {
          currentSubjects = (rdata.subjects || []).map(normalizeSubject);
        }
      }
      renderDashboardState(user);
      showToast('AI dashboard ready');
    } catch (errLoad) {
      showToast(errLoad.message || 'Unable to load student data');
    }
  }

  let professorModalState = {
    studentId: null,
    mode: 'view',
  };

  function setupProfessorModal() {
    const modal = document.getElementById('prof-modal');
    document.getElementById('prof-modal-cancel')?.addEventListener('click', () => showEl(modal, false));
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) showEl(modal, false);
    });
    document.getElementById('prof-modal-save')?.addEventListener('click', saveProfessorMarksEdits);
  }

  function renderDashboardAdminTable(rows) {
    const tbody = document.getElementById('dash-admin-table');
    if (!tbody) return;
    tbody.innerHTML = rows
      .map((r) => {
        const weak = (r.weakSubjects || []).join(', ') || 'None';
        return [
          '<tr>',
          '<td><strong>' + escapeHtml(r.name || '-') + '</strong><br><small>' + escapeHtml(r.email || '-') + '</small></td>',
          '<td>' + escapeHtml(String(Number(r.avgMarks || 0).toFixed(1))) + '</td>',
          '<td>' + escapeHtml(r.riskLevel || '-') + '</td>',
          '<td>' + escapeHtml(weak) + '</td>',
          '<td class="table-actions">',
          '<button type="button" class="btn-tiny edit" data-view-id="' + escapeHtml(r._id) + '">View Details</button>',
          '<button type="button" class="btn-tiny delete" data-edit-id="' + escapeHtml(r._id) + '">Edit Marks</button>',
          '</td>',
          '</tr>',
        ].join('');
      })
      .join('');

    tbody.querySelectorAll('[data-view-id]').forEach((btn) => {
      btn.addEventListener('click', () => openProfessorDetail(btn.getAttribute('data-view-id'), false));
    });
    tbody.querySelectorAll('[data-edit-id]').forEach((btn) => {
      btn.addEventListener('click', () => openProfessorDetail(btn.getAttribute('data-edit-id'), true));
    });
  }

  async function loadDashboardAdminStudents() {
    const err = document.getElementById('dash-admin-error');
    try {
      const res = await fetch(API_BASE + '/student/all', { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAlert(err, data.message || 'Failed to load students', true);
        return;
      }
      setAlert(err, '');
      renderDashboardAdminTable(data.students || []);
    } catch (_) {
      setAlert(err, 'Network error while loading students', true);
    }
  }

  async function openProfessorDetail(studentId, editable) {
    if (!studentId) return;
    const modal = document.getElementById('prof-modal');
    const content = document.getElementById('prof-modal-content');
    const saveBtn = document.getElementById('prof-modal-save');

    professorModalState.studentId = studentId;
    professorModalState.mode = editable ? 'edit' : 'view';

    if (saveBtn) showEl(saveBtn, editable);
    if (content) content.innerHTML = '<p>Loading student details...</p>';
    showEl(modal, true);

    try {
      const res = await fetch(API_BASE + '/student/detail/' + encodeURIComponent(studentId), {
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Failed to fetch student detail');
      const student = data.student || {};
      const subjects = Array.isArray(student.subjects) ? student.subjects : [];

      content.innerHTML = [
        '<p><strong>' + escapeHtml(student.name || '-') + '</strong> (' + escapeHtml(student.studentCode || '-') + ')</p>',
        '<p>Email: ' + escapeHtml(student.email || '-') + '</p>',
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>Subject</th><th>Attendance</th><th>Internal /60</th><th>Pred External /40</th><th>Total /100</th></tr></thead><tbody>',
        subjects
          .map((s, idx) => {
            const name = escapeHtml(s.name);
            if (!editable) {
              return (
                '<tr><td>' +
                name +
                '</td><td>' +
                escapeHtml(String(Number(s.attendance).toFixed(1))) +
                '%</td><td>' +
                escapeHtml(String(Number(s.internalMarks).toFixed(1))) +
                '</td><td>' +
                escapeHtml(String(Number(s.predictedExternalScore).toFixed(1))) +
                '</td><td>' +
                escapeHtml(String(Number(s.totalScore).toFixed(1))) +
                '</td></tr>'
              );
            }
            return (
              '<tr data-edit-row="' +
              idx +
              '"><td>' +
              name +
              '</td><td><input type="number" data-field="attendance" min="0" max="100" step="0.1" value="' +
              escapeHtml(String(Number(s.attendance).toFixed(1))) +
              '"></td><td><input type="number" data-field="internalMarks" min="0" max="60" step="0.1" value="' +
              escapeHtml(String(Number(s.internalMarks).toFixed(1))) +
              '"></td><td>' +
              escapeHtml(String(Number(s.predictedExternalScore).toFixed(1))) +
              '</td><td>' +
              escapeHtml(String(Number(s.totalScore).toFixed(1))) +
              '</td><input type="hidden" data-field="name" value="' +
              name +
              '"></tr>'
            );
          })
          .join('') +
          '</tbody></table></div>',
      ].join('');
    } catch (err) {
      if (content) content.innerHTML = '<p>' + escapeHtml(err.message || 'Unable to load details') + '</p>';
    }
  }

  async function saveProfessorMarksEdits() {
    const studentId = professorModalState.studentId;
    if (!studentId || professorModalState.mode !== 'edit') return;
    const modal = document.getElementById('prof-modal');
    const rows = Array.from(document.querySelectorAll('#prof-modal-content tr[data-edit-row]'));
    const subjects = rows.map((row) => {
      const name = row.querySelector('[data-field="name"]')?.value || 'Subject';
      const attendance = Number(row.querySelector('[data-field="attendance"]')?.value || 0);
      const internalMarks = Number(row.querySelector('[data-field="internalMarks"]')?.value || 0);
      const predictedExternalScore = Math.max(0, Math.min(40, Math.round((internalMarks / 60) * 26)));
      return {
        name,
        attendance,
        internalMarks,
        predictedExternalScore,
        totalScore: Math.max(0, Math.min(100, internalMarks + predictedExternalScore)),
      };
    });

    try {
      const res = await fetch(API_BASE + '/student/' + encodeURIComponent(studentId) + '/subjects', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ subjects }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Failed to update subjects');
      showEl(modal, false);
      showToast('Marks updated successfully');
      await loadDashboardAdminStudents();
    } catch (err) {
      showToast(err.message || 'Failed to save edits');
    }
  }

  function initAdmin() {
    // Keep backward compatibility for existing admin.html route.
    const user = getStoredUser();
    if (!user || !user.token || (user.role !== 'professor' && user.role !== 'admin')) {
      window.location.href = 'login.html';
      return;
    }
    window.location.href = 'dashboard.html?panel=admin';
  }

  document.addEventListener('DOMContentLoaded', () => {
    initPasswordToggles();
    const path = getPath();
    if (path === 'login.html') initLogin();
    else if (path === 'register.html') initRegister();
    else if (path === 'dashboard.html') initDashboard();
    else if (path === 'admin.html') initAdmin();
  });
})();
