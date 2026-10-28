// ============================================================================
// Notenbuch App – State, Storage (GitHub Cloud Sync + Server API + IndexedDB)
// ============================================================================

const SUBJECT_ICONS_LIST = [
  '📖', '📐', '🇬🇧', '🌍', '🎵', '🧬', '⚡', '🧪',
  '🎨', '⚽', '🏛️', '💻', '🇫🇷', '🇪🇸', '🏺', '🕊️',
  '⚖️', '📊', '🌱', '🔬', '🧮', '🎭', '🛠️', '📚',
  '✏️', '📝', '🧠', '🔭', '🎻', '🏀', '🏊', '🎓'
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

const GH_SYNC_STORAGE_KEY = 'notenbuch_gh_sync_config_v1';

const state = {
  subjects: [],
  grades: [],
  lanUrls: [],
  expandedSubjectIds: new Set(['sub-deutsch']),
  storageMode: 'idb', // 'github' | 'server' | 'idb'
  ghConfig: null, // { repo: 'owner/repo', branch: 'main', token: '...' }
  modalPhotos: [],
  removedPhotoIds: [],
  selectedWeight: 1,
  newSubjectIcon: '📚',
  newSubjectIconManuallyChosen: false,
  iconPickerTargetSubjectId: null
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
// GitHub Repository Cloud-Sync Helpers (for GitHub Pages 24/7 Sync)
// ============================================================================
function loadGhConfig() {
  try {
    const raw = localStorage.getItem(GH_SYNC_STORAGE_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    if (cfg && cfg.repo && cfg.token) return cfg;
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
  // Suggests "<owner>/notenbuch-daten" as the private data repository
  const host = window.location.hostname;
  if (host.endsWith('.github.io')) {
    const owner = host.replace('.github.io', '');
    return `${owner}/notenbuch-daten`;
  }
  return '';
}

function updateSyncBadgeUi() {
  const dot = document.getElementById('sync-status-dot');
  const label = document.getElementById('sync-status-label');
  if (!dot || !label) return;

  if (state.storageMode === 'github' && state.ghConfig) {
    dot.classList.add('online');
    label.textContent = 'GitHub Sync aktiv';
  } else if (state.storageMode === 'server') {
    dot.classList.add('online');
    label.textContent = 'Lokaler Server';
  } else {
    dot.classList.remove('online');
    label.textContent = 'Cloud-Sync';
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
function normalizeSubjects(subjects) {
  return (subjects || []).map(sub => ({
    ...sub,
    icon: sub.icon || guessIconForSubject(sub.name)
  }));
}

async function initStorage() {
  // 1. Check if GitHub Cloud Sync is configured
  const savedGh = loadGhConfig();
  if (savedGh) {
    try {
      state.ghConfig = savedGh;
      const remoteFile = await ghGetFile('data/notenbuch.json', savedGh);
      if (remoteFile && remoteFile.content) {
        const parsed = JSON.parse(base64ToUtf8(remoteFile.content));
        state.subjects = normalizeSubjects(parsed.subjects);
        state.grades = parsed.grades || [];
        state.storageMode = 'github';
        updateSyncBadgeUi();
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
        state.subjects = normalizeSubjects(data.subjects);
        state.grades = data.grades || [];
        state.lanUrls = data.lanUrls || [];
        await ensureDemoPhotoIfNeeded();
        updateSyncBadgeUi();
        return;
      }
    } catch (_) {
      // Fallback to IndexedDB
    }
  }

  // 3. Fallback to IndexedDB
  state.storageMode = 'idb';
  let data = await idbGetState();

  if (!data) {
    // On public GitHub Pages without token: show only empty subjects (0 grades, 0 photos)
    if (window.location.hostname.endsWith('.github.io')) {
      data = {
        subjects: [
          { id: 'sub-deutsch', name: 'Deutsch', icon: '📖' },
          { id: 'sub-englisch', name: 'Englisch', icon: '🇬🇧' },
          { id: 'sub-geographie', name: 'Geographie', icon: '🌍' },
          { id: 'sub-mathematik', name: 'Mathematik', icon: '📐' },
          { id: 'sub-musik', name: 'Musik', icon: '🎵' }
        ],
        grades: []
      };
    } else {
      const sampleBlob = createSampleJerseyBlob();
      const demoPhotoId = 'photo-demo-jersey';
      await idbSavePhoto({
        id: demoPhotoId,
        name: 'Kurzarbeit-Deutsch-Original.svg',
        mimeType: 'image/svg+xml',
        size: sampleBlob.size,
        width: 1200,
        height: 1200,
        blob: sampleBlob
      });

      data = {
        subjects: [
          { id: 'sub-deutsch', name: 'Deutsch', icon: '📖' },
          { id: 'sub-englisch', name: 'Englisch', icon: '🇬🇧' },
          { id: 'sub-geographie', name: 'Geographie', icon: '🌍' },
          { id: 'sub-mathematik', name: 'Mathematik', icon: '📐' },
          { id: 'sub-musik', name: 'Musik', icon: '🎵' }
        ],
        grades: [
          {
            id: 'grade-1',
            subjectId: 'sub-deutsch',
            value: 2.0,
            weight: 2,
            date: '2026-10-28',
            note: 'Probe',
            photos: []
          },
          {
            id: 'grade-2',
            subjectId: 'sub-deutsch',
            value: 4.0,
            weight: 1,
            date: '2026-10-14',
            note: 'Kurzarbeit',
            photos: [
              {
                id: demoPhotoId,
                name: 'Kurzarbeit-Deutsch-Original.svg',
                mimeType: 'image/svg+xml',
                size: sampleBlob.size,
                width: 1200,
                height: 1200
              }
            ]
          },
          {
            id: 'grade-3',
            subjectId: 'sub-mathematik',
            value: 1.0,
            weight: 1,
            date: '2026-10-20',
            note: 'Schulaufgabe',
            photos: []
          }
        ]
      };
      await idbSaveState(data);
    }
  }
  state.subjects = normalizeSubjects(data.subjects);
  state.grades = data.grades || [];
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
    subjects: state.subjects,
    grades: state.grades
  };
  // Always keep local IndexedDB copy up to date
  await idbSaveState(payload).catch(() => {});

  if (state.storageMode === 'github' && state.ghConfig) {
    const jsonStr = JSON.stringify(payload, null, 2);
    await ghPutFile('data/notenbuch.json', utf8ToBase64(jsonStr), 'Notenbuch aktualisiert');
  } else if (state.storageMode === 'server') {
    await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
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

    await ghPutFile(
      `data/photos/${storedFileName}`,
      b64,
      `Foto hochgeladen: ${file.name || storedFileName}`
    );

    const meta = {
      id: photoId,
      name: file.name || 'Foto.jpg',
      storedFileName,
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
  // If stored in GitHub repo (data/photos/<storedFileName>)
  if (photoMeta.storedFileName) {
    if (state.storageMode === 'github' && state.ghConfig) {
      try {
        const fileData = await ghGetFile(`data/photos/${photoMeta.storedFileName}`);
        if (fileData && fileData.download_url) {
          const rawRes = await fetch(fileData.download_url);
          if (rawRes.ok) {
            const blob = await rawRes.blob();
            const objUrl = URL.createObjectURL(blob);
            blobUrlCache.set(photoMeta.id, objUrl);
            return objUrl;
          }
        }
      } catch (_) {}
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

function calculateOverallAverage() {
  const subjectAverages = [];
  for (const sub of state.subjects) {
    const avg = calculateSubjectAverage(sub.id);
    if (avg !== null) {
      subjectAverages.push(avg);
    }
  }
  if (subjectAverages.length === 0) return null;
  const sum = subjectAverages.reduce((acc, v) => acc + v, 0);
  return sum / subjectAverages.length;
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
        stroke="${isDashed ? '#2b3553' : '#1b2236'}"
        stroke-width="1"
        ${isDashed ? 'stroke-dasharray="4 4"' : ''}
      />
      <text x="${padLeft - 10}" y="${Number(y) + 4}" text-anchor="end" fill="#7c869b" font-size="11" font-family="Inter, sans-serif">${gradeLine}</text>
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
    polyline = `<polyline fill="none" stroke="#8e9aff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${ptsAttr}" />`;
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
        <circle cx="${cx}" cy="${cy}" r="4.5" fill="#121726" stroke="#9da8ff" stroke-width="2.5" />
        <text x="${cx}" y="${labelY}" text-anchor="middle" fill="#f8fafc" font-size="11" font-weight="700" font-family="Inter, sans-serif">${formatGrade(p.grade.value)}</text>
        ${
          showDate
            ? `<text x="${cx}" y="${height - 4}" text-anchor="middle" fill="#8c96b2" font-size="11" font-family="Inter, sans-serif">${dateLabel}</text>`
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
async function renderApp() {
  const overallEl = document.getElementById('overall-average');
  const overallAvg = calculateOverallAverage();
  overallEl.textContent = formatGrade(overallAvg);
  overallEl.className = `overall-score ${getGradeColorClass(overallAvg)}`;

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

  for (const sub of state.subjects) {
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
            for (const pMeta of photos) {
              await deleteStoredPhoto(pMeta.id, pMeta.storedFileName);
            }
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
    addSubGradeBtn.className = 'btn btn-secondary btn-sm';
    addSubGradeBtn.textContent = `Note für ${sub.name}`;
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

  subjectSelect.innerHTML = state.subjects
    .map(s => {
      const icon = s.icon || guessIconForSubject(s.name);
      return `<option value="${s.id}">${escapeHtml(icon)} ${escapeHtml(s.name)}</option>`;
    })
    .join('');

  state.modalPhotos = [];
  state.removedPhotoIds = [];

  if (editGrade) {
    titleEl.textContent = 'Note bearbeiten';
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
    titleEl.textContent = 'Note eintragen';
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
// Modal: Fächer verwalten (Icons + Drag & Drop Sortierung)
// ============================================================================
function openSubjectsModal() {
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

  for (const sub of state.subjects) {
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
      const newName = prompt('Neuer Name für das Fach:', sub.name);
      if (newName && newName.trim()) {
        sub.name = newName.trim();
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
        for (const g of subGrades) {
          for (const p of g.photos || []) {
            await deleteStoredPhoto(p.id, p.storedFileName);
          }
        }
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
  await initStorage();
  await renderApp();

  document.getElementById('btn-add-grade').addEventListener('click', () => {
    if (state.subjects.length === 0) {
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
    const repo = document.getElementById('gh-repo-input').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
    const branch = document.getElementById('gh-branch-input').value.trim() || 'main';
    const token = document.getElementById('gh-token-input').value.trim();
    const statusEl = document.getElementById('sync-form-status');
    const saveBtn = document.getElementById('btn-save-sync');

    if (!repo.includes('/') || !token) {
      statusEl.textContent = 'Bitte gib dein Repository (z. B. nutzername/notenbuch) und deinen Token ein.';
      statusEl.classList.remove('hidden');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Verbinde...';
    statusEl.classList.add('hidden');

    try {
      const cfg = { repo, branch, token };
      const prevMode = state.storageMode;
      const existing = await ghGetFile('data/notenbuch.json', cfg);
      saveGhConfig(cfg);
      state.storageMode = 'github';

      if (existing && existing.content) {
        const parsed = JSON.parse(base64ToUtf8(existing.content));
        state.subjects = normalizeSubjects(parsed.subjects);
        state.grades = parsed.grades || [];
      } else {
        // Upload existing local photos (from local server or IndexedDB) into the private GitHub repo
        for (const grade of state.grades) {
          for (const pMeta of grade.photos || []) {
            try {
              let blob = null;
              if (prevMode === 'server') {
                const r = await fetch(`/api/photos/${encodeURIComponent(pMeta.id)}`);
                if (r.ok) blob = await r.blob();
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
                await ghPutFile(
                  `data/photos/${storedFileName}`,
                  b64,
                  `Foto synchronisiert: ${pMeta.name || storedFileName}`,
                  cfg
                );
              }
            } catch (_) {}
          }
        }
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
          state.grades[idx] = {
            ...state.grades[idx],
            subjectId,
            value: gradeVal,
            weight: state.selectedWeight,
            date: dateVal,
            note: noteVal,
            photos: finalPhotos
          };
        }
      } else {
        state.grades.push({
          id: `grade-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          subjectId,
          value: gradeVal,
          weight: state.selectedWeight,
          date: dateVal,
          note: noteVal,
          photos: finalPhotos
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

    if (state.subjects.some(s => s.name.toLowerCase() === name.toLowerCase())) {
      alert('Dieses Fach existiert bereits.');
      return;
    }

    const icon = state.newSubjectIconManuallyChosen
      ? state.newSubjectIcon
      : guessIconForSubject(name);

    const newSub = {
      id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      icon
    };
    state.subjects.push(newSub);
    newSubjectInput.value = '';
    state.newSubjectIcon = '📚';
    state.newSubjectIconManuallyChosen = false;
    document.getElementById('new-subject-icon-btn').textContent = '📚';
    document.getElementById('icon-picker-panel').classList.add('hidden');

    await persistState();
    renderManageSubjectsList();
    renderApp();
  });

  document.getElementById('btn-close-subjects').addEventListener('click', closeSubjectsModal);
  document.getElementById('btn-close-lightbox').addEventListener('click', closeLightbox);

  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) {
        if (backdrop.id === 'grade-modal') closeGradeModal();
        if (backdrop.id === 'subjects-modal') closeSubjectsModal();
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
      closeSyncModal();
    }
  });
});
