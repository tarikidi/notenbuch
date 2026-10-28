// ============================================================================
// Notenbuch App – Multi-Student (Kinder), Icons, Drag & Drop, GitHub Cloud-Sync
// ============================================================================

const SUBJECT_ICONS_LIST = [
  '📖', '📐', '🇬🇧', '🌍', '🎵', '🧬', '⚡', '🧪',
  '🎨', '⚽', '🏛️', '💻', '🇫🇷', '🇪🇸', '🏺', '🕊️',
  '⚖️', '📊', '🌱', '🔬', '🧮', '🎭', '🛠️', '📚',
  '✏️', '📝', '🧠', '🔭', '🎻', '🏀', '🏊', '🎓'
];

const STUDENT_AVATARS_LIST = [
  '👦', '👧', '🧒', '🧑', '🎓', '🌟', '⚽', '🏀',
  '🦄', '🦁', '🐼', '🦊', '🚀', '🎮', '🎨', '🎵'
];

const DEFAULT_SUBJECT_ICONS = {
  deutsch: '📖',
  englisch: '🇬🇧',
  geographie: '🌍',
  erdkunde: '🌍',
  mathematik: '📐',
  mathe: '📐',
  musik: '🎵',
  biologie: '🧬',
  bio: '🧬',
  physik: '⚡',
  chemie: '🧪',
  kunst: '🎨',
  sport: '⚽',
  geschichte: '🏛️',
  informatik: '💻',
  religion: '🕊️',
  ethik: '⚖️',
  französisch: '🇫🇷',
  latein: '🏺',
  spanisch: '🇪🇸',
  wirtschaft: '📊',
  heimat: '🌱',
  sachkunde: '🌱',
  hsu: '🌱',
  werken: '🛠️'
};

function guessIconForSubject(name = '') {
  const lower = name.toLowerCase().trim();
  for (const [key, icon] of Object.entries(DEFAULT_SUBJECT_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return '📚';
}

function createDefaultSubjectsForStudent(studentId) {
  return [
    { id: `sub-${studentId}-deutsch`, studentId, name: 'Deutsch', icon: '📖' },
    { id: `sub-${studentId}-mathematik`, studentId, name: 'Mathematik', icon: '📐' },
    { id: `sub-${studentId}-englisch`, studentId, name: 'Englisch', icon: '🇬🇧' },
    { id: `sub-${studentId}-geographie`, studentId, name: 'Geographie', icon: '🌍' },
    { id: `sub-${studentId}-musik`, studentId, name: 'Musik', icon: '🎵' }
  ];
}

const GH_SYNC_STORAGE_KEY = 'notenbuch_gh_sync_config_v1';
const ACTIVE_STUDENT_STORAGE_KEY = 'notenbuch_active_student_v1';

const state = {
  students: [],
  activeStudentId: 'student-1',
  subjects: [],
  grades: [],
  logs: [],
  changelogExpanded: false,
  lanUrls: [],
  expandedSubjectIds: new Set(),
  storageMode: 'idb', // 'github' | 'server' | 'idb'
  ghConfig: null,
  modalPhotos: [],
  removedPhotoIds: [],
  selectedWeight: 1,
  newSubjectIcon: '📚',
  newSubjectIconManuallyChosen: false,
  iconPickerTargetSubjectId: null,
  newStudentIcon: '🧒',
  studentIconPickerTargetId: null
};

const blobUrlCache = new Map();

function createSampleJerseyBlob() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 400 400">
    <rect width="400" height="400" rx="40" fill="#ffffff"/>
    <path d="M90 70 L145 45 L200 45 L200 355 L110 355 L110 155 L70 175 L50 115 Z" fill="#8b1a2b"/>
    <path d="M310 70 L255 45 L200 45 L200 355 L290 355 L290 155 L330 175 L350 115 Z" fill="#f59e0b"/>
    <path d="M155 45 Q200 85 245 45" fill="none" stroke="#fbbf24" stroke-width="10"/>
    <text x="200" y="205" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="115" fill="#ffffff" stroke="#1e293b" stroke-width="4">10</text>
    <text x="200" y="255" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="26" letter-spacing="2" fill="#ffffff" stroke="#1e293b" stroke-width="1.5">MUHAMMED</text>
  </svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

// ============================================================================
// Multi-Student Data Normalization & Migration
// ============================================================================
function normalizeAppData(raw) {
  const data = raw || {};
  let students = Array.isArray(data.students) && data.students.length > 0
    ? data.students.map(st => ({
        id: st.id,
        name: st.name || 'Kind',
        icon: st.icon || '🧒'
      }))
    : [
        { id: 'student-1', name: 'Kind 1', icon: '👦' },
        { id: 'student-2', name: 'Kind 2', icon: '👧' }
      ];

  const firstStudentId = students[0].id;

  let subjects = (data.subjects || []).map(sub => ({
    ...sub,
    studentId: sub.studentId || firstStudentId,
    icon: sub.icon || guessIconForSubject(sub.name)
  }));

  // Ensure every student has at least their initial subjects if none exist yet for that student
  for (const st of students) {
    const hasSub = subjects.some(s => s.studentId === st.id);
    if (!hasSub) {
      subjects = subjects.concat(createDefaultSubjectsForStudent(st.id));
    }
  }

  // Map grades to their subject's studentId if not explicitly set
  const subjectToStudentMap = new Map(subjects.map(s => [s.id, s.studentId]));
  const subjectNameMap = new Map(subjects.map(s => [s.id, s.name]));
  const studentNameMap = new Map(students.map(s => [s.id, s.name]));

  const grades = (data.grades || []).map(g => ({
    ...g,
    studentId: g.studentId || subjectToStudentMap.get(g.subjectId) || firstStudentId
  }));

  let logs = Array.isArray(data.logs) ? data.logs : [];

  // If no logs exist yet, create baseline entries for existing grades so everything is documented
  if (logs.length === 0 && grades.length > 0) {
    logs = grades.map(g => {
      const stName = studentNameMap.get(g.studentId) || 'Kind';
      const subName = subjectNameMap.get(g.subjectId) || 'Fach';
      const subObj = subjects.find(s => s.id === g.subjectId) || { id: g.subjectId, studentId: g.studentId, name: subName, icon: '📚' };
      const photoNames = (g.photos || []).map(p => p.name || p.storedFileName || 'Foto');
      const detailsParts = [
        `${subName}: Note ${Number(g.value).toFixed(2).replace('.', ',')} (${Number(g.weight) || 1}×)`,
        `vom ${g.date || '–'}`
      ];
      if (g.note) detailsParts.push(`„${g.note}“`);
      if (photoNames.length > 0) detailsParts.push(`Fotos: ${photoNames.join(', ')}`);

      return {
        id: `log-init-${g.id}`,
        timestamp: new Date().toISOString(),
        type: 'add',
        action: 'Bestand gesichert',
        studentId: g.studentId,
        studentName: stName,
        subjectName: subName,
        gradeValue: g.value,
        weight: g.weight || 1,
        date: g.date || '',
        note: g.note || '',
        photoNames,
        details: detailsParts.join(' · '),
        snapshot: {
          kind: 'grade',
          grade: JSON.parse(JSON.stringify(g)),
          subject: JSON.parse(JSON.stringify(subObj))
        }
      };
    });
  }

  return { students, subjects, grades, logs };
}

function applyNormalizedDataToState(raw) {
  const norm = normalizeAppData(raw);
  state.students = norm.students;
  state.subjects = norm.subjects;
  state.grades = norm.grades;
  state.logs = norm.logs;

  const savedActive = localStorage.getItem(ACTIVE_STUDENT_STORAGE_KEY);
  if (savedActive && state.students.some(s => s.id === savedActive)) {
    state.activeStudentId = savedActive;
  } else if (state.students.length > 0) {
    state.activeStudentId = state.students[0].id;
  }
}

const DEVICE_ID_STORAGE_KEY = 'notenbuch_device_id_v1';
const DEVICE_NAME_STORAGE_KEY = 'notenbuch_device_name_v1';

function getOrCreateDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (!id) {
    id = `dev-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
  }
  return id;
}

function detectDefaultDeviceName() {
  const ua = navigator.userAgent || '';
  const shortTag = getOrCreateDeviceId().replace('dev-', '#');
  if (/iPhone/i.test(ua)) return `iPhone (${shortTag})`;
  if (/iPad/i.test(ua)) return `iPad (${shortTag})`;
  if (/Android/i.test(ua)) return `Smartphone (${shortTag})`;
  if (/Macintosh|Mac OS/i.test(ua)) return `Mac (${shortTag})`;
  if (/Windows/i.test(ua)) return `Windows-PC (${shortTag})`;
  return `Gerät (${shortTag})`;
}

function getDeviceName() {
  const custom = localStorage.getItem(DEVICE_NAME_STORAGE_KEY);
  if (custom && custom.trim()) return custom.trim();
  return detectDefaultDeviceName();
}

function updateDeviceLabelUi() {
  const el = document.getElementById('current-device-label');
  if (el) {
    el.textContent = getDeviceName();
  }
}

function recordAuditLog({
  type = 'add',
  action = 'Änderung',
  studentId = state.activeStudentId,
  subject = null,
  grade = null,
  prevGrade = null,
  customDetails = null,
  snapshot = null
}) {
  const student = state.students.find(s => s.id === studentId) || getActiveStudent();
  const studentName = student ? student.name : 'Kind';
  const subObj = subject || (grade ? state.subjects.find(s => s.id === grade.subjectId) : null);
  const subjectName = subObj ? subObj.name : '';

  const photoNames = grade && Array.isArray(grade.photos)
    ? grade.photos.map(p => p.name || p.storedFileName || 'Foto')
    : [];

  let details = customDetails || '';
  if (!details && grade) {
    const parts = [];
    if (subjectName) parts.push(subjectName);
    if (prevGrade) {
      parts.push(`Note ${formatGrade(prevGrade.value)} (${prevGrade.weight || 1}×) → ${formatGrade(grade.value)} (${grade.weight || 1}×)`);
    } else {
      parts.push(`Note ${formatGrade(grade.value)} (${grade.weight || 1}×)`);
    }
    if (grade.date) parts.push(`am ${formatGermanDateLong(grade.date)}`);
    if (grade.note) parts.push(`„${grade.note}“`);
    if (photoNames.length > 0) parts.push(`${photoNames.length} Foto(s): ${photoNames.join(', ')}`);
    details = parts.join(' · ');
  }

  const entry = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    deviceId: getOrCreateDeviceId(),
    deviceName: getDeviceName(),
    type,
    action,
    studentId,
    studentName,
    subjectName,
    gradeValue: grade ? grade.value : '',
    weight: grade ? (grade.weight || 1) : '',
    date: grade ? (grade.date || '') : '',
    note: grade ? (grade.note || '') : '',
    photoNames,
    details,
    snapshot: snapshot || (grade ? {
      kind: 'grade',
      grade: JSON.parse(JSON.stringify(grade)),
      prevGrade: prevGrade ? JSON.parse(JSON.stringify(prevGrade)) : null,
      subject: subObj ? JSON.parse(JSON.stringify(subObj)) : null
    } : null)
  };

  state.logs.unshift(entry);
}

function generateChangelogCsv() {
  const escapeCsv = val => {
    const str = val === null || val === undefined ? '' : String(val);
    return `"${str.replace(/"/g, '""')}"`;
  };

  const headers = [
    'Zeitpunkt',
    'Kind',
    'Geraet_Person',
    'Aktion',
    'Fach',
    'Note',
    'Gewichtung',
    'Pruefungsdatum',
    'Notiz',
    'Fotos',
    'Details',
    'Backup_Snapshot_JSON'
  ];

  const rows = [headers.join(';')];
  for (const log of state.logs) {
    rows.push([
      escapeCsv(log.timestamp),
      escapeCsv(log.studentName),
      escapeCsv(log.deviceName || 'Hauptgerät'),
      escapeCsv(log.action),
      escapeCsv(log.subjectName),
      escapeCsv(log.gradeValue !== '' && log.gradeValue !== undefined ? String(log.gradeValue).replace('.', ',') : ''),
      escapeCsv(log.weight),
      escapeCsv(log.date),
      escapeCsv(log.note),
      escapeCsv((log.photoNames || []).join(', ')),
      escapeCsv(log.details),
      escapeCsv(log.snapshot ? JSON.stringify(log.snapshot) : '')
    ].join(';'));
  }

  return '\uFEFF' + rows.join('\r\n');
}

