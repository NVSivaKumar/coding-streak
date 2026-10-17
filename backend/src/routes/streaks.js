const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const supabase = require('../db/supabase');
const { calculateStreak } = require('../services/streakCalculator');

router.get('/', authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const { data: submissions, error: subError } = await supabase
      .from('submissions')
      .select('platform, submission_date, status')
      .eq('user_id', userId);

    if (subError) throw subError;

    const { data: credentials, error: credError } = await supabase
      .from('platform_credentials')
      .select('platform, username, raw_cache')
      .eq('user_id', userId);

    if (credError) throw credError;

    const linkedMap = {
      leetcode: false,
      codeforces: false,
      codechef: false,
      hackerrank: false
    };
    const usernamesMap = {
      leetcode: '',
      codeforces: '',
      codechef: '',
      hackerrank: ''
    };
    const totalSolvedMap = {};
    
    if (credentials) {
      credentials.forEach(c => {
        if (c.username && !c.username.startsWith('__unlinked__')) {
          linkedMap[c.platform] = true;
          usernamesMap[c.platform] = c.username;
          if (c.raw_cache && c.raw_cache.total_solved !== undefined) {
             totalSolvedMap[c.platform] = c.raw_cache.total_solved;
          }
        }
      });
    }

    const platforms = ['leetcode', 'codeforces', 'codechef', 'hackerrank'];
    const streakResults = {};
    const streaksToUpsert = [];

    for (const platform of platforms) {
      const platformSubs = submissions.filter(s => s.platform === platform);
      const streakData = calculateStreak(platformSubs);
      
      if (totalSolvedMap[platform] !== undefined) {
         streakData.solved = totalSolvedMap[platform];
      }
      
      streakResults[platform] = streakData;
      
      streaksToUpsert.push({
        user_id: userId,
        platform: platform,
        current_streak: streakData.current_streak,
        longest_streak: streakData.longest_streak,
        last_active_date: streakData.last_active_date,
        status: streakData.status,
        updated_at: new Date().toISOString()
      });
    }

    const dateCounts = {};
    const acceptedSubs = submissions.filter(s => s.status === 'accepted');
    
    acceptedSubs.forEach(s => {
      if (!dateCounts[s.submission_date]) {
        dateCounts[s.submission_date] = new Set();
      }
      dateCounts[s.submission_date].add(s.platform);
    });

    const linkedPlatformsCount = Object.keys(linkedMap).filter(k => linkedMap[k]).length;
    const combinedDates = Object.keys(dateCounts).filter(date => {
      return linkedPlatformsCount > 0 && dateCounts[date].size >= linkedPlatformsCount;
    });
    
    const pseudoCombinedSubs = combinedDates.map(date => ({
      submission_date: date,
      status: 'accepted'
    }));

    const combinedStreakData = calculateStreak(pseudoCombinedSubs);
    
    // Override combined solved count by summing up all individual platform solved counts
    let combinedSolved = 0;
    platforms.forEach(p => {
       if (streakResults[p] && streakResults[p].solved) {
           combinedSolved += streakResults[p].solved;
       }
    });
    combinedStreakData.solved = combinedSolved;

    streakResults['combined'] = combinedStreakData;

    streaksToUpsert.push({
        user_id: userId,
        platform: 'combined',
        current_streak: combinedStreakData.current_streak,
        longest_streak: combinedStreakData.longest_streak,
        last_active_date: combinedStreakData.last_active_date,
        status: combinedStreakData.status,
        updated_at: new Date().toISOString()
    });

    await supabase.from('streaks').upsert(streaksToUpsert, { onConflict: 'user_id, platform' });

    res.json({ 
      streaks: streakResults, 
      linked: linkedMap, 
      usernames: usernamesMap, 
      submissions: submissions.filter(s => s.status === 'accepted') 
    });
  } catch (err) {
    console.error('Streaks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
