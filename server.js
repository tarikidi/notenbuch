const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Listen on all network interfaces so smartphones on the same Wi-Fi can connect
const DATA_DIR = path.join(__dirname, 'data');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const DB_FILE = path.join(DATA_DIR, 'notenbuch.json');

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

const DEFAULT_SUBJECT_ICONS = {
  deutsch: '📖',
  englisch: '🇬🇧',
  geographie: '🌍',
  erdkunde: '🌍',
  mathematik: '📐',
  mathe: '📐',
  musik: '🎵',
  biologie: '🧬',
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
  hsu: '🌱'
};

function guessIconForSubject(name = '') {
  const lower = name.toLowerCase().trim();
  for (const [key, icon] of Object.entries(DEFAULT_SUBJECT_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return '📚';
}

function getLocalLanUrls(port) {
  const interfaces = os.networkInterfaces();
  const urls = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        urls.push(`http://${iface.address}:${port}`);
      }
    }
  }
  return urls;
}

// Initial seed data matching the screenshots if DB doesn't exist yet
function getInitialData() {
  return {
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
        photos: []
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
}

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = getInitialData();
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (Array.isArray(parsed.subjects)) {
      parsed.subjects = parsed.subjects.map(sub => ({
        ...sub,
        icon: sub.icon || guessIconForSubject(sub.name)
      }));
    }
    return parsed;
  } catch (err) {
    return getInitialData();
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.svg': 'image/svg+xml'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;

    // API: Get full state + LAN URLs
    if (req.method === 'GET' && pathname === '/api/state') {
      const db = readDb();
      return sendJson(res, 200, {
        ...db,
        lanUrls: getLocalLanUrls(PORT)
      });
    }

    // API: Save state (subjects & grades metadata)
    if (req.method === 'POST' && pathname === '/api/state') {
      const bodyBuf = await collectBody(req);
      const data = JSON.parse(bodyBuf.toString('utf8'));
      if (!data || !Array.isArray(data.subjects) || !Array.isArray(data.grades)) {
        return sendJson(res, 400, { error: 'Ungültige Datenstruktur' });
      }
      writeDb({
        students: data.students || [],
        subjects: data.subjects,
        grades: data.grades,
        logs: data.logs || []
      });
      if (typeof data.csv === 'string') {
        fs.writeFileSync(path.join(DATA_DIR, 'changelog.csv'), data.csv, 'utf8');
      }
      return sendJson(res, 200, { ok: true });
    }

    // API: Upload original photo (binary stream with headers for metadata)
    if (req.method === 'POST' && pathname === '/api/photos') {
      const rawBuffer = await collectBody(req);
      const originalName = decodeURIComponent(req.headers['x-file-name'] || 'foto.jpg');
      const mimeType = req.headers['content-type'] || 'application/octet-stream';
      const width = parseInt(req.headers['x-image-width'] || '0', 10) || null;
      const height = parseInt(req.headers['x-image-height'] || '0', 10) || null;

      const ext = path.extname(originalName) || '.jpg';
      const photoId = `photo-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const storedFileName = `${photoId}${ext}`;
      const filePath = path.join(PHOTOS_DIR, storedFileName);

      // Write exact original bytes without any compression or modification
      fs.writeFileSync(filePath, rawBuffer);

      // Save metadata sidecar so we always know original filename and mimeType
      const meta = {
        id: photoId,
        name: originalName,
        storedFileName,
        mimeType,
        size: rawBuffer.length,
        width,
        height,
        uploadedAt: new Date().toISOString()
      };
      fs.writeFileSync(path.join(PHOTOS_DIR, `${photoId}.json`), JSON.stringify(meta, null, 2), 'utf8');

      return sendJson(res, 201, meta);
    }

    // API: Serve or download original photo
    if (req.method === 'GET' && pathname.startsWith('/api/photos/')) {
      const photoId = pathname.replace('/api/photos/', '').replace(/[^a-zA-Z0-9_-]/g, '');
      const metaPath = path.join(PHOTOS_DIR, `${photoId}.json`);
      if (!fs.existsSync(metaPath)) {
        res.writeHead(404);
        return res.end('Foto nicht gefunden');
      }
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const filePath = path.join(PHOTOS_DIR, meta.storedFileName);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        return res.end('Fotodatei nicht gefunden');
      }

      const stat = fs.statSync(filePath);
      const isDownload = urlObj.searchParams.get('download') === '1';
      const headers = {
        'Content-Type': meta.mimeType || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'public, max-age=31536000'
      };

      if (isDownload) {
        const safeName = encodeURIComponent(meta.name || meta.storedFileName);
        headers['Content-Disposition'] = `attachment; filename="${safeName}"; filename*=UTF-8''${safeName}`;
      }

      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // API: Delete photo from disk
    if (req.method === 'DELETE' && pathname.startsWith('/api/photos/')) {
      const photoId = pathname.replace('/api/photos/', '').replace(/[^a-zA-Z0-9_-]/g, '');
      const metaPath = path.join(PHOTOS_DIR, `${photoId}.json`);
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          const filePath = path.join(PHOTOS_DIR, meta.storedFileName);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          fs.unlinkSync(metaPath);
        } catch (e) {
          // ignore cleanup errors
        }
      }
      return sendJson(res, 200, { ok: true });
    }

    // Serve static frontend files
    let filePath = pathname === '/' ? path.join(__dirname, 'index.html') : path.join(__dirname, pathname);
    // Prevent directory traversal
    if (!filePath.startsWith(__dirname)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  const lanUrls = getLocalLanUrls(PORT);
  console.log(`Notenbuch Server läuft lokal auf: http://localhost:${PORT}`);
  if (lanUrls.length > 0) {
    console.log(`Im gleichen WLAN (Smartphone/Tablet) erreichbar unter:`);
    lanUrls.forEach(u => console.log(`  -> ${u}`));
  }
});
