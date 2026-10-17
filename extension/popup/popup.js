// BACKEND_URL is loaded from ../config.js (included via script tag in popup.html)

// Mock storage helper for previewing in a regular tab
const storageMock = {
  data: {},
  async get(keys) {
    const res = {};
    keys.forEach(k => {
      res[k] = this.data[k] || localStorage.getItem(k);
    });
    return res;
  },
  async set(obj) {
    Object.keys(obj).forEach(k => {
      this.data[k] = obj[k];
      localStorage.setItem(k, obj[k]);
    });
  },
  async remove(keys) {
    keys.forEach(k => {
      delete this.data[k];
      localStorage.removeItem(k);
    });
  }
};

const storage = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) 
  ? chrome.storage.local 
  : storageMock;

// Mock data for preview mode
const mockStreaks = {
  combined: { current_streak: 0, longest_streak: 0, last_active_date: null, status: 'broken' },
  leetcode: { current_streak: 0, longest_streak: 0, last_active_date: null, status: 'broken', solved: 0 },
  codeforces: { current_streak: 0, longest_streak: 0, last_active_date: null, status: 'broken', solved: 0 },
  codechef: { current_streak: 0, longest_streak: 0, last_active_date: null, status: 'broken', solved: 0 },
  hackerrank: { current_streak: 0, longest_streak: 0, last_active_date: null, status: 'broken', solved: 0 }
};

const mockLinked = { leetcode: false, codeforces: false, codechef: false, hackerrank: false };
const mockUsernames = { leetcode: '', codeforces: '', codechef: '', hackerrank: '' };

// Activity patterns for last 21 days (mock preview)
const mockActivityPatterns = [
  {key:'lc', name:'LC', pattern:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]},
  {key:'cf', name:'CF', pattern:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]},
  {key:'cc', name:'CC', pattern:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]},
  {key:'hr', name:'HR', pattern:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]},
];