function getActiveStudent() {
  return state.students.find(s => s.id === state.activeStudentId) || state.students[0] || null;
}

function getActiveSubjects() {
  return state.subjects.filter(s => s.studentId === state.activeStudentId);
}

// ============================================================================
// GitHub Repository Cloud-Sync Helpers
// ============================================================================
function loadGhConfig() {
  try {
    const raw = localStorage.getItem(GH_SYNC_STORAGE_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    if (cfg && cfg.repo && cfg.token) {
      if (cfg.repo.toLowerCase().endsWith('/notenbuch')) {
        cfg.repo = `${cfg.repo}-daten`;
        localStorage.setItem(GH_SYNC_STORAGE_KEY, JSON.stringify(cfg));
      }
      return cfg;
    }
  } catch (_) {}
  return null;
}

function saveGhConfig(cfg) {
  if (!cfg) {
    localStorage.removeItem(GH_SYNC_STORAGE_KEY);
    state.ghConfig = null;
  } else {
    localStorage.setItem(GH_SYNC_STORAGE_KEY, JSON.stringify(cfg));
    state.ghConfig = cfg;
  }
  updateSyncBadgeUi();
}

function detectRepoFromGithubPagesUrl() {
  const host = window.location.hostname;
  if (host.endsWith('.github.io')) {
    const owner = host.replace('.github.io', '');
    return `${owner}/notenbuch-daten`;
  }
  return 'tarikidi/notenbuch-daten';
}

function updateSyncBadgeUi() {
  const dot = document.getElementById('sync-status-dot');
  const btn = document.getElementById('btn-cloud-sync');
  if (!dot) return;

  if (state.storageMode === 'github' && state.ghConfig) {
    dot.classList.add('online');
    if (btn) btn.title = 'GitHub Cloud-Sync aktiv (Klicken für Einstellungen)';
  } else if (state.storageMode === 'server') {
    dot.classList.add('online');
    if (btn) btn.title = 'Lokaler Server aktiv (Klicken für Cloud-Sync)';
  } else {
    dot.classList.remove('online');
    if (btn) btn.title = 'Cloud-Sync einrichten';
  }
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function base64ToUtf8(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\s/g, ''))));
}

function base64ToBlob(b64, mimeType = 'image/jpeg') {
  const clean = b64.replace(/\s/g, '');
  const byteChars = atob(clean);
  const byteArrays = [];
  const sliceSize = 0x8000;
  for (let offset = 0; offset < byteChars.length; offset += sliceSize) {
    const slice = byteChars.slice(offset, offset + sliceSize);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    byteArrays.push(new Uint8Array(byteNumbers));
  }
  return new Blob(byteArrays, { type: mimeType });
}

async function ghGetBlob(sha, cfg = state.ghConfig) {
  const url = `https://api.github.com/repos/${cfg.repo}/git/blobs/${sha}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github.v3+json'
    }
  });
  if (!res.ok) throw new Error(`GitHub Blob Fehler (${res.status})`);
  return await res.json();
}

async function ghGetFile(repoPath, cfg = state.ghConfig) {
  const url = `https://api.github.com/repos/${cfg.repo}/contents/${repoPath}?ref=${encodeURIComponent(cfg.branch || 'main')}&t=${Date.now()}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github.v3+json'
    },
    cache: 'no-store'
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub API Fehler (${res.status}): ${errText}`);
  }
  return await res.json();
}

async function ghPutFile(repoPath, base64Content, message, cfg = state.ghConfig) {
  const existing = await ghGetFile(repoPath, cfg);
  const url = `https://api.github.com/repos/${cfg.repo}/contents/${repoPath}`;
  const body = {
    message,
    content: base64Content,
    branch: cfg.branch || 'main'
  };
  if (existing && existing.sha) {
    body.sha = existing.sha;
  }

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub Speichern fehlgeschlagen (${res.status}): ${errText}`);
  }
  return await res.json();
}

async function ghDeleteFile(repoPath, message, cfg = state.ghConfig) {
  const existing = await ghGetFile(repoPath, cfg);
  if (!existing || !existing.sha) return;

  const url = `https://api.github.com/repos/${cfg.repo}/contents/${repoPath}`;
  await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message,
      sha: existing.sha,
      branch: cfg.branch || 'main'
    })
  });
}

// ============================================================================
// IndexedDB Fallback Helper
// ============================================================================
const IDB_NAME = 'notenbuch_idb_v1';

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv');
      }
      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetState() {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get('app_state');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSaveState(data) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(data, 'app_state');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbSavePhoto(photoRecord) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put(photoRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetPhoto(id) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readonly');
    const req = tx.objectStore('photos').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDeletePhoto(id) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================================
// Unified Data & Photo Storage API
// ============================================================================
async function initStorage() {
  // 1. Check if GitHub Cloud Sync is configured
  const savedGh = loadGhConfig();
  if (savedGh) {
    try {
      state.ghConfig = savedGh;
      const remoteFile = await ghGetFile('data/notenbuch.json', savedGh);
      if (remoteFile && remoteFile.content) {
        const parsed = JSON.parse(base64ToUtf8(remoteFile.content));
        const hadStudents = Array.isArray(parsed.students) && parsed.students.length > 0;
        const hadLogs = Array.isArray(parsed.logs) && parsed.logs.length > 0;
        applyNormalizedDataToState(parsed);
        state.storageMode = 'github';
        updateSyncBadgeUi();
        if (!hadStudents || !hadLogs) {
          await persistState().catch(() => {});
        }
        return;
      }
    } catch (err) {
      console.warn('GitHub Sync konnte nicht geladen werden, nutze Fallback:', err);
    }
  }

  // 2. Check if local Node server API is available
  if (window.location.protocol.startsWith('http') && !window.location.hostname.endsWith('.github.io')) {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (res.ok) {
        state.storageMode = 'server';
        const data = await res.json();
        applyNormalizedDataToState(data);
        state.lanUrls = data.lanUrls || [];
        await ensureDemoPhotoIfNeeded();
        updateSyncBadgeUi();
        return;
      }
    } catch (_) {}
  }

  // 3. Fallback to IndexedDB
  state.storageMode = 'idb';
  let data = await idbGetState();

  if (!data) {
    data = {
      students: [
        { id: 'student-1', name: 'Kind 1', icon: '👦' },
        { id: 'student-2', name: 'Kind 2', icon: '👧' }
      ],
      subjects: [
        ...createDefaultSubjectsForStudent('student-1'),
        ...createDefaultSubjectsForStudent('student-2')
      ],
      grades: []
    };
    if (!window.location.hostname.endsWith('.github.io')) {
      await idbSaveState(data);
    }
  }

  applyNormalizedDataToState(data);
  updateSyncBadgeUi();
}

async function ensureDemoPhotoIfNeeded() {
  const g2 = state.grades.find(g => g.id === 'grade-2');
  if (g2 && Array.isArray(g2.photos) && g2.photos.length === 0 && !g2.demoSeeded) {
    try {
      const blob = createSampleJerseyBlob();
      const uploaded = await uploadOriginalPhotoFile(
        new File([blob], 'Kurzarbeit-Deutsch-Original.svg', { type: 'image/svg+xml' }),
        1200,
        1200
      );
      g2.photos = [uploaded];
      g2.demoSeeded = true;
      await persistState();
    } catch (_) {}
  }
}

async function persistState() {
  const payload = {
    students: state.students,
    subjects: state.subjects,
    grades: state.grades,
    logs: state.logs
  };
  await idbSaveState(payload).catch(() => {});

  if (state.storageMode === 'github' && state.ghConfig) {
    const jsonStr = JSON.stringify(payload, null, 2);
    await ghPutFile('data/notenbuch.json', utf8ToBase64(jsonStr), 'Notenbuch aktualisiert');
    const csvStr = generateChangelogCsv();
    ghPutFile('data/changelog.csv', utf8ToBase64(csvStr), 'Änderungsprotokoll CSV aktualisiert').catch(() => {});
  } else if (state.storageMode === 'server') {
    await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        csv: generateChangelogCsv()
      })
    });
  }
}

