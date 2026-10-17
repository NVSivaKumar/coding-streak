function calculateStreak(submissions) {
  // submissions is an array of objects with submission_date string 'YYYY-MM-DD' and status 'accepted'
  const acceptedDates = [...new Set(
    submissions
      .filter(s => s.status === 'accepted')
      .map(s => s.submission_date)
  )].sort((a, b) => new Date(b) - new Date(a)); // Descending: latest first

  if (acceptedDates.length === 0) {
    return { current_streak: 0, longest_streak: 0, last_active_date: null, status: 'broken', solved: 0 };
  }

  // Use IST (+5:30) for all date operations to align with CodeChef/LeetCode streaks
  function getISTDateString(timestamp) {
    const istTime = timestamp + (5.5 * 60 * 60 * 1000);
    return new Date(istTime).toISOString().split('T')[0];
  }

  const todayStr = getISTDateString(Date.now());
  const yesterdayStr = getISTDateString(Date.now() - 24 * 60 * 60 * 1000);

  let currentStreak = 0;
  
  // Calculate current streak
  let checkTime = Date.now();
  let maxIterations = 3650; // Safety: max 10 years of streak
  while (maxIterations-- > 0) {
    const checkStr = getISTDateString(checkTime);
    if (acceptedDates.includes(checkStr)) {
      currentStreak++;
      checkTime -= 24 * 60 * 60 * 1000;
    } else if (checkStr === todayStr) {
      // If no submission today, that's fine, we check yesterday
      checkTime -= 24 * 60 * 60 * 1000;
    } else {
      break;
    }
  }

  // Calculate longest streak
  let longestStreak = 0;
  if (acceptedDates.length > 0) {
    let curr = 1;
    let max = 1;
    for (let i = 1; i < acceptedDates.length; i++) {
      const prevD = new Date(acceptedDates[i - 1]);
      const currD = new Date(acceptedDates[i]);
      const diff = (prevD - currD) / (1000 * 60 * 60 * 24);
      if (diff === 1) {
        curr++;
        if (curr > max) max = curr;
      } else {
        curr = 1;
      }
    }
    longestStreak = max;
  }
  
  // Overwrite longestStreak if current is somehow larger (edge cases or just starting)
  if (currentStreak > longestStreak) longestStreak = currentStreak;

  const lastActiveDate = acceptedDates[0];
  let isActive = acceptedDates.includes(todayStr);
  let isAtRisk = !isActive && acceptedDates.includes(yesterdayStr);
  
  let status = 'broken';
  if (isActive) status = 'active';
  else if (isAtRisk) status = 'at_risk';

  return {
    current_streak: currentStreak,
    longest_streak: longestStreak,
    last_active_date: lastActiveDate,
    status,
    solved: submissions.filter(s => s.status === 'accepted').length
  };
}

module.exports = { calculateStreak };
