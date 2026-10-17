const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../db/supabase');
const rateLimit = require('express-rate-limit');

// Rate limit auth endpoints to prevent brute-force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many authentication attempts, please try again after 15 minutes' }
});

// Auto-login/register with a unique installation/device ID
router.post('/anonymous', async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'Device ID required' });

    // Try to find existing anonymous user by email placeholder
    const anonEmail = `anon_${deviceId}@streak.dev`;
    
    let { data: user, error } = await supabase
      .from('app_users')
      .select('id, email')
      .eq('email', anonEmail)
      .maybeSingle();

    if (error) {
      console.error('Supabase query error:', error);
      return res.status(500).json({ error: 'Database query failed', details: error });
    }

    if (!user) {
      // Create new anonymous user
      const { data: newUser, error: createError } = await supabase
        .from('app_users')
        .insert([{ email: anonEmail, password_hash: 'anonymous_user_placeholder' }])
        .select('id, email')
        .single();

      if (createError) {
        console.error('Supabase insert error:', createError);
        return res.status(500).json({ error: 'Database insert failed', details: createError });
      }
      user = newUser;
    }

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || 'fallback_dev_secret_please_change', { expiresIn: '365d' });
    res.json({ user, token });
  } catch (err) {
    console.error('Anonymous auth error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

router.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    // Password strength validation
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const { data: user, error } = await supabase
      .from('app_users')
      .insert([{ email, password_hash: passwordHash }])
      .select('id, email')
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Email already exists' });
      throw error;
    }

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || 'fallback_dev_secret_please_change', { expiresIn: '30d' });
    res.status(201).json({ user, token });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { data: user, error } = await supabase
      .from('app_users')
      .select('id, email, password_hash')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || 'fallback_dev_secret_please_change', { expiresIn: '30d' });
    res.json({ user: { id: user.id, email: user.email }, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