function getImageDimensions(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(dims);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: null, height: null });
    };
    img.src = url;
  });
}

async function uploadOriginalPhotoFile(file, knownWidth = null, knownHeight = null) {
  let width = knownWidth;
  let height = knownHeight;
  if (!width || !height) {
    const dims = await getImageDimensions(file);
    width = dims.width;
    height = dims.height;
  }

  if (state.storageMode === 'github' && state.ghConfig) {
    const extMatch = (file.name || '').match(/\.[a-zA-Z0-9]+$/);
    const ext = extMatch ? extMatch[0] : '.jpg';
    const photoId = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const storedFileName = `${photoId}${ext}`;
    const arrayBuf = await file.arrayBuffer();
    const b64 = arrayBufferToBase64(arrayBuf);

    const putRes = await ghPutFile(
      `data/photos/${storedFileName}`,
      b64,
      `Foto hochgeladen: ${file.name || storedFileName}`
    );

    const meta = {
      id: photoId,
      name: file.name || 'Foto.jpg',
      storedFileName,
      sha: putRes && putRes.content ? putRes.content.sha : undefined,
      mimeType: file.type || 'image/jpeg',
      size: file.size,
      width,
      height,
      uploadedAt: new Date().toISOString()
    };
    await idbSavePhoto({ ...meta, blob: file }).catch(() => {});
    return meta;
  } else if (state.storageMode === 'server') {
    const res = await fetch('/api/photos', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name || 'Foto.jpg'),
        'X-Image-Width': String(width || 0),
        'X-Image-Height': String(height || 0)
      },
      body: file
    });
    if (!res.ok) throw new Error('Foto-Upload fehlgeschlagen');
    return await res.json();
  } else {
    const id = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const meta = {
      id,
      name: file.name || 'Foto.jpg',
      mimeType: file.type || 'image/jpeg',
      size: file.size,
      width,
      height,
      uploadedAt: new Date().toISOString()
    };
    await idbSavePhoto({ ...meta, blob: file });
    return meta;
  }
}

async function deleteStoredPhoto(photoId, storedFileName = null) {
  if (state.storageMode === 'github' && state.ghConfig && storedFileName) {
    await ghDeleteFile(`data/photos/${storedFileName}`, `Foto gelöscht: ${photoId}`).catch(() => {});
  } else if (state.storageMode === 'server') {
    await fetch(`/api/photos/${encodeURIComponent(photoId)}`, { method: 'DELETE' }).catch(() => {});
  }
  await idbDeletePhoto(photoId).catch(() => {});
  if (blobUrlCache.has(photoId)) {
    URL.revokeObjectURL(blobUrlCache.get(photoId));
    blobUrlCache.delete(photoId);
  }
}

async function getPhotoUrl(photoMeta, forDownload = false) {
  if (state.storageMode === 'server') {
    return `/api/photos/${encodeURIComponent(photoMeta.id)}${forDownload ? '?download=1' : ''}`;
  }
  if (blobUrlCache.has(photoMeta.id)) {
    return blobUrlCache.get(photoMeta.id);
  }
  const record = await idbGetPhoto(photoMeta.id);
  if (record && record.blob) {
    const url = URL.createObjectURL(record.blob);
    blobUrlCache.set(photoMeta.id, url);
    return url;
  }
  if (photoMeta.storedFileName) {
    if (state.storageMode === 'github' && state.ghConfig) {
      try {
        let sha = photoMeta.sha;
        if (!sha) {
          const list = await ghGetFile('data/photos');
          if (Array.isArray(list)) {
            const match = list.find(f => f.name === photoMeta.storedFileName);
            if (match) sha = match.sha;
          }
        }
        if (sha) {
          const blobData = await ghGetBlob(sha);
          if (blobData && blobData.content) {
            const blob = base64ToBlob(blobData.content, photoMeta.mimeType || 'image/jpeg');
            await idbSavePhoto({ ...photoMeta, blob }).catch(() => {});
            const objUrl = URL.createObjectURL(blob);
            blobUrlCache.set(photoMeta.id, objUrl);
            return objUrl;
          }
        }
      } catch (e) {
        console.warn('Foto aus GitHub laden fehlgeschlagen:', e);
      }
    }
    return `data/photos/${encodeURIComponent(photoMeta.storedFileName)}`;
  }
  return '';
}

// ============================================================================
// Formatting & Calculation Helpers
// ============================================================================
function formatGrade(num) {
  if (num === null || num === undefined || Number.isNaN(num)) return '–';
  return Number(num).toFixed(2).replace('.', ',');
}

function getGradeColorClass(num) {
  if (num === null || num === undefined || Number.isNaN(num)) return 'grade-color-none';
  if (num < 2.5) return 'grade-color-good';
  if (num < 3.5) return 'grade-color-medium';
  if (num < 4.5) return 'grade-color-warn';
  return 'grade-color-bad';
}