document.addEventListener('DOMContentLoaded', () => {
  const navPopup = document.getElementById('navPopup');
  const navDash = document.getElementById('navDash');
  const popupView = document.getElementById('popupView');
  const dashView = document.getElementById('dashView');
  const platformCards = document.getElementById('platform-cards');
  const activityGrid = document.getElementById('activityGrid');

  // Show skeleton loaders immediately on startup
  renderSkeletons();

  // ─── INSTANT LOAD: Show cached data immediately, then refresh ──────────────
  loadCachedDataInstantly();

  // ─── AUTO-LOGIN: Generate device token silently on first run ────────────────
  initAnonymousAuth().then(() => {
    // Tell service worker to wake backend + pre-fetch (runs in parallel, non-blocking)
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'wakeAndFetch' }).catch(() => {});
      }
    } catch (e) {
      console.log('Service worker unavailable for wake request');
    }

    // Fetch fresh data from backend (with retries for cold-start scenarios)
    loadStreaksWithRetry().then(() => {
      // Trigger background sync to scrape new questions
      triggerBackgroundSync();
    });
  });

  async function initAnonymousAuth() {
    try {
      let data = await storage.get(['token', 'deviceId']);
      if (data.token) {
        console.log('Active anonymous session found');
        return;
      }

      // Generate a unique identifier for this extension installation
      let deviceId = data.deviceId;
      if (!deviceId) {
        deviceId = 'dev_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        await storage.set({ deviceId });
      }

      console.log('Initializing anonymous authentication session...');
      const res = await fetch(`${BACKEND_URL}/auth/anonymous`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId })
      });

      if (res.ok) {
        const authData = await res.json();
        await storage.set({ token: authData.token });
        console.log('Anonymous authentication session secured');
      } else {
        const errJson = await res.json().catch(() => ({}));
        console.warn('Anonymous auth failed:', res.status, errJson);
      }
    } catch (err) {
      console.error('Anonymous auth connection error:', err);
    }
  }

  // ─── RENDER SKELETON LOADERS ───────────────────────────────────────────────
  function renderSkeletons() {
    // Pulsing skeleton for the combined streak number
    const combinedStreakEl = document.getElementById('combined-streak');
    if (combinedStreakEl) {
      combinedStreakEl.innerHTML = `<span class="skeleton" style="width: 24px; height: 28px; vertical-align: middle;"></span>`;
    }

    platformCards.innerHTML = '';
    const platforms = ['lc', 'cf', 'cc', 'hr'];
    platforms.forEach(p => {
      const card = document.createElement('div');
      card.className = `platform-card skeleton-card ${p}`;
      card.innerHTML = `
        <div class="platform-icon skeleton"></div>
        <div class="platform-info" style="flex: 1;">
          <div class="skeleton" style="width: 80px; height: 12px; margin-bottom: 6px;"></div>
          <div class="skeleton" style="width: 120px; height: 10px; margin-bottom: 4px;"></div>
          <div class="skeleton" style="width: 60px; height: 8px;"></div>
        </div>
        <div class="platform-right" style="width: 45px; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
          <div class="skeleton" style="width: 24px; height: 18px;"></div>
          <div class="skeleton" style="width: 32px; height: 8px;"></div>
        </div>
      `;
      platformCards.appendChild(card);
    });
  }

  // ─── CACHED DATA: Render instantly from chrome.storage ─────────────────────
  async function loadCachedDataInstantly() {
    try {
      const cached = await storage.get(['cachedStreaks', 'cachedStreaksTimestamp']);
      if (cached.cachedStreaks && typeof cached.cachedStreaks === 'string') {
        // Hardened JSON.parse: corrupted cache won't crash the popup
        let data;
        try {
          data = JSON.parse(cached.cachedStreaks);
        } catch (parseErr) {
          console.warn('Corrupted cache detected, clearing:', parseErr.message);
          await storage.remove(['cachedStreaks', 'cachedStreaksTimestamp']);
          return false;
        }

        if (data && data.streaks) {
          console.log('Rendering cached data instantly (stale-while-revalidate)');
          renderData(
            data.streaks || mockStreaks,
            data.linked || mockLinked,
            data.usernames || mockUsernames,
            data.submissions || []
          );
          return true; // Cached data rendered
        }
      }
    } catch (e) {
      console.log('No cached data available:', e.message);
    }
    // Skeletons remain visible until fresh fetch finishes
    return false;
  }

  // ─── SMART FETCH: Retry mechanism for cold-start backend ───────────────────
  async function loadStreaksWithRetry(attempt = 1, maxAttempts = 3) {
    try {
      const data = await storage.get(['token']);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

      const res = await fetch(`${BACKEND_URL}/streaks`, {
        headers: data.token ? { 'Authorization': `Bearer ${data.token}` } : {},
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (res.ok) {
        const responseData = await res.json();
        renderData(
          responseData.streaks,
          responseData.linked,
          responseData.usernames || mockUsernames,
          responseData.submissions || []
        );
        // Cache the fresh data for next popup open
        await storage.set({
          cachedStreaks: JSON.stringify(responseData),
          cachedStreaksTimestamp: Date.now()
        });
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.log(`Fetch attempt ${attempt}/${maxAttempts} failed:`, err.message);
      if (attempt < maxAttempts) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt - 1) * 1000;
        setTimeout(() => loadStreaksWithRetry(attempt + 1, maxAttempts), delay);
      } else {
        console.log('All fetch attempts failed — using cached/mock fallback');
        // Render fallback mock/empty/cached state so user doesn't get stuck on skeletons forever
        try {
          const cached = await storage.get(['cachedStreaks']);
          if (cached.cachedStreaks) {
            const data = JSON.parse(cached.cachedStreaks);
            if (data && data.streaks) {
              renderData(data.streaks, data.linked, data.usernames || mockUsernames, data.submissions || []);
              return;
            }
          }
        } catch (cacheErr) {
          console.warn('Failed to parse cached data during fallback:', cacheErr.message);
        }
        renderData(mockStreaks, mockLinked, mockUsernames, []);
      }
    }
  }

  // ─── TRIGGER BACKGROUND SYNC ──────────────────────────────────────────────
  async function triggerBackgroundSync() {
    try {
      const data = await storage.get(['token']);
      await fetch(`${BACKEND_URL}/platforms/sync?platform=all`, {
        headers: data.token ? { 'Authorization': `Bearer ${data.token}` } : {},
        signal: AbortSignal.timeout(15000)
      }).catch(() => {
        console.log('Background sync unavailable');
      });
      // Refresh with synced data
      loadStreaksWithRetry();
    } catch (e) {
      console.log('Background sync failed:', e);
    }
  }

  // Navigation handlers
  navPopup.addEventListener('click', () => switchTab('popup'));
  navDash.addEventListener('click', () => switchTab('dashboard'));

  function switchTab(tab) {
    navPopup.classList.remove('active');
    navDash.classList.remove('active');
    popupView.classList.remove('hide');
    dashView.classList.remove('show');
    const combinedStrip = document.querySelector('.combined-strip');

    if (tab === 'popup') {
      navPopup.classList.add('active');
      if (combinedStrip) combinedStrip.style.display = 'flex';
    } else if (tab === 'dashboard') {
      navDash.classList.add('active');
      popupView.classList.add('hide');
      dashView.classList.add('show');
      if (combinedStrip) combinedStrip.style.display = 'none';
      buildActivityGrid();
    }
  }

  let expiryInterval = null;

  function updateStreakExpiries(streaks) {
    if (expiryInterval) {
      clearInterval(expiryInterval);
      expiryInterval = null;
    }

    const container = document.getElementById('streak-expiry-container');
    const iconEl = document.getElementById('expiry-icon');
    const titleEl = document.getElementById('expiry-title');
    const timeEl = document.getElementById('expiry-time');

    const IST_OFFSET = 5.5 * 60 * 60 * 1000;

    function refreshTimers() {
      const now = Date.now();
      const istNow = now + IST_OFFSET;

      // 1. Update Combined Streak Container (Dashboard)
      if (container && iconEl && titleEl && timeEl) {
        const combinedStreak = streaks['combined'];
        if (!combinedStreak || combinedStreak.status === 'broken' || combinedStreak.current_streak === 0) {
          container.style.borderColor = 'rgba(244, 63, 94, 0.2)';
          container.style.background = 'linear-gradient(135deg, rgba(244, 63, 94, 0.03) 0%, var(--bg2) 100%)';
          iconEl.textContent = '💀';
          titleEl.textContent = 'Streak Broken';
          titleEl.style.color = 'var(--broken)';
          timeEl.textContent = 'Solve a problem to start a new streak!';
        } else {
          const tempDate = new Date(istNow);
          let targetDateIST;
          if (combinedStreak.status === 'active') {
            tempDate.setUTCDate(tempDate.getUTCDate() + 1);
            tempDate.setUTCHours(23, 59, 59, 999);
            targetDateIST = tempDate.getTime();
          } else if (combinedStreak.status === 'at_risk') {
            tempDate.setUTCHours(23, 59, 59, 999);
            targetDateIST = tempDate.getTime();
          }

          if (targetDateIST) {
            const targetUtc = targetDateIST - IST_OFFSET;
            const msLeft = targetUtc - now;
            if (msLeft <= 0) {
              timeEl.textContent = 'Streak ending... refresh to update.';
            } else {
              const hours = Math.floor(msLeft / (3600 * 1000));
              const mins = Math.floor((msLeft % (3600 * 1000)) / (60 * 1000));
              const secs = Math.floor((msLeft % (60 * 1000)) / 1000);
              const timeString = `${hours}h ${mins}m ${secs}s`;

              if (combinedStreak.status === 'active') {
                container.style.borderColor = 'rgba(56, 189, 248, 0.2)';
                container.style.background = 'linear-gradient(135deg, rgba(56, 189, 248, 0.03) 0%, var(--bg2) 100%)';
                iconEl.textContent = '⚡';
                titleEl.textContent = 'Streak Safe';
                titleEl.style.color = 'var(--combined)';
                timeEl.textContent = `Streak ends in ${timeString} (tomorrow end)`;
              } else if (combinedStreak.status === 'at_risk') {
                container.style.borderColor = 'rgba(245, 158, 11, 0.2)';
                container.style.background = 'linear-gradient(135deg, rgba(245, 158, 11, 0.05) 0%, var(--bg2) 100%)';
                iconEl.textContent = '⏳';
                titleEl.textContent = 'Streak At Risk';
                titleEl.style.color = 'var(--at-risk)';
                timeEl.textContent = `Ends in ${timeString} (solve today!)`;
              }
            }
          }
        }
      }

      // 2. Update Platform Specific Cards (Home/Popup)
      const platformExpiryEls = document.querySelectorAll('.platform-expiry');
      platformExpiryEls.forEach(el => {
        const platformKey = el.getAttribute('data-platform');
        const pStreak = streaks[platformKey];
        if (pStreak && (pStreak.status === 'active' || pStreak.status === 'at_risk')) {
          const tempDate = new Date(istNow);
          let targetDateIST;
          if (pStreak.status === 'active') {
            tempDate.setUTCDate(tempDate.getUTCDate() + 1);
            tempDate.setUTCHours(23, 59, 59, 999);
            targetDateIST = tempDate.getTime();
          } else if (pStreak.status === 'at_risk') {
            tempDate.setUTCHours(23, 59, 59, 999);
            targetDateIST = tempDate.getTime();
          }

          if (targetDateIST) {
            const targetUtc = targetDateIST - IST_OFFSET;
            const msLeft = targetUtc - now;
            if (msLeft <= 0) {
              el.textContent = 'Ends in 0h 0m 0s';
            } else {
              const hours = Math.floor(msLeft / (3600 * 1000));
              const mins = Math.floor((msLeft % (3600 * 1000)) / (60 * 1000));
              const secs = Math.floor((msLeft % (60 * 1000)) / 1000);
              el.textContent = `Ends in ${hours}h ${mins}m ${secs}s`;
            }
          }
        }
      });
    }

    refreshTimers();
    expiryInterval = setInterval(refreshTimers, 1000);
  }

  function renderData(streaks, linked, usernames, submissions = []) {
    // Generate dates for the last 21 days
    const last21Days = [];
    for (let i = 20; i >= 0; i--) {
      const timestamp = Date.now() - i * 24 * 60 * 60 * 1000;
      const istTime = timestamp + (5.5 * 60 * 60 * 1000);
      last21Days.push(new Date(istTime).toISOString().split('T')[0]);
    }

    // Update activity patterns based on real submissions if available
    if (submissions && submissions.length > 0) {
      const keyMap = { leetcode: 'lc', codeforces: 'cf', codechef: 'cc', hackerrank: 'hr' };
      
      mockActivityPatterns.forEach(p => {
        const platformKey = Object.keys(keyMap).find(k => keyMap[k] === p.key);
        p.pattern = last21Days.map(dateStr => {
          const hasSub = submissions.some(s => s.platform === platformKey && s.submission_date === dateStr);
          return hasSub ? 1 : 0;
        });
      });
    } else {
      mockActivityPatterns.forEach(p => {
        p.pattern = Array(21).fill(0);
      });
    }

    platformCards.innerHTML = '';
    const platforms = [
      { key: 'leetcode', short: 'lc', label: 'LeetCode' },
      { key: 'codeforces', short: 'cf', label: 'Codeforces' },
      { key: 'codechef', short: 'cc', label: 'CodeChef' },
      { key: 'hackerrank', short: 'hr', label: 'HackerRank' }
    ];
    
    if (streaks['combined']) {
      document.getElementById('combined-streak').textContent = streaks['combined'].current_streak || 0;
      document.getElementById('stat-best').textContent = streaks['combined'].current_streak || 0;
      document.getElementById('stat-longest').textContent = streaks['combined'].longest_streak || 0;
    }

    let totalSolved = 0;
    const platformUrls = {
      leetcode: (u) => `https://leetcode.com/u/${u}/`,
      codeforces: (u) => `https://codeforces.com/profile/${u}`,
      codechef: (u) => `https://www.codechef.com/users/${u}`,
      hackerrank: (u) => `https://www.hackerrank.com/profile/${u}`
    };

    platforms.forEach(p => {
      const isLinked = linked ? linked[p.key] : false;
      const s = streaks[p.key] || { current_streak: 0, longest_streak: 0, status: 'broken', solved: 0 };
      const username = usernames ? usernames[p.key] : '';
      
      totalSolved += s.solved || 0;
      const card = document.createElement('div');
      card.className = `platform-card ${p.short}`;
      
      if (isLinked) {
        let statusLabel = 'Streak broken';
        let statusClass = 'status-broken';
        if (s.status === 'active') {
          statusLabel = 'Streak active';
          statusClass = 'status-active';
        } else if (s.status === 'at_risk') {
          statusLabel = 'Streak at risk';
          statusClass = 'status-risk';
        } else {
          // If not active or at risk, check if they solved at least one problem in the last 21 days
          const hasSolvedIn21Days = s.last_active_date && last21Days.includes(s.last_active_date);
          if (hasSolvedIn21Days) {
            statusLabel = 'Streak broken';
            statusClass = 'status-broken';
          } else {
            statusLabel = 'No streak';
            statusClass = 'status-inactive';
          }
        }

        let expiryHtml = '';
        if (s.status === 'active' || s.status === 'at_risk') {
          expiryHtml = `<div class="platform-expiry" data-platform="${p.key}" style="font-size: 9px; color: var(--muted); font-family: 'JetBrains Mono', monospace; margin-top: 4px;"></div>`;
        }

        card.innerHTML = `
          <div class="platform-icon">${p.short.toUpperCase()}</div>
          <div class="platform-info">
            <div class="platform-name">${p.label}</div>
            <div class="platform-meta">${username || 'linked'} · ${s.solved || 0} solved</div>
            <span class="status-pill ${statusClass}"><span class="status-dot"></span>${statusLabel}</span>
            ${expiryHtml}
          </div>
          <div class="platform-right">
            <div class="streak-count">${s.current_streak}</div>
            <div class="streak-label">day streak</div>
          </div>
        `;

        // Make linked cards clickable to open profile
        card.style.cursor = 'pointer';
        card.title = `Open ${p.label} profile`;
        card.addEventListener('click', () => {
          const url = platformUrls[p.key](username);
          if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
            chrome.tabs.create({ url });
          } else {
            window.open(url, '_blank');
          }
        });
      } else {
        card.innerHTML = `
          <div class="platform-icon">${p.short.toUpperCase()}</div>
          <div class="platform-info" style="flex: 1;">
            <div class="platform-name" style="margin-bottom: 6px;">${p.label}</div>
            <div style="display: flex; gap: 6px; align-items: center;">
              <input type="text" placeholder="Username" id="input-${p.key}" class="link-input">
              <button class="link-btn" data-platform="${p.key}">Link</button>
            </div>
            <div id="error-${p.key}" style="color: var(--broken); font-size: 10px; margin-top: 4px; display: none; font-family: 'JetBrains Mono', monospace;"></div>
          </div>
        `;
      }
      platformCards.appendChild(card);
    });

    document.getElementById('stat-solved').textContent = totalSolved;
    // Calculate consistency percentage (based on active days in the last 21 days across linked platforms)
    const linkedKeys = platforms.filter(p => linked && linked[p.key]).map(p => p.short);
    const activeDaysIn21 = new Set();
    mockActivityPatterns.forEach(p => {
      if (linkedKeys.includes(p.key)) {
        p.pattern.forEach((val, idx) => {
          if (val > 0) {
            activeDaysIn21.add(idx);
          }
        });
      }
    });
    const consistency = Math.round((activeDaysIn21.size / 21) * 100);
    document.getElementById('stat-consistency').textContent = `${consistency}%`;

    // Render manage accounts section in dashboard
    const manageAccounts = document.getElementById('manageAccounts');
    if (manageAccounts) {
      manageAccounts.innerHTML = '';
      let anyLinked = false;
      platforms.forEach(p => {
        const isLinked = linked ? linked[p.key] : false;
        const username = usernames ? usernames[p.key] : '';
        
        if (isLinked) {
          anyLinked = true;
          const item = document.createElement('div');
          item.className = 'manage-account-item';
          item.innerHTML = `
            <div class="manage-account-info">
              <div class="manage-account-name">${p.label}</div>
              <div class="manage-account-username">${username}</div>
            </div>
            <button class="unlink-btn" data-platform="${p.key}">Unlink</button>
          `;
          manageAccounts.appendChild(item);
        }
      });
      
      if (!anyLinked) {
        const empty = document.createElement('div');
        empty.style.fontSize = '11px';
        empty.style.color = 'var(--muted)';
        empty.style.textAlign = 'center';
        empty.style.padding = '12px';
        empty.textContent = 'No platforms linked yet.';
        manageAccounts.appendChild(empty);
      }

      // Add unlink click handlers
      document.querySelectorAll('.unlink-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const platform = e.currentTarget.getAttribute('data-platform');
          e.currentTarget.textContent = '...';
          await unlinkPlatform(platform, e.currentTarget);
        });
      });
    }

    // Setup action listeners
    document.querySelectorAll('.link-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const platform = e.currentTarget.getAttribute('data-platform');
        const input = document.getElementById(`input-${platform}`);
        const errorDiv = document.getElementById(`error-${platform}`);
        const username = input.value.trim();
        
        if (errorDiv) {
          errorDiv.style.display = 'none';
          errorDiv.textContent = '';
        }

        if (!username) {
          if (errorDiv) {
            errorDiv.textContent = 'Please enter a username';
            errorDiv.style.display = 'block';
          }
          return;
        }

        e.currentTarget.textContent = '...';
        await linkPlatform(platform, username, errorDiv, e.currentTarget);
      });
    });

    buildActivityGrid();
    updateStreakExpiries(streaks);
  }

  async function linkPlatform(platform, username, errorDiv, btnEl) {
    const data = await storage.get(['token']);
    try {
      const res = await fetch(`${BACKEND_URL}/platforms/link`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(data.token ? { 'Authorization': `Bearer ${data.token}` } : {})
        },
        body: JSON.stringify({ platform, username })
      });

      // Wrap res.json() in try/catch: Vercel may return HTML error pages that aren't valid JSON
      let responseData;
      let isJson = true;
      try {
        responseData = await res.json();
      } catch (parseErr) {
        isJson = false;
      }

      if (!res.ok) {
        if (btnEl) btnEl.textContent = 'Link';
        if (errorDiv) {
          errorDiv.textContent = isJson && responseData.error 
            ? responseData.error 
            : `Server returned error (${res.status}). Please try again.`;
          errorDiv.style.display = 'block';
        }
        return;
      }

      if (res.ok) {
        // Sync right after linking (include authorization token)
        await fetch(`${BACKEND_URL}/platforms/sync?platform=${platform}`, {
          headers: data.token ? { 'Authorization': `Bearer ${data.token}` } : {}
        }).catch(() => {});
        loadStreaksWithRetry();
      }
    } catch (err) {
      console.error('Link error:', err);
      if (btnEl) btnEl.textContent = 'Link';
      if (errorDiv) {
        errorDiv.textContent = 'Connection error. Please try again.';
        errorDiv.style.display = 'block';
      }
    }
  }

  async function unlinkPlatform(platform, btnEl) {
    const data = await storage.get(['token']);
    let mockTriggered = false;
    try {
      await fetch(`${BACKEND_URL}/platforms/unlink`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(data.token ? { 'Authorization': `Bearer ${data.token}` } : {})
        },
        body: JSON.stringify({ platform })
      }).catch(() => {
        // Fallback mock success
        mockTriggered = true;
        mockLinked[platform] = false;
        mockUsernames[platform] = '';
        mockStreaks[platform] = { current_streak: 0, longest_streak: 0, last_active_date: null, status: 'broken', solved: 0 };
      });

      if (mockTriggered) {
        renderData(mockStreaks, mockLinked, mockUsernames);
      } else {
        loadStreaksWithRetry();
      }

      const tip = document.getElementById('unlinkTip');
      if (tip) tip.style.display = 'flex';
    } catch (err) {
      console.error('Unlink error:', err);
      if (btnEl) btnEl.textContent = 'Unlink';
    }
  }

  function buildActivityGrid() {
    activityGrid.innerHTML = '';
    mockActivityPatterns.forEach(p => {
      const row = document.createElement('div');
      row.className = 'activity-row';
      const lbl = document.createElement('div');
      lbl.className = 'activity-name';
      lbl.textContent = p.name;
      const cells = document.createElement('div');
      cells.className = 'activity-cells';
      
      p.pattern.forEach((active, i) => {
        const c = document.createElement('div');
        c.className = 'cell' + (active ? ` ${p.key}-active` : '');
        const daysAgo = 21 - i;
        c.setAttribute('data-tip', active ? `${daysAgo}d ago check` : `${daysAgo}d ago empty`);
        cells.appendChild(c);
      });
      row.appendChild(lbl);
      row.appendChild(cells);
      activityGrid.appendChild(row);
    });
  }
});
