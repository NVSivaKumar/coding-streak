// Background service worker — keeps backend warm and provides instant data to popup

// Import shared backend URL from config.js (single source of truth)
importScripts('../config.js');

// ─── KEEP-ALIVE: Ping backend every 2 minutes to prevent cold starts ─────────
chrome.runtime.onInstalled.addListener(() => {
  console.log('CP Streak Tracker Extension Installed');

  // Immediately wake the backend + warm DB connection
  wakeBackend();

  // Keep-alive alarm: ping every 2 minutes to prevent backend from sleeping
  chrome.alarms.create('keepBackendAlive', { periodInMinutes: 2 });

  // Full data sync alarm: every 6 hours
  chrome.alarms.create('syncStreakData', { periodInMinutes: 6 * 60 });

  // Show startup notification to verify functionality
  showStartupNotification();
});

// Also wake the backend every time Chrome starts
chrome.runtime.onStartup.addListener(() => {
  console.log('Chrome started — waking backend');
  wakeBackend();
  showStartupNotification();
});

// Helper function to display browser notification with time left until reset
async function showStartupNotification() {
  // Calculate remaining time until midnight IST (UTC+5:30)
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  const istTime = new Date(utc + (5.5 * 60 * 60 * 1000));
  const nextMidnightIST = new Date(istTime);
  nextMidnightIST.setHours(24, 0, 0, 0);
  
  const diffMs = nextMidnightIST.getTime() - istTime.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const timeStr = `${hours}h ${minutes}m`;

  let message = `You have ${timeStr} left until the daily streak resets (midnight IST).`;
  let title = 'CP Streak Tracker';

  try {
    const data = await chrome.storage.local.get(['cachedStreaks']);
    if (data.cachedStreaks) {
      const parsed = JSON.parse(data.cachedStreaks);
      const combined = parsed.streaks && parsed.streaks.combined;
      if (combined) {
        const count = combined.current_streak || 0;
        if (combined.status === 'active') {
          title = `🔥 Streak Active: ${count} Days!`;
          message = `Great job! Your streak is safe. Next daily reset in ${timeStr}.`;
        } else if (combined.status === 'at_risk') {
          title = `⚠️ Streak at Risk: ${count} Days!`;
          message = `Solve a problem now! Only ${timeStr} left to save your streak.`;
        } else {
          title = `💪 Start a New Streak!`;
          message = `No active streak. Solve a problem to start one! Reset in ${timeStr}.`;
        }
      }
    }
  } catch (e) {
    console.error('Failed to parse cached streaks for notification:', e);
  }

  chrome.notifications.create('startup_notification_' + Date.now(), {
    type: 'basic',
    iconUrl: '/assets/icons/icon-48.png',
    title: title,
    message: message,
    priority: 2
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'keepBackendAlive') {
    // Lightweight ping — just checks the server is responsive
    try {
      await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(5000) });
    } catch {
      // Backend is down — that's okay, we'll retry next alarm
    }
  }

  if (alarm.name === 'syncStreakData') {
    console.log('Running background sync for all platforms...');
    await performBackgroundSync();
  }
});

// ─── WAKE BACKEND: Hit /wake to pre-warm DB pool ─────────────────────────────
async function wakeBackend() {
  try {
    await fetch(`${BACKEND_URL}/wake`, { signal: AbortSignal.timeout(8000) });
    console.log('Backend is warm');
  } catch {
    console.log('Backend wake ping failed — server may be starting');
    // Retry once after 2 seconds
    setTimeout(async () => {
      try {
        await fetch(`${BACKEND_URL}/wake`, { signal: AbortSignal.timeout(8000) });
        console.log('Backend warm on retry');
      } catch {
        console.log('Backend still not responding');
      }
    }, 2000);
  }
}

// ─── PRE-FETCH: Cache streak data so popup opens instantly ────────────────────
async function prefetchStreakData() {
  try {
    const data = await chrome.storage.local.get(['token']);
    if (!data.token) return;

    const res = await fetch(`${BACKEND_URL}/streaks`, {
      headers: { 'Authorization': `Bearer ${data.token}` },
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      const streakData = await res.json();
      await chrome.storage.local.set({
        cachedStreaks: JSON.stringify(streakData),
        cachedStreaksTimestamp: Date.now()
      });
      console.log('Streak data pre-fetched and cached');
    }
  } catch (err) {
    console.log('Pre-fetch failed:', err.message);
  }
}

// ─── MESSAGE HANDLER: Popup can request wake + data ──────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'wakeAndFetch') {
    // Wake backend + pre-fetch data in parallel
    Promise.all([wakeBackend(), prefetchStreakData()])
      .then(() => sendResponse({ status: 'done' }))
      .catch(() => sendResponse({ status: 'error' }));
    return true; // Keep message channel open for async response
  }

  if (message.action === 'checkBackendHealth') {
    fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(3000) })
      .then(res => res.json())
      .then(data => sendResponse({ alive: true, data }))
      .catch(() => sendResponse({ alive: false }));
    return true;
  }
});

// ─── BACKGROUND SYNC: Full platform data sync ────────────────────────────────
async function performBackgroundSync() {
  try {
    const data = await chrome.storage.local.get(['token']);
    if (!data.token) {
      console.log('No auth token found, skipping background sync');
      return;
    }

    const response = await fetch(`${BACKEND_URL}/platforms/sync?platform=all`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${data.token}`
      },
      signal: AbortSignal.timeout(30000)
    });

    if (response.ok) {
      console.log('Background sync successful');
      // After sync, pre-fetch the updated streak data
      await prefetchStreakData();
    } else {
      console.error('Background sync failed with status', response.status);
    }
  } catch (error) {
    console.error('Background sync network error:', error);
  }
}
