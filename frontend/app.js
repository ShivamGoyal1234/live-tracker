
let jwtToken = null;
let socket = null;
let watchId = null;

const markers = new Map();
const lastSeen = new Map();
const sidebarUsers = new Map();

const map = L.map('map').setView([20, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map);

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function createUserIcon(avatarUrl, name) {
  const safeName = escapeHtml(name || 'User');
  const src = avatarUrl
    ? escapeHtml(avatarUrl)
    : '/default-avatar.svg';
  return L.divIcon({
    html: `<div class="user-marker">
             <div class="avatar-wrap">
               <img src="${src}" alt="" onerror="this.src='/default-avatar.svg'"/>
               <span class="pulse-dot" aria-hidden="true"></span>
             </div>
             <span>${safeName}</span>
           </div>`,
    className: '',
    iconSize: [44, 54],
    iconAnchor: [22, 54],
  });
}

function parseTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('token');
  if (!raw) return;
  jwtToken = decodeURIComponent(raw);
  params.delete('token');
  const qs = params.toString();
  const path = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  window.history.replaceState({}, document.title, path);
}

function updateAuthUi() {
  const guestMsg = document.getElementById('guest-msg');
  const userChip = document.getElementById('user-chip');
  const btnLogin = document.getElementById('btn-login');
  const userAvatar = document.getElementById('user-avatar');
  const userName = document.getElementById('user-name');

  if (jwtToken) {
    guestMsg.classList.add('hidden');
    btnLogin.classList.add('hidden');
    userChip.classList.remove('hidden');
    try {
      const payload = JSON.parse(atob(jwtToken.split('.')[1]));
      userName.textContent = payload.name || 'User';
      userAvatar.src = payload.avatar || '/default-avatar.svg';
    } catch {
      userName.textContent = 'Signed in';
      userAvatar.src = '/default-avatar.svg';
    }
  } else {
    guestMsg.classList.remove('hidden');
    btnLogin.classList.remove('hidden');
    userChip.classList.add('hidden');
  }
}

function renderUserList() {
  const ul = document.getElementById('user-list');
  const empty = document.getElementById('user-list-empty');
  ul.innerHTML = '';
  const entries = [...sidebarUsers.entries()].sort((a, b) =>
    (a[1].name || '').localeCompare(b[1].name || ''),
  );
  if (entries.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  for (const [userId, info] of entries) {
    const li = document.createElement('li');
    li.className = 'user-row';
    if (info.online === false) {
      li.classList.add('offline');
    }
    const avatar = info.avatar || '/default-avatar.svg';
    li.innerHTML = `
      <img class="user-row-avatar" src="${escapeHtml(avatar)}" alt="" onerror="this.src='/default-avatar.svg'"/>
      <div class="user-row-meta">
        <span class="user-row-name">${escapeHtml(info.name || 'User')}</span>
        <span class="user-row-badge">${info.online === false ? '○ Offline' : '● Live'}</span>
      </div>
    `;
    li.dataset.userId = userId;
    ul.appendChild(li);
  }
}

function updateOnlineCount() {
  let n = 0;
  for (const [, info] of sidebarUsers) {
    if (info.online !== false) n += 1;
  }
  document.getElementById('online-count').textContent = String(n);
}

function upsertSidebarUser(userId, name, avatar, online) {
  const prev = sidebarUsers.get(userId) || {};
  sidebarUsers.set(userId, {
    name: name || prev.name || 'User',
    avatar: avatar || prev.avatar || '',
    online: online !== undefined ? online : prev.online !== false,
  });
  renderUserList();
  updateOnlineCount();
}

const throttledEmit = _.throttle((lat, lng) => {
  if (!socket || !jwtToken) return;
  socket.emit('location:update', {
    lat,
    lng,
    timestamp: Date.now(),
  });
}, 3000);

function startGeolocation() {
  if (!navigator.geolocation) {
    const el = document.getElementById('geo-warning');
    el.textContent = 'Geolocation is not supported in this browser.';
    el.classList.remove('hidden');
    return;
  }
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      throttledEmit(lat, lng);
    },
    (err) => {
      const el = document.getElementById('geo-warning');
      el.textContent = `Location error: ${err.message || 'permission denied'}`;
      el.classList.remove('hidden');
    },
    { maximumAge: 5000, timeout: 10000, enableHighAccuracy: true },
  );
}

function connectSocket() {
  if (!jwtToken) return;
  socket = io({
    auth: { token: jwtToken },
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    document.getElementById('geo-warning').classList.add('hidden');
    startGeolocation();
  });

  socket.on('connect_error', (err) => {
    const el = document.getElementById('geo-warning');
    el.textContent = err.message === 'unauthorized' ? 'Session expired — please log in again.' : `Connection error: ${err.message}`;
    el.classList.remove('hidden');
  });

  socket.on('location:broadcast', ({ userId, name, avatar, lat, lng, timestamp }) => {
    lastSeen.set(userId, Date.now());
    upsertSidebarUser(userId, name, avatar, true);
    if (markers.has(userId)) {
      markers.get(userId).setLatLng([lat, lng]);
    } else {
      const marker = L.marker([lat, lng], {
        icon: createUserIcon(avatar, name),
      })
        .bindPopup(`<b>${escapeHtml(name)}</b><br>Live`)
        .addTo(map);
      markers.set(userId, marker);
    }
    void timestamp;
  });

  socket.on('user:offline', ({ userId }) => {
    upsertSidebarUser(userId, undefined, undefined, false);
    const row = document.querySelector(`[data-user-id="${userId}"]`);
    if (row) {
      row.classList.add('offline');
      const badge = row.querySelector('.user-row-badge');
      if (badge) badge.textContent = '○ Offline';
    }
    updateOnlineCount();
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [userId, ts] of lastSeen.entries()) {
    if (now - ts > 60000) {
      const m = markers.get(userId);
      if (m) {
        map.removeLayer(m);
        markers.delete(userId);
      }
      lastSeen.delete(userId);
      sidebarUsers.delete(userId);
    }
  }
  renderUserList();
  updateOnlineCount();
}, 30000);

document.getElementById('btn-logout').addEventListener('click', () => {
  jwtToken = null;
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
  window.location.href = '/auth/logout';
});

parseTokenFromUrl();
updateAuthUi();
if (jwtToken) {
  connectSocket();
}
