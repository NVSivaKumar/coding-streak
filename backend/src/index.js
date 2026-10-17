require('dotenv').config();
const express = require('express');
const cors = require('cors');

const jwtSecret = process.env.JWT_SECRET || 'fallback_dev_secret_please_change';
if (!process.env.JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set. Using fallback secret for development.');
}

const authRoutes = require('./routes/auth');
const platformRoutes = require('./routes/platforms');
const streakRoutes = require('./routes/streaks');

const app = express();
const PORT = process.env.PORT || 3000;

const corsOptions = {
  origin: process.env.EXTENSION_ORIGIN || '*',
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/platforms', platformRoutes);
app.use('/streaks', streakRoutes);

app.get('/', (req, res) => {
  res.send('CP Streak Tracker Backend is running');
});

// Ultra-fast health check — no DB, no auth, instant response for wake-up pings
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', ts: Date.now() });
});

// Wake endpoint — pings DB to pre-warm the connection pool so subsequent requests are faster
app.get('/wake', async (req, res) => {
  try {
    const supabase = require('./db/supabase');
    // Lightweight query to warm the connection
    await supabase.from('streaks').select('platform').limit(1);
    res.status(200).json({ status: 'warm', ts: Date.now() });
  } catch (err) {
    // Even if DB ping fails, the Express server is alive
    res.status(200).json({ status: 'alive', ts: Date.now(), db: 'cold' });
  }
});

// For local dev: listen on PORT. For Vercel: export the app as a serverless function.
if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}
