const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const supabase = require('../db/supabase');
const rateLimit = require('express-rate-limit');

const { fetchLeetCodeSubmissions } = require('../services/leetcode');
const { fetchCodeforcesSubmissions } = require('../services/codeforces');
const { fetchCodechefSubmissions } = require('../services/codechef');
const { fetchHackerrankSubmissions } = require('../services/hackerrank');

const syncLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many sync requests from this IP, please try again after 15 minutes' }
});

const COOLDOWN_MINUTES = {
  leetcode: 1,
  codeforces: 1,
  codechef: 1,
  hackerrank: 1
};

router.get('/sync', authenticateToken, syncLimiter, async (req, res) => {
  const { platform } = req.query; // all | leetcode | codeforces | codechef | hackerrank
  const userId = req.user.id;

  if (!platform) return res.status(400).json({ error: 'Platform parameter is required' });

  try {
    const { data: rawCredentials, error: credError } = await supabase
      .from('platform_credentials')
      .select('*')
      .eq('user_id', userId);

    if (credError) throw credError;

    const credentials = (rawCredentials || []).filter(c => c.username && !c.username.startsWith('__unlinked__'));

    if (credentials.length === 0) {
      return res.status(404).json({ error: 'No platform credentials found. Please link accounts first.' });
    }

    const targetPlatforms = platform === 'all' 
      ? ['leetcode', 'codeforces', 'codechef', 'hackerrank'] 
      : [platform];

    const results = {};

    const syncPromises = targetPlatforms.map(async (target) => {
      const cred = credentials.find(c => c.platform === target);
      if (!cred) {
        results[target] = { status: 'skipped', reason: 'Not linked' };
        return;
      }

      const lastSync = new Date(cred.last_synced_at || 0);
      const now = new Date();
      const diffMins = (now - lastSync) / (1000 * 60);

      if (diffMins < COOLDOWN_MINUTES[target]) {
        results[target] = { status: 'cached', cooldown_remaining: Math.ceil(COOLDOWN_MINUTES[target] - diffMins) };
        return;
      }

      try {
        let fetchResult;
        if (target === 'leetcode') fetchResult = await fetchLeetCodeSubmissions(cred.username);
        else if (target === 'codeforces') fetchResult = await fetchCodeforcesSubmissions(cred.username);
        else if (target === 'codechef') fetchResult = await fetchCodechefSubmissions(cred.username);
        else if (target === 'hackerrank') fetchResult = await fetchHackerrankSubmissions(cred.username);

        await supabase
          .from('platform_credentials')
          .update({ 
            raw_cache: { total_solved: fetchResult.total_solved, raw: fetchResult.raw }, 
            last_synced_at: new Date().toISOString() 
          })
          .eq('id', cred.id);

        if (fetchResult.submissions && fetchResult.submissions.length > 0) {
          const subsToInsert = fetchResult.submissions.map(s => ({
            user_id: userId,
            platform: target,
            submission_date: s.submission_date,
            problem_id: s.problem_id,
            status: s.status
          }));
          
          await supabase.from('submissions').upsert(subsToInsert, { onConflict: 'user_id, platform, submission_date, problem_id', ignoreDuplicates: true });
        }

        results[target] = { status: 'success', new_submissions: fetchResult?.submissions?.length || 0 };
      } catch (err) {
        console.error(`Error syncing ${target}:`, err);
        results[target] = { status: 'error', error: err.message };
      }
    });

    await Promise.allSettled(syncPromises);

    res.json({ message: 'Sync completed', results });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/link', authenticateToken, async (req, res) => {
  const { platform, username } = req.body;
  const userId = req.user.id;

  if (!platform || !username) return res.status(400).json({ error: 'Platform and username required' });

  // List of valid platforms
  const allowed = ['leetcode', 'codeforces', 'codechef', 'hackerrank'];
  if (!allowed.includes(platform)) {
    return res.status(400).json({ error: 'Invalid platform selection' });
  }

  // Sanitize username: only allow safe characters to prevent URL injection
  const usernameRegex = /^[a-zA-Z0-9_\-\.]{1,50}$/;
  if (!usernameRegex.test(username)) {
    return res.status(400).json({ error: 'Username contains invalid characters. Only letters, numbers, underscores, hyphens, and dots are allowed.' });
  }

  try {
    // Validate username on the actual platform first
    try {
      if (platform === 'leetcode') await fetchLeetCodeSubmissions(username);
      if (platform === 'codeforces') await fetchCodeforcesSubmissions(username);
      if (platform === 'codechef') await fetchCodechefSubmissions(username);
      if (platform === 'hackerrank') await fetchHackerrankSubmissions(username);
    } catch (valErr) {
      console.warn(`Validation failed during linking for ${platform}/${username}:`, valErr.message);
      return res.status(400).json({ error: `Username "${username}" could not be verified on ${platform}. Please check the spelling and try again.` });
    }

    // Check if they previously linked a different username
    const { data: existingCred } = await supabase
      .from('platform_credentials')
      .select('username')
      .eq('user_id', userId)
      .eq('platform', platform)
      .maybeSingle();

    let usernameChanged = false;
    if (existingCred && existingCred.username) {
      const prevUsername = existingCred.username.startsWith('__unlinked__')
        ? existingCred.username.substring(12)
        : existingCred.username;
      if (prevUsername !== username) {
        usernameChanged = true;
      }
    }

    // Check if they unlinked within the last 24 hours
    const { data: existingStreak } = await supabase
      .from('streaks')
      .select('updated_at')
      .eq('user_id', userId)
      .eq('platform', platform)
      .maybeSingle();

    let keepHistory = false;
    if (!usernameChanged && existingStreak && existingStreak.updated_at) {
      const unlinkTime = new Date(existingStreak.updated_at);
      const now = new Date();
      const diffHours = (now - unlinkTime) / (1000 * 60 * 60);
      if (diffHours <= 24) {
        keepHistory = true;
      }
    }

    if (!keepHistory) {
      // Delete old submissions to start fresh
      await supabase
        .from('submissions')
        .delete()
        .eq('user_id', userId)
        .eq('platform', platform);

      // Reset streak in DB
      await supabase
        .from('streaks')
        .upsert({
          user_id: userId,
          platform: platform,
          current_streak: 0,
          longest_streak: 0,
          last_active_date: null,
          status: 'broken'
        }, { onConflict: 'user_id, platform' });
    }

    const { data, error } = await supabase
      .from('platform_credentials')
      .upsert({ user_id: userId, platform, username }, { onConflict: 'user_id, platform' })
      .select()
      .single();

    if (error) throw error;
    res.json({ message: 'Account linked successfully', data });
  } catch (err) {
    console.error('Link error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/unlink', authenticateToken, async (req, res) => {
  const { platform } = req.body;
  const userId = req.user.id;

  if (!platform) return res.status(400).json({ error: 'Platform required' });

  try {
    // Instead of deleting, prefix with __unlinked__ so we can detect username changes later
    const { data: cred } = await supabase
      .from('platform_credentials')
      .select('username')
      .eq('user_id', userId)
      .eq('platform', platform)
      .maybeSingle();

    if (cred && cred.username && !cred.username.startsWith('__unlinked__')) {
      await supabase
        .from('platform_credentials')
        .update({ username: `__unlinked__${cred.username}`, last_synced_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('platform', platform);
    }

    // Save the unlink timestamp in the streaks table instead of deleting the row
    await supabase
      .from('streaks')
      .upsert({
        user_id: userId,
        platform: platform,
        current_streak: 0,
        status: 'broken',
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id, platform' });

    res.json({ message: 'Account unlinked successfully' });
  } catch (err) {
    console.error('Unlink error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
