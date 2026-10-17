const { calculateStreak } = require('./src/services/streakCalculator');

// Mock submission on 2026-07-21 (yesterday)
const submissions = [
  { submission_date: '2026-07-21', status: 'accepted', platform: 'leetcode' }
];

// Let's mock Date.now() at different times of July 22 (today)
const times = [
  { label: '01:00 AM IST', time: new Date('2026-07-22T01:00:00+05:30').getTime() },
  { label: '09:00 AM IST', time: new Date('2026-07-22T09:00:00+05:30').getTime() },
  { label: '09:59 AM IST', time: new Date('2026-07-22T09:59:00+05:30').getTime() },
  { label: '10:00 AM IST', time: new Date('2026-07-22T10:00:00+05:30').getTime() },
  { label: '10:01 AM IST', time: new Date('2026-07-22T10:01:00+05:30').getTime() },
  { label: '11:00 AM IST', time: new Date('2026-07-22T11:00:00+05:30').getTime() },
  { label: '11:59 PM IST', time: new Date('2026-07-22T23:59:00+05:30').getTime() }
];

// We need to override Date.now in calculateStreak or run it manually.
// Let's modify calculateStreak to accept a custom 'now' for testing, or we can temporarily override Date.now.
const originalNow = Date.now;

times.forEach(t => {
  Date.now = () => t.time;
  const result = calculateStreak(submissions);
  console.log(`Checking at ${t.label}:`);
  console.log(`  todayStr: ${result.last_active_date ? 'yes' : 'no'} status: ${result.status}, current_streak: ${result.current_streak}`);
});

Date.now = originalNow;