function formatGermanDateLong(isoDate) {
  if (!isoDate) return '';
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3) return isoDate;
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  const weekdays = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];
  const months = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
  return `${weekdays[date.getDay()]}, ${date.getDate()}. ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function formatGermanDateShort(isoDate) {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}.${parts[1]}.`;
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2).replace('.', ',')} MB`;
}

function calculateSubjectAverage(subjectId) {
  const subjectGrades = state.grades.filter(g => g.subjectId === subjectId);
  if (subjectGrades.length === 0) return null;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const g of subjectGrades) {
    const w = Number(g.weight) || 1;
    weightedSum += Number(g.value) * w;
    totalWeight += w;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : null;
}

function calculateOverallAverageForStudent(studentId) {
  const stSubjects = state.subjects.filter(s => s.studentId === studentId);
  const subjectAverages = [];
  for (const sub of stSubjects) {
    const avg = calculateSubjectAverage(sub.id);
    if (avg !== null) {
      subjectAverages.push(avg);
    }
  }
  if (subjectAverages.length === 0) return null;
  const sum = subjectAverages.reduce((acc, v) => acc + v, 0);
  return sum / subjectAverages.length;
}

function calculateOverallAverageForActiveStudent() {
  return calculateOverallAverageForStudent(state.activeStudentId);
}

// ============================================================================
// Drag & Drop Reordering Helper (Mouse Drag + Touch/Pointer Drag)
// ============================================================================
async function moveSubjectOrder(draggedSubjectId, targetSubjectId, insertAfter) {
  if (!draggedSubjectId || !targetSubjectId || draggedSubjectId === targetSubjectId) return;
  const fromIdx = state.subjects.findIndex(s => s.id === draggedSubjectId);
  if (fromIdx === -1) return;

  const [moved] = state.subjects.splice(fromIdx, 1);
  let toIdx = state.subjects.findIndex(s => s.id === targetSubjectId);
  if (toIdx === -1) {
    state.subjects.push(moved);
  } else {
    if (insertAfter) toIdx += 1;
    state.subjects.splice(toIdx, 0, moved);
  }

  await persistState();
}

function attachSubjectDragHandlers(containerEl, itemSelector, onOrderChanged) {
  let draggedId = null;

  const items = Array.from(containerEl.querySelectorAll(itemSelector));
  items.forEach(item => {
    const handle = item.querySelector('.drag-handle');
    const subjectId = item.dataset.subjectId;

    if (handle) {
      handle.addEventListener('mouseenter', () => {
        item.setAttribute('draggable', 'true');
      });
      handle.addEventListener('mouseleave', () => {
        if (!draggedId) item.setAttribute('draggable', 'false');
      });

      handle.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return;
        draggedId = subjectId;
        item.classList.add('dragging');
      }, { passive: true });

      handle.addEventListener('touchmove', e => {
        if (!draggedId) return;
        e.preventDefault();
        const touch = e.touches[0];
        const elUnder = document.elementFromPoint(touch.clientX, touch.clientY);
        const overItem = elUnder ? elUnder.closest(itemSelector) : null;

        items.forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
        if (overItem && overItem.dataset.subjectId !== draggedId) {
          const rect = overItem.getBoundingClientRect();
          const isBottom = touch.clientY > rect.top + rect.height / 2;
          overItem.classList.add(isBottom ? 'drag-over-bottom' : 'drag-over-top');
        }
      }, { passive: false });

      handle.addEventListener('touchend', async e => {
        if (!draggedId) return;
        const touch = e.changedTouches[0];
        const elUnder = document.elementFromPoint(touch.clientX, touch.clientY);
        const overItem = elUnder ? elUnder.closest(itemSelector) : null;

        items.forEach(el => el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom'));

        if (overItem && overItem.dataset.subjectId !== draggedId) {
          const rect = overItem.getBoundingClientRect();
          const isBottom = touch.clientY > rect.top + rect.height / 2;
          await moveSubjectOrder(draggedId, overItem.dataset.subjectId, isBottom);
          draggedId = null;
          onOrderChanged();
          return;
        }
        draggedId = null;
      });
    }

    item.addEventListener('dragstart', e => {
      draggedId = subjectId;
      item.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', subjectId);
      }
    });

    item.addEventListener('dragend', () => {
      draggedId = null;
      item.setAttribute('draggable', 'false');
      items.forEach(el => el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom'));
    });

    item.addEventListener('dragover', e => {
      e.preventDefault();
      if (!draggedId || draggedId === subjectId) return;
      const rect = item.getBoundingClientRect();
      const isBottom = e.clientY > rect.top + rect.height / 2;
      item.classList.toggle('drag-over-top', !isBottom);
      item.classList.toggle('drag-over-bottom', isBottom);
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    item.addEventListener('drop', async e => {
      e.preventDefault();
      const fromId = draggedId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
      const rect = item.getBoundingClientRect();
      const isBottom = e.clientY > rect.top + rect.height / 2;
      items.forEach(el => el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom'));
      if (fromId && fromId !== subjectId) {
        await moveSubjectOrder(fromId, subjectId, isBottom);
        onOrderChanged();
      }
    });
  });
}

// ============================================================================
// SVG Grade Chart Renderer
// ============================================================================
function renderSubjectChartSvg(grades) {
  const chronological = [...grades].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const width = 440;
  const height = 160;
  const padLeft = 28;
  const padRight = 24;
  const padTop = 18;
  const padBottom = 26;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const yForGrade = val => {
    const clamped = Math.max(1, Math.min(6, Number(val)));
    return padTop + ((clamped - 1) / 5) * plotH;
  };

  const xForIndex = (idx, total) => {
    if (total <= 1) return padLeft + plotW / 2;
    return padLeft + (idx / (total - 1)) * plotW;
  };

  let gridLines = '';
  for (let gradeLine = 1; gradeLine <= 6; gradeLine++) {
    const y = yForGrade(gradeLine).toFixed(1);
    const isDashed = gradeLine === 4;
    gridLines += `
      <line
        x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}"
        stroke="${isDashed ? 'var(--text-muted)' : 'var(--border-subtle)'}"
        stroke-opacity="${isDashed ? '0.45' : '1'}"
        stroke-width="1"
        ${isDashed ? 'stroke-dasharray="4 4"' : ''}
      />
      <text x="${padLeft - 10}" y="${Number(y) + 4}" text-anchor="end" fill="var(--text-muted)" font-size="11" font-family="Inter, sans-serif">${gradeLine}</text>
    `;
  }

  const points = chronological.map((g, i) => ({
    x: xForIndex(i, chronological.length),
    y: yForGrade(g.value),
    grade: g
  }));

  let polyline = '';
  if (points.length > 1) {
    const ptsAttr = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    polyline = `<polyline fill="none" stroke="var(--accent-primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${ptsAttr}" />`;
  }

  let nodes = '';
  points.forEach((p, idx) => {
    const cx = p.x.toFixed(1);
    const cy = p.y.toFixed(1);
    const labelY = Math.max(12, p.y - 10).toFixed(1);
    const dateLabel = formatGermanDateShort(p.grade.date);

    const showDate =
      points.length <= 6 ||
      idx === 0 ||
      idx === points.length - 1 ||
      idx % Math.ceil(points.length / 5) === 0;

    nodes += `
      <g class="chart-node">
        <circle cx="${cx}" cy="${cy}" r="4.5" fill="var(--bg-card)" stroke="var(--accent-primary)" stroke-width="2.5" />
        <text x="${cx}" y="${labelY}" text-anchor="middle" fill="var(--text-primary)" font-size="11" font-weight="700" font-family="Inter, sans-serif">${formatGrade(p.grade.value)}</text>
        ${
          showDate
            ? `<text x="${cx}" y="${height - 4}" text-anchor="middle" fill="var(--text-secondary)" font-size="11" font-family="Inter, sans-serif">${dateLabel}</text>`
            : ''
        }
      </g>
    `;
  });

  return `
    <div class="chart-section">
      <svg class="grade-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Notenverlauf">
        ${gridLines}
        ${polyline}
        ${nodes}
      </svg>
      <p class="chart-caption">Verlauf nach Datum. Je höher der Punkt, desto besser die Note.</p>
    </div>
  `;
}

// ============================================================================
// Main UI Rendering
// ============================================================================
function renderStudentTabs() {
  const tabsContainer = document.getElementById('student-tabs');
  if (!tabsContainer) return;
  tabsContainer.innerHTML = '';

  for (const st of state.students) {
    const isActive = st.id === state.activeStudentId;
    const stSubjects = state.subjects.filter(s => s.studentId === st.id);
    const subIds = new Set(stSubjects.map(s => s.id));
    const gradeCount = state.grades.filter(g => subIds.has(g.subjectId)).length;
    const stAvg = calculateOverallAverageForStudent(st.id);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.role = 'tab';
    btn.setAttribute('aria-selected', String(isActive));
    btn.className = `student-card-tab${isActive ? ' active' : ''}`;
    btn.innerHTML = `
      <div class="student-card-left">
        <div class="student-avatar-circle">${escapeHtml(st.icon || '🧒')}</div>
        <div class="student-card-info">
          <span class="student-card-name">${escapeHtml(st.name)}</span>
          <span class="student-card-meta">${gradeCount === 1 ? '1 Note' : `${gradeCount} Noten`}</span>
        </div>
      </div>
      <span class="student-card-avg ${getGradeColorClass(stAvg)}">${formatGrade(stAvg)}</span>
    `;
    btn.addEventListener('click', () => {
      state.activeStudentId = st.id;
      localStorage.setItem(ACTIVE_STUDENT_STORAGE_KEY, st.id);
      renderApp();
    });
    tabsContainer.appendChild(btn);
  }
}

async function renderApp() {
  renderStudentTabs();

  const lanBanner = document.getElementById('lan-info-banner');
  const lanUrlText = document.getElementById('lan-url-text');
  if (state.lanUrls && state.lanUrls.length > 0) {
    lanUrlText.textContent = state.lanUrls[0];
    lanBanner.classList.remove('hidden');
  } else {
    lanBanner.classList.add('hidden');
  }

  const listEl = document.getElementById('subjects-list');
  listEl.innerHTML = '';

  const activeSubjects = getActiveSubjects();

  for (const sub of activeSubjects) {
    const subGrades = state.grades
      .filter(g => g.subjectId === sub.id)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const avg = calculateSubjectAverage(sub.id);
    const isExpanded = state.expandedSubjectIds.has(sub.id);
    const countLabel = subGrades.length === 1 ? '1 Note' : `${subGrades.length} Noten`;
    const icon = sub.icon || guessIconForSubject(sub.name);

    const card = document.createElement('section');
    card.className = `subject-card${isExpanded ? ' expanded' : ''}`;
    card.dataset.subjectId = sub.id;

    const headerRow = document.createElement('div');
    headerRow.className = 'subject-header-row';

    const dragHandle = document.createElement('span');
    dragHandle.className = 'drag-handle';
    dragHandle.title = 'Ziehen zum Sortieren';
    dragHandle.setAttribute('aria-label', 'Fach verschieben');
    dragHandle.textContent = '⋮⋮';

    const headerBtn = document.createElement('button');
    headerBtn.type = 'button';
    headerBtn.className = 'subject-header';
    headerBtn.setAttribute('aria-expanded', String(isExpanded));
    headerBtn.innerHTML = `
      <div class="subject-left">
        <div class="subject-icon-badge" aria-hidden="true">${escapeHtml(icon)}</div>
        <div class="subject-info">
          <span class="subject-name">${escapeHtml(sub.name)}</span>
          <span class="subject-count">${countLabel}</span>
        </div>
      </div>
      <div class="subject-right">
        <span class="subject-average ${getGradeColorClass(avg)}">${formatGrade(avg)}</span>
        <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
    `;

    headerBtn.addEventListener('click', () => {
      if (state.expandedSubjectIds.has(sub.id)) {
        state.expandedSubjectIds.delete(sub.id);
      } else {
        state.expandedSubjectIds.add(sub.id);
      }
      renderApp();
    });

    headerRow.appendChild(dragHandle);
    headerRow.appendChild(headerBtn);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'subject-body';

    if (subGrades.length > 0) {
      bodyEl.insertAdjacentHTML('beforeend', renderSubjectChartSvg(subGrades));

      const gradesListEl = document.createElement('div');
      gradesListEl.className = 'grades-list';

      for (const grade of subGrades) {
        const itemEl = document.createElement('div');
        itemEl.className = 'grade-item';

        const photos = Array.isArray(grade.photos) ? grade.photos : [];
        const subtitleParts = [];
        if (grade.note && grade.note.trim()) subtitleParts.push(escapeHtml(grade.note.trim()));
        if (photos.length > 0) {
          subtitleParts.push(photos.length === 1 ? '1 Foto' : `${photos.length} Fotos`);
        }
        const subtitleHtml = subtitleParts.length > 0
          ? `<div class="grade-subtitle">${subtitleParts.join(' · ')}</div>`
          : '';

        const weightBadge = Number(grade.weight) > 1
          ? `<span class="weight-pill">${Number(grade.weight)}×</span>`
          : '';

        const deviceBadge = `<span class="changelog-device-badge" title="Eingetragen / bearbeitet von">📱 ${escapeHtml(grade.deviceName || 'Hauptgerät')}</span>`;

        itemEl.innerHTML = `
          <div class="grade-item-main">
            <div class="grade-item-left">
              <div class="grade-badge ${getGradeColorClass(grade.value)}">
                ${formatGrade(grade.value)}
              </div>
              <div class="grade-meta">
                <div class="grade-date-row">
                  <span class="grade-date">${formatGermanDateLong(grade.date)}</span>
                  ${weightBadge}
                  ${deviceBadge}
                </div>
                ${subtitleHtml}
              </div>
            </div>
            <div class="grade-photos-list" data-photos-container="${grade.id}"></div>
          </div>
          <div class="grade-item-actions">
            ${
              photos.length > 0
                ? `<button type="button" class="btn btn-secondary btn-sm btn-download-photos" title="Originalfoto(s) herunterladen">Foto herunterladen</button>`
                : ''
            }
            <button type="button" class="btn btn-secondary btn-sm btn-edit-grade">Bearbeiten</button>
            <button type="button" class="btn btn-secondary btn-sm btn-delete-grade">Löschen</button>
          </div>
        `;

        const photosContainer = itemEl.querySelector(`[data-photos-container="${grade.id}"]`);
        for (const pMeta of photos) {
          const thumbWrap = document.createElement('div');
          thumbWrap.className = 'grade-photo-thumb-wrap';
          thumbWrap.title = `${pMeta.name || 'Foto'} (Klicken für Originalgröße & Download)`;
          const img = document.createElement('img');
          img.className = 'grade-photo-thumb';
          img.alt = pMeta.name || 'Schulaufgabe Foto';
          getPhotoUrl(pMeta, false).then(url => {
            if (url) img.src = url;
          });
          thumbWrap.appendChild(img);
          thumbWrap.addEventListener('click', () => openLightbox(pMeta));
          photosContainer.appendChild(thumbWrap);
        }

        const downloadBtn = itemEl.querySelector('.btn-download-photos');
        if (downloadBtn) {
          downloadBtn.addEventListener('click', async () => {
            for (const pMeta of photos) {
              await triggerOriginalDownload(pMeta);
            }
          });
        }

        itemEl.querySelector('.btn-edit-grade').addEventListener('click', () => {
          openGradeModal({ editGrade: grade });
        });

        itemEl.querySelector('.btn-delete-grade').addEventListener('click', async () => {
          if (confirm(`Möchtest du die Note ${formatGrade(grade.value)} in ${sub.name} wirklich löschen?`)) {
            recordAuditLog({
              type: 'delete',
              action: 'Note gelöscht',
              studentId: state.activeStudentId,
              subject: sub,
              grade
            });
            state.grades = state.grades.filter(g => g.id !== grade.id);
            await persistState();
            renderApp();
          }
        });

        gradesListEl.appendChild(itemEl);
      }

      bodyEl.appendChild(gradesListEl);
    } else {
      bodyEl.insertAdjacentHTML(
        'beforeend',
        `<p class="empty-subject-hint">Noch keine Noten für ${escapeHtml(sub.name)} eingetragen.</p>`
      );
    }

    const footerEl = document.createElement('div');
    footerEl.className = 'subject-footer';
    const addSubGradeBtn = document.createElement('button');
    addSubGradeBtn.type = 'button';
    addSubGradeBtn.className = 'btn btn-secondary btn-subject-add-plus';
    addSubGradeBtn.textContent = '+';
    addSubGradeBtn.title = `Note für ${sub.name} eintragen`;
    addSubGradeBtn.setAttribute('aria-label', `Note für ${sub.name} eintragen`);
    addSubGradeBtn.addEventListener('click', () => {
      openGradeModal({ preselectSubjectId: sub.id });
    });
    footerEl.appendChild(addSubGradeBtn);
    bodyEl.appendChild(footerEl);

    card.appendChild(headerRow);
    card.appendChild(bodyEl);
    listEl.appendChild(card);
  }

  attachSubjectDragHandlers(listEl, '.subject-card', () => {
    renderApp();
  });

  renderChangelogSection();
}

function formatLogTimestamp(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
  } catch (_) {
    return iso;
  }
}

function renderChangelogSection() {
  const card = document.getElementById('changelog-card');
  const toggleBtn = document.getElementById('changelog-toggle-btn');
  const countEl = document.getElementById('changelog-count');
  const listEl = document.getElementById('changelog-list');
  if (!card || !listEl) return;

  const activeStudent = getActiveStudent();
  const studentLogs = state.logs.filter(l => !l.studentId || l.studentId === state.activeStudentId);

  card.classList.toggle('expanded', state.changelogExpanded);
  if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(state.changelogExpanded));

  if (countEl) {
    const countText = studentLogs.length === 1 ? '1 Eintrag' : `${studentLogs.length} Einträge`;
    countEl.textContent = activeStudent ? `${countText} (${activeStudent.name})` : countText;
  }

  listEl.innerHTML = '';

  if (studentLogs.length === 0) {
    listEl.innerHTML = `<p class="empty-subject-hint">Noch keine protokollierten Änderungen für dieses Kind.</p>`;
    return;
  }

  for (const log of studentLogs) {
    const item = document.createElement('div');
    item.className = 'changelog-item';

    const badgeClass = log.type === 'delete' ? 'delete' : log.type === 'edit' ? 'edit' : 'add';
    const canRestoreGrade =
      log.snapshot &&
      log.snapshot.kind === 'grade' &&
      (log.type === 'delete' || log.type === 'edit');
    const canRestoreSubject =
      log.snapshot &&
      log.snapshot.kind === 'subject' &&
      log.type === 'delete';

    item.innerHTML = `
      <div class="changelog-item-top">
        <div class="changelog-badges-row">
          <span class="changelog-badge ${badgeClass}">${escapeHtml(log.action || 'Änderung')}</span>
          <span class="changelog-device-badge" title="Gerät / Person">📱 ${escapeHtml(log.deviceName || 'Hauptgerät')}</span>
        </div>
        <span class="changelog-time">${escapeHtml(formatLogTimestamp(log.timestamp))}</span>
      </div>
      <div class="changelog-details">${escapeHtml(log.details || '')}</div>
      ${
        canRestoreGrade || canRestoreSubject
          ? `<div class="changelog-item-actions">
               <button type="button" class="btn btn-secondary btn-sm btn-restore-log" title="Diesen Stand wiederherstellen">↩ Wiederherstellen</button>
             </div>`
          : ''
      }
    `;

    const restoreBtn = item.querySelector('.btn-restore-log');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', async () => {
        if (canRestoreGrade) {
          const targetGrade = log.type === 'edit' && log.snapshot.prevGrade
            ? log.snapshot.prevGrade
            : log.snapshot.grade;
          if (!targetGrade) return;

          // Ensure subject still exists for this child
          let sub = state.subjects.find(s => s.id === targetGrade.subjectId);
          if (!sub && log.snapshot.subject) {
            sub = { ...log.snapshot.subject, studentId: state.activeStudentId };
            state.subjects.push(sub);
          }

          const existingIdx = state.grades.findIndex(g => g.id === targetGrade.id);
          if (existingIdx !== -1) {
            state.grades[existingIdx] = JSON.parse(JSON.stringify(targetGrade));
          } else {
            state.grades.push(JSON.parse(JSON.stringify(targetGrade)));
          }

          recordAuditLog({
            type: 'add',
            action: 'Note wiederhergestellt',
            studentId: state.activeStudentId,
            subject: sub,
            grade: targetGrade
          });

          await persistState();
          renderApp();
        } else if (canRestoreSubject && log.snapshot.subject) {
          const subToRestore = log.snapshot.subject;
          if (!state.subjects.some(s => s.id === subToRestore.id)) {
            state.subjects.push(JSON.parse(JSON.stringify(subToRestore)));
          }
          for (const g of log.snapshot.grades || []) {
            if (!state.grades.some(existing => existing.id === g.id)) {
              state.grades.push(JSON.parse(JSON.stringify(g)));
            }
          }
          recordAuditLog({
            type: 'add',
            action: 'Fach wiederhergestellt',
            studentId: state.activeStudentId,
            customDetails: `Fach „${subToRestore.name}“ inkl. ${(log.snapshot.grades || []).length} Note(n) wiederhergestellt`
          });
          await persistState();
          renderApp();
        }
      });
    }

    listEl.appendChild(item);
  }
}

// ============================================================================
// Modal: Kinder / Schüler verwalten
// ============================================================================
function openStudentsModal() {
  state.newStudentIcon = '🧒';
  state.studentIconPickerTargetId = null;
  document.getElementById('new-student-icon-btn').textContent = state.newStudentIcon;
  document.getElementById('student-icon-picker-panel').classList.add('hidden');

  renderManageStudentsList();
  document.getElementById('students-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('new-student-input').focus(), 50);
}

async function closeStudentsModal() {
  document.getElementById('student-icon-picker-panel').classList.add('hidden');
  document.getElementById('students-modal').classList.add('hidden');
  await persistState().catch(() => {});
  renderApp();
}

function openStudentAvatarPickerFor(targetStudentId = null) {
  state.studentIconPickerTargetId = targetStudentId;
  const panel = document.getElementById('student-icon-picker-panel');
  const label = document.getElementById('student-icon-picker-label');
  const grid = document.getElementById('student-icon-picker-grid');

  let currentIcon = state.newStudentIcon;
  if (targetStudentId) {
    const st = state.students.find(s => s.id === targetStudentId);
    if (st) {
      currentIcon = st.icon || '🧒';
      label.textContent = `Avatar für "${st.name}" wählen`;
    }
  } else {
    label.textContent = 'Avatar für das neue Kind wählen';
  }

  grid.innerHTML = '';
  for (const emoji of STUDENT_AVATARS_LIST) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `icon-option-btn${emoji === currentIcon ? ' selected' : ''}`;
    btn.textContent = emoji;
    btn.addEventListener('click', async () => {
      if (state.studentIconPickerTargetId) {
        const st = state.students.find(s => s.id === state.studentIconPickerTargetId);
        if (st) {
          st.icon = emoji;
          await persistState();
          renderManageStudentsList();
          renderApp();
        }
      } else {
        state.newStudentIcon = emoji;
        document.getElementById('new-student-icon-btn').textContent = emoji;
      }
      panel.classList.add('hidden');
    });
    grid.appendChild(btn);
  }

  panel.classList.remove('hidden');
}

function renderManageStudentsList() {
  const container = document.getElementById('manage-students-list');
  container.innerHTML = '';

  for (const st of state.students) {
    const stSubjects = state.subjects.filter(s => s.studentId === st.id);
    const subIds = new Set(stSubjects.map(s => s.id));
    const gradeCount = state.grades.filter(g => subIds.has(g.subjectId)).length;

    const row = document.createElement('div');
    row.className = 'student-edit-row';
    row.innerHTML = `
      <button type="button" class="manage-subject-icon-btn" title="Avatar ändern">${escapeHtml(st.icon || '🧒')}</button>
      <input
        type="text"
        class="student-name-input"
        value="${escapeHtml(st.name)}"
        placeholder="Name des Kindes"
        aria-label="Name des Kindes"
      />
      ${
        state.students.length > 1
          ? `<button type="button" class="btn btn-danger-outline btn-sm btn-delete-student" title="Kind löschen">Löschen</button>`
          : ''
      }
    `;

    row.querySelector('.manage-subject-icon-btn').addEventListener('click', () => {
      openStudentAvatarPickerFor(st.id);
    });

    const nameInput = row.querySelector('.student-name-input');
    nameInput.addEventListener('input', () => {
      const val = nameInput.value.trim();
      if (val) {
        st.name = val;
        renderStudentTabs();
      }
    });
    nameInput.addEventListener('change', async () => {
      const val = nameInput.value.trim();
      if (val) {
        st.name = val;
        await persistState();
        renderApp();
      }
    });

    const delBtn = row.querySelector('.btn-delete-student');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        if (confirm(`Möchtest du "${st.name}" inklusive aller zugehörigen Fächer und ${gradeCount} Note(n) wirklich löschen?`)) {
          const stSubIds = new Set(state.subjects.filter(s => s.studentId === st.id).map(s => s.id));
          const stGrades = state.grades.filter(g => stSubIds.has(g.subjectId));
          for (const g of stGrades) {
            for (const p of g.photos || []) {
              await deleteStoredPhoto(p.id, p.storedFileName);
            }
          }
          state.grades = state.grades.filter(g => !stSubIds.has(g.subjectId));
          state.subjects = state.subjects.filter(s => s.studentId !== st.id);
          state.students = state.students.filter(s => s.id !== st.id);
          if (state.activeStudentId === st.id && state.students.length > 0) {
            state.activeStudentId = state.students[0].id;
            localStorage.setItem(ACTIVE_STUDENT_STORAGE_KEY, state.activeStudentId);
          }
          await persistState();
          renderManageStudentsList();
          renderApp();
        }
      });
    }

    container.appendChild(row);
  }
}

// ============================================================================
// Modal: Note eintragen / Note bearbeiten
// ============================================================================
function setWeightSelection(weight) {
  state.selectedWeight = Number(weight) || 1;
  document.querySelectorAll('.weight-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.weight) === state.selectedWeight);
  });
}

async function openGradeModal({ editGrade = null, preselectSubjectId = null } = {}) {
  const modal = document.getElementById('grade-modal');
  const titleEl = document.getElementById('grade-modal-title');
  const idInput = document.getElementById('grade-id-input');
  const subjectSelect = document.getElementById('grade-subject-select');
  const valueInput = document.getElementById('grade-value-input');
  const dateInput = document.getElementById('grade-date-input');
  const noteInput = document.getElementById('grade-note-input');
  const errorEl = document.getElementById('grade-form-error');

  errorEl.classList.add('hidden');
  errorEl.textContent = '';

  const activeStudent = getActiveStudent();
  const activeSubjects = getActiveSubjects();

  subjectSelect.innerHTML = activeSubjects
    .map(s => {
      const icon = s.icon || guessIconForSubject(s.name);
      return `<option value="${s.id}">${escapeHtml(icon)} ${escapeHtml(s.name)}</option>`;
    })
    .join('');

  state.modalPhotos = [];
  state.removedPhotoIds = [];

  if (editGrade) {
    titleEl.textContent = activeStudent ? `Note bearbeiten (${activeStudent.name})` : 'Note bearbeiten';
    idInput.value = editGrade.id;
    subjectSelect.value = editGrade.subjectId;
    valueInput.value = String(editGrade.value).replace('.', ',');
    dateInput.value = editGrade.date || new Date().toISOString().slice(0, 10);
    noteInput.value = editGrade.note || '';
    setWeightSelection(editGrade.weight || 1);

    for (const p of editGrade.photos || []) {
      const previewUrl = await getPhotoUrl(p, false);
      state.modalPhotos.push({
        ...p,
        previewUrl,
        isExisting: true
      });
    }
  } else {
    titleEl.textContent = activeStudent ? `Note eintragen (${activeStudent.name})` : 'Note eintragen';
    idInput.value = '';
    if (preselectSubjectId) {
      subjectSelect.value = preselectSubjectId;
    }
    valueInput.value = '';
    dateInput.value = new Date().toISOString().slice(0, 10);
    noteInput.value = '';
    setWeightSelection(1);
  }

  renderModalPhotoGrid();
  modal.classList.remove('hidden');
  setTimeout(() => valueInput.focus(), 50);
}

function closeGradeModal() {
  for (const p of state.modalPhotos) {
    if (!p.isExisting && p.previewUrl) {
      URL.revokeObjectURL(p.previewUrl);
    }
  }
  state.modalPhotos = [];
  state.removedPhotoIds = [];
  document.getElementById('grade-modal').classList.add('hidden');
}

function renderModalPhotoGrid() {
  const grid = document.getElementById('modal-photo-grid');
  const addTile = grid.querySelector('.photo-add-tile');

  grid.querySelectorAll('.modal-photo-item').forEach(el => el.remove());

  for (let i = 0; i < state.modalPhotos.length; i++) {
    const p = state.modalPhotos[i];
    const item = document.createElement('div');
    item.className = 'modal-photo-item';
    item.innerHTML = `
      <img src="${p.previewUrl}" alt="${escapeHtml(p.name || 'Foto')}" title="Klicken für Vorschau in Originalgröße" />
      <button type="button" class="modal-photo-remove" aria-label="Foto entfernen" title="Foto entfernen">×</button>
    `;

    item.querySelector('img').addEventListener('click', () => {
      openLightbox(p);
    });

    item.querySelector('.modal-photo-remove').addEventListener('click', () => {
      const removed = state.modalPhotos.splice(i, 1)[0];
      if (removed.isExisting) {
        state.removedPhotoIds.push({ id: removed.id, storedFileName: removed.storedFileName });
      } else if (removed.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      renderModalPhotoGrid();
    });

    grid.insertBefore(item, addTile);
  }
}

// ============================================================================
// Modal: Fächer verwalten (pro Kind, mit Icons & Drag-and-Drop Sortierung)
// ============================================================================
function openSubjectsModal() {
  const activeStudent = getActiveStudent();
  document.getElementById('subjects-modal-title').textContent = activeStudent
    ? `Fächer verwalten (${activeStudent.name})`
    : 'Fächer verwalten';

  state.newSubjectIcon = '📚';
  state.newSubjectIconManuallyChosen = false;
  state.iconPickerTargetSubjectId = null;
  document.getElementById('new-subject-icon-btn').textContent = state.newSubjectIcon;
  document.getElementById('icon-picker-panel').classList.add('hidden');

  renderManageSubjectsList();
  document.getElementById('subjects-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('new-subject-input').focus(), 50);
}

function closeSubjectsModal() {
  document.getElementById('icon-picker-panel').classList.add('hidden');
  document.getElementById('subjects-modal').classList.add('hidden');
}

function openIconPickerFor(targetSubjectId = null) {
  state.iconPickerTargetSubjectId = targetSubjectId;
  const panel = document.getElementById('icon-picker-panel');
  const label = document.getElementById('icon-picker-label');
  const grid = document.getElementById('icon-picker-grid');

  let currentIcon = state.newSubjectIcon;
  if (targetSubjectId) {
    const sub = state.subjects.find(s => s.id === targetSubjectId);
    if (sub) {
      currentIcon = sub.icon || guessIconForSubject(sub.name);
      label.textContent = `Icon für "${sub.name}" wählen`;
    }
  } else {
    label.textContent = 'Icon für das neue Fach wählen';
  }

  grid.innerHTML = '';
  for (const emoji of SUBJECT_ICONS_LIST) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `icon-option-btn${emoji === currentIcon ? ' selected' : ''}`;
    btn.textContent = emoji;
    btn.addEventListener('click', async () => {
      if (state.iconPickerTargetSubjectId) {
        const sub = state.subjects.find(s => s.id === state.iconPickerTargetSubjectId);
        if (sub) {
          sub.icon = emoji;
          await persistState();
          renderManageSubjectsList();
          renderApp();
        }
      } else {
        state.newSubjectIcon = emoji;
        state.newSubjectIconManuallyChosen = true;
        document.getElementById('new-subject-icon-btn').textContent = emoji;
      }
      panel.classList.add('hidden');
    });
    grid.appendChild(btn);
  }

  panel.classList.remove('hidden');
}

function renderManageSubjectsList() {
  const container = document.getElementById('manage-subjects-list');
  container.innerHTML = '';

  const activeSubjects = getActiveSubjects();

  for (const sub of activeSubjects) {
    const gradeCount = state.grades.filter(g => g.subjectId === sub.id).length;
    const icon = sub.icon || guessIconForSubject(sub.name);

    const row = document.createElement('div');
    row.className = 'manage-subject-item';
    row.dataset.subjectId = sub.id;
    row.innerHTML = `
      <div class="manage-subject-left">
        <span class="drag-handle" title="Ziehen zum Sortieren">⋮⋮</span>
        <button type="button" class="manage-subject-icon-btn" title="Icon ändern">${escapeHtml(icon)}</button>
        <div>
          <div class="manage-subject-name">${escapeHtml(sub.name)}</div>
          <div class="subject-count">${gradeCount === 1 ? '1 Note' : `${gradeCount} Noten`}</div>
        </div>
      </div>
      <div class="manage-subject-actions">
        <button type="button" class="btn btn-secondary btn-sm btn-rename-sub">Umbenennen</button>
        <button type="button" class="btn btn-danger-outline btn-sm btn-delete-sub">Löschen</button>
      </div>
    `;

    row.querySelector('.manage-subject-icon-btn').addEventListener('click', () => {
      openIconPickerFor(sub.id);
    });

    row.querySelector('.btn-rename-sub').addEventListener('click', async () => {
      const oldName = sub.name;
      const newName = prompt('Neuer Name für das Fach:', sub.name);
      if (newName && newName.trim() && newName.trim() !== oldName) {
        sub.name = newName.trim();
        recordAuditLog({
          type: 'edit',
          action: 'Fach umbenannt',
          studentId: state.activeStudentId,
          subject: sub,
          customDetails: `Fach umbenannt: „${oldName}“ → „${sub.name}“`
        });
        await persistState();
        renderManageSubjectsList();
        renderApp();
      }
    });

    row.querySelector('.btn-delete-sub').addEventListener('click', async () => {
      const msg = gradeCount > 0
        ? `Das Fach "${sub.name}" enthält ${gradeCount} Note(n). Beim Löschen werden auch diese Noten entfernt. Fortfahren?`
        : `Fach "${sub.name}" wirklich löschen?`;
      if (confirm(msg)) {
        const subGrades = state.grades.filter(g => g.subjectId === sub.id);
        recordAuditLog({
          type: 'delete',
          action: 'Fach gelöscht',
          studentId: state.activeStudentId,
          subject: sub,
          customDetails: `Fach „${sub.name}“ (${gradeCount} Note(n)) gelöscht`,
          snapshot: {
            kind: 'subject',
            subject: JSON.parse(JSON.stringify(sub)),
            grades: JSON.parse(JSON.stringify(subGrades))
          }
        });
        state.grades = state.grades.filter(g => g.subjectId !== sub.id);
        state.subjects = state.subjects.filter(s => s.id !== sub.id);
        state.expandedSubjectIds.delete(sub.id);
        await persistState();
        renderManageSubjectsList();
        renderApp();
      }
    });

    container.appendChild(row);
  }

  attachSubjectDragHandlers(container, '.manage-subject-item', () => {
    renderManageSubjectsList();
    renderApp();
  });
}

// ============================================================================
// Modal: GitHub Cloud-Sync
// ============================================================================
function openSyncModal() {
  const modal = document.getElementById('sync-modal');
  const repoInput = document.getElementById('gh-repo-input');
  const branchInput = document.getElementById('gh-branch-input');
  const tokenInput = document.getElementById('gh-token-input');
  const statusEl = document.getElementById('sync-form-status');
  const disconnectBtn = document.getElementById('btn-disconnect-sync');

  statusEl.classList.add('hidden');
  const cfg = loadGhConfig();

  if (cfg) {
    repoInput.value = cfg.repo || '';
    branchInput.value = cfg.branch || 'main';
    tokenInput.value = cfg.token || '';
    disconnectBtn.classList.remove('hidden');
  } else {
    repoInput.value = detectRepoFromGithubPagesUrl();
    branchInput.value = 'main';
    tokenInput.value = '';
    disconnectBtn.classList.add('hidden');
  }

  modal.classList.remove('hidden');
}

function closeSyncModal() {
  document.getElementById('sync-modal').classList.add('hidden');
}

// ============================================================================
// Lightbox & Original Size Download
// ============================================================================
async function openLightbox(photoMeta) {
  const modal = document.getElementById('lightbox-modal');
  const img = document.getElementById('lightbox-img');
  const filenameEl = document.getElementById('lightbox-filename');
  const detailsEl = document.getElementById('lightbox-details');
  const downloadBtn = document.getElementById('lightbox-download-btn');

  const viewUrl = photoMeta.previewUrl || (await getPhotoUrl(photoMeta, false));
  const downloadUrl = photoMeta.file
    ? photoMeta.previewUrl
    : await getPhotoUrl(photoMeta, true);

  img.src = viewUrl;
  filenameEl.textContent = photoMeta.name || 'Schulaufgabe-Foto';

  const infoParts = ['Originalgröße'];
  if (photoMeta.width && photoMeta.height) {
    infoParts.push(`${photoMeta.width} × ${photoMeta.height} px`);
  }
  if (photoMeta.size) {
    infoParts.push(formatFileSize(photoMeta.size));
  }
  detailsEl.textContent = infoParts.join(' · ');

  downloadBtn.href = downloadUrl;
  downloadBtn.download = photoMeta.name || 'Schulaufgabe-Original.jpg';

  modal.classList.remove('hidden');
}

async function triggerOriginalDownload(photoMeta) {
  const url = await getPhotoUrl(photoMeta, true);
  const a = document.createElement('a');
  a.href = url;
  a.download = photoMeta.name || 'Schulaufgabe-Original.jpg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function closeLightbox() {
  const modal = document.getElementById('lightbox-modal');
  const img = document.getElementById('lightbox-img');
  img.src = '';
  modal.classList.add('hidden');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================================
// Event Listeners & Initialization
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize default structure immediately so UI & buttons work before async storage finishes
  applyNormalizedDataToState({
    students: [
      { id: 'student-1', name: 'Kind 1', icon: '👦' },
      { id: 'student-2', name: 'Kind 2', icon: '👧' }
    ],
    subjects: [],
    grades: []
  });
  renderStudentTabs();

  const THEME_STORAGE_KEY = 'notenbuch_theme_v1';
  const themeBtn = document.getElementById('btn-theme-toggle');

  function applyTheme(theme) {
    const isLight = theme === 'light';
    if (isLight) {
      document.documentElement.setAttribute('data-theme', 'light');
      if (themeBtn) {
        themeBtn.textContent = '🌙';
        themeBtn.title = 'Zu Dunkelmodus wechseln';
      }
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (themeBtn) {
        themeBtn.textContent = '☀️';
        themeBtn.title = 'Zu Hellmodus wechseln';
      }
    }
  }

  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'dark';
  applyTheme(savedTheme);

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const next = current === 'light' ? 'dark' : 'light';
      localStorage.setItem(THEME_STORAGE_KEY, next);
      applyTheme(next);
    });
  }

  document.getElementById('btn-manage-students').addEventListener('click', () => {
    openStudentsModal();
  });

  document.getElementById('btn-close-students').addEventListener('click', closeStudentsModal);

  document.getElementById('new-student-icon-btn').addEventListener('click', () => {
    openStudentAvatarPickerFor(null);
  });

  document.getElementById('btn-close-student-icon-picker').addEventListener('click', () => {
    document.getElementById('student-icon-picker-panel').classList.add('hidden');
  });

  document.getElementById('add-student-form').addEventListener('submit', async e => {
    e.preventDefault();
    const input = document.getElementById('new-student-input');
    const name = input.value.trim();
    if (!name) return;

    const studentId = `student-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const newStudent = {
      id: studentId,
      name,
      icon: state.newStudentIcon || '🧒'
    };
    state.students.push(newStudent);
    state.subjects.push(...createDefaultSubjectsForStudent(studentId));
    state.activeStudentId = studentId;
    localStorage.setItem(ACTIVE_STUDENT_STORAGE_KEY, studentId);

    input.value = '';
    state.newStudentIcon = '🧒';
    document.getElementById('new-student-icon-btn').textContent = '🧒';
    document.getElementById('student-icon-picker-panel').classList.add('hidden');

    await persistState();
    renderManageStudentsList();
    renderApp();
  });

  document.getElementById('btn-add-grade').addEventListener('click', () => {
    if (getActiveSubjects().length === 0) {
      openSubjectsModal();
      return;
    }
    openGradeModal();
  });

  document.getElementById('btn-manage-subjects').addEventListener('click', () => {
    openSubjectsModal();
  });

  document.getElementById('btn-cloud-sync').addEventListener('click', () => {
    openSyncModal();
  });

  document.getElementById('btn-close-sync').addEventListener('click', closeSyncModal);

  document.getElementById('btn-disconnect-sync').addEventListener('click', async () => {
    saveGhConfig(null);
    await initStorage();
    await renderApp();
    closeSyncModal();
  });

  document.getElementById('sync-form').addEventListener('submit', async e => {
    e.preventDefault();
    let repo = document.getElementById('gh-repo-input').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
    if (repo.toLowerCase().endsWith('/notenbuch')) {
      repo = `${repo}-daten`;
      document.getElementById('gh-repo-input').value = repo;
    }
    const branch = document.getElementById('gh-branch-input').value.trim() || 'main';
    const token = document.getElementById('gh-token-input').value.trim();
    const statusEl = document.getElementById('sync-form-status');
    const saveBtn = document.getElementById('btn-save-sync');

    if (!repo.includes('/') || !token) {
      statusEl.textContent = 'Bitte gib dein Repository (z. B. tarikidi/notenbuch-daten) und deinen Token ein.';
      statusEl.classList.remove('hidden');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Verbinde...';
    statusEl.classList.add('hidden');

    try {
      const cfg = { repo, branch, token };
      const existing = await ghGetFile('data/notenbuch.json', cfg);
      const parsedRemote = existing && existing.content
        ? JSON.parse(base64ToUtf8(existing.content))
        : null;

      let localServerData = null;
      if (!window.location.hostname.endsWith('.github.io')) {
        try {
          const locRes = await fetch('/api/state', { cache: 'no-store' });
          if (locRes.ok) localServerData = await locRes.json();
        } catch (_) {}
      }

      const remoteGradesCount = parsedRemote && Array.isArray(parsedRemote.grades) ? parsedRemote.grades.length : 0;
      const localGradesCount = localServerData && Array.isArray(localServerData.grades)
        ? localServerData.grades.length
        : state.grades.length;

      saveGhConfig(cfg);
      state.storageMode = 'github';

      if (remoteGradesCount > 0 && localGradesCount === 0) {
        applyNormalizedDataToState(parsedRemote);
      } else if (localGradesCount > 0 && remoteGradesCount === 0) {
        if (localServerData) {
          applyNormalizedDataToState(localServerData);
        }
        saveBtn.textContent = 'Lade lokale Fotos hoch...';
        for (const grade of state.grades) {
          for (const pMeta of grade.photos || []) {
            try {
              let blob = null;
              const r = await fetch(`/api/photos/${encodeURIComponent(pMeta.id)}`).catch(() => null);
              if (r && r.ok) {
                blob = await r.blob();
              } else {
                const rec = await idbGetPhoto(pMeta.id);
                if (rec && rec.blob) blob = rec.blob;
              }
              if (blob) {
                const extMatch = (pMeta.name || '').match(/\.[a-zA-Z0-9]+$/);
                const ext = extMatch ? extMatch[0] : '.jpg';
                const storedFileName = pMeta.storedFileName || `${pMeta.id}${ext}`;
                pMeta.storedFileName = storedFileName;
                const b64 = arrayBufferToBase64(await blob.arrayBuffer());
                const putRes = await ghPutFile(
                  `data/photos/${storedFileName}`,
                  b64,
                  `Foto synchronisiert: ${pMeta.name || storedFileName}`,
                  cfg
                );
                if (putRes && putRes.content && putRes.content.sha) {
                  pMeta.sha = putRes.content.sha;
                }
              }
            } catch (e) {
              console.warn('Foto-Sync Fehler:', e);
            }
          }
        }
        saveBtn.textContent = 'Speichere Noten...';
        await persistState();
      } else if (parsedRemote) {
        applyNormalizedDataToState(parsedRemote);
      } else {
        await persistState();
      }

      updateSyncBadgeUi();
      await renderApp();
      closeSyncModal();
    } catch (err) {
      statusEl.textContent = `Verbindung fehlgeschlagen: ${err.message}`;
      statusEl.classList.remove('hidden');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Verbinden & Synchronisieren';
    }
  });

  document.querySelectorAll('.weight-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setWeightSelection(Number(btn.dataset.weight));
    });
  });

  const photoInput = document.getElementById('grade-photo-input');
  photoInput.addEventListener('change', async e => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      const dims = await getImageDimensions(file);
      const previewUrl = URL.createObjectURL(file);
      state.modalPhotos.push({
        id: `temp-${Date.now()}-${Math.random()}`,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        width: dims.width,
        height: dims.height,
        file,
        previewUrl,
        isExisting: false
      });
    }
    photoInput.value = '';
    renderModalPhotoGrid();
  });

  document.getElementById('grade-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errorEl = document.getElementById('grade-form-error');
    const subjectId = document.getElementById('grade-subject-select').value;
    const rawGrade = document.getElementById('grade-value-input').value.trim().replace(',', '.');
    const gradeVal = parseFloat(rawGrade);
    const dateVal = document.getElementById('grade-date-input').value;
    const noteVal = document.getElementById('grade-note-input').value.trim();
    const editId = document.getElementById('grade-id-input').value;

    if (!subjectId) {
      errorEl.textContent = 'Bitte wähle ein Fach aus.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (Number.isNaN(gradeVal) || gradeVal < 1 || gradeVal > 6) {
      errorEl.textContent = 'Bitte gib eine gültige Note zwischen 1 und 6 ein (z. B. 2 oder 2,5).';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!dateVal) {
      errorEl.textContent = 'Bitte gib das Datum der Prüfung an.';
      errorEl.classList.remove('hidden');
      return;
    }

    const saveBtn = document.getElementById('btn-save-grade');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Speichert...';

    try {
      for (const rem of state.removedPhotoIds) {
        const remId = typeof rem === 'string' ? rem : rem.id;
        const remFile = typeof rem === 'object' ? rem.storedFileName : null;
        await deleteStoredPhoto(remId, remFile);
      }

      const finalPhotos = [];
      for (const item of state.modalPhotos) {
        if (item.isExisting) {
          finalPhotos.push({
            id: item.id,
            name: item.name,
            storedFileName: item.storedFileName,
            sha: item.sha,
            size: item.size,
            mimeType: item.mimeType,
            width: item.width,
            height: item.height
          });
        } else if (item.file) {
          const uploadedMeta = await uploadOriginalPhotoFile(item.file, item.width, item.height);
          finalPhotos.push(uploadedMeta);
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        }
      }

      if (editId) {
        const idx = state.grades.findIndex(g => g.id === editId);
        if (idx !== -1) {
          const prevCopy = JSON.parse(JSON.stringify(state.grades[idx]));
          const updatedGrade = {
            ...state.grades[idx],
            studentId: state.activeStudentId,
            subjectId,
            value: gradeVal,
            weight: state.selectedWeight,
            date: dateVal,
            note: noteVal,
            photos: finalPhotos,
            deviceId: getOrCreateDeviceId(),
            deviceName: getDeviceName()
          };
          state.grades[idx] = updatedGrade;
          recordAuditLog({
            type: 'edit',
            action: 'Note bearbeitet',
            studentId: state.activeStudentId,
            grade: updatedGrade,
            prevGrade: prevCopy
          });
        }
      } else {
        const newGrade = {
          id: `grade-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          studentId: state.activeStudentId,
          subjectId,
          value: gradeVal,
          weight: state.selectedWeight,
          date: dateVal,
          note: noteVal,
          photos: finalPhotos,
          deviceId: getOrCreateDeviceId(),
          deviceName: getDeviceName()
        };
        state.grades.push(newGrade);
        recordAuditLog({
          type: 'add',
          action: 'Note hinzugefügt',
          studentId: state.activeStudentId,
          grade: newGrade
        });
      }

      state.expandedSubjectIds.add(subjectId);
      state.modalPhotos = [];
      state.removedPhotoIds = [];

      await persistState();
      closeGradeModal();
      await renderApp();
    } catch (err) {
      errorEl.textContent = `Fehler beim Speichern: ${err.message}`;
      errorEl.classList.remove('hidden');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Speichern';
    }
  });

  document.getElementById('btn-cancel-grade').addEventListener('click', closeGradeModal);

  const newSubjectInput = document.getElementById('new-subject-input');
  newSubjectInput.addEventListener('input', () => {
    if (!state.newSubjectIconManuallyChosen) {
      state.newSubjectIcon = guessIconForSubject(newSubjectInput.value);
      document.getElementById('new-subject-icon-btn').textContent = state.newSubjectIcon;
    }
  });

  document.getElementById('new-subject-icon-btn').addEventListener('click', () => {
    openIconPickerFor(null);
  });

  document.getElementById('btn-close-icon-picker').addEventListener('click', () => {
    document.getElementById('icon-picker-panel').classList.add('hidden');
  });

  document.getElementById('add-subject-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = newSubjectInput.value.trim();
    if (!name) return;

    const activeSubjects = getActiveSubjects();
    if (activeSubjects.some(s => s.name.toLowerCase() === name.toLowerCase())) {
      alert('Dieses Fach existiert für dieses Kind bereits.');
      return;
    }

    const icon = state.newSubjectIconManuallyChosen
      ? state.newSubjectIcon
      : guessIconForSubject(name);

    const newSub = {
      id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      studentId: state.activeStudentId,
      name,
      icon
    };
    state.subjects.push(newSub);
    recordAuditLog({
      type: 'add',
      action: 'Fach hinzugefügt',
      studentId: state.activeStudentId,
      subject: newSub,
      customDetails: `Fach „${newSub.icon} ${newSub.name}“ angelegt`
    });
    newSubjectInput.value = '';
    state.newSubjectIcon = '📚';
    state.newSubjectIconManuallyChosen = false;
    document.getElementById('new-subject-icon-btn').textContent = '📚';
    document.getElementById('icon-picker-panel').classList.add('hidden');

    await persistState();
    renderManageSubjectsList();
    renderApp();
  });

  updateDeviceLabelUi();
  const setDeviceBtn = document.getElementById('btn-set-device-name');
  if (setDeviceBtn) {
    setDeviceBtn.addEventListener('click', async () => {
      const current = getDeviceName();
      const input = prompt(
        'Wie soll dieses Gerät im Änderungsprotokoll heißen?\n(z. B. „Papa (Handy)“, „Mama (Handy)“ oder „PC“)',
        current
      );
      if (input !== null && input.trim()) {
        const newName = input.trim();
        localStorage.setItem(DEVICE_NAME_STORAGE_KEY, newName);
        updateDeviceLabelUi();

        const myDeviceId = getOrCreateDeviceId();
        let updatedAny = false;
        for (const log of state.logs) {
          if (log.deviceId === myDeviceId) {
            log.deviceName = newName;
            updatedAny = true;
          }
        }
        for (const grade of state.grades) {
          if (grade.deviceId === myDeviceId) {
            grade.deviceName = newName;
            updatedAny = true;
          }
        }
        if (updatedAny) {
          await persistState().catch(() => {});
        }
        renderApp();
      }
    });
  }

  const changelogToggleBtn = document.getElementById('changelog-toggle-btn');
  if (changelogToggleBtn) {
    changelogToggleBtn.addEventListener('click', () => {
      state.changelogExpanded = !state.changelogExpanded;
      renderChangelogSection();
    });
  }

  const exportCsvBtn = document.getElementById('btn-export-csv');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      const csv = generateChangelogCsv();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Notenbuch-Protokoll-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  const exportJsonBtn = document.getElementById('btn-export-json');
  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', () => {
      const jsonStr = JSON.stringify({
        exportedAt: new Date().toISOString(),
        students: state.students,
        subjects: state.subjects,
        grades: state.grades,
        logs: state.logs
      }, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Notenbuch-Backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  document.getElementById('btn-close-subjects').addEventListener('click', closeSubjectsModal);
  document.getElementById('btn-close-lightbox').addEventListener('click', closeLightbox);

  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) {
        if (backdrop.id === 'grade-modal') closeGradeModal();
        if (backdrop.id === 'subjects-modal') closeSubjectsModal();
        if (backdrop.id === 'students-modal') closeStudentsModal();
        if (backdrop.id === 'sync-modal') closeSyncModal();
        if (backdrop.id === 'lightbox-modal') closeLightbox();
      }
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeLightbox();
      closeGradeModal();
      closeSubjectsModal();
      closeStudentsModal();
      closeSyncModal();
    }
  });

  await initStorage();
  await renderApp();
});
