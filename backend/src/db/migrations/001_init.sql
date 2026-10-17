-- Enable uuid-ossp extension for uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create app_users table (renamed from 'users' to avoid Supabase schema conflicts)
CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create platform enum
CREATE TYPE cp_platform AS ENUM ('leetcode', 'codeforces', 'codechef', 'hackerrank');

-- Create platform_credentials table
CREATE TABLE IF NOT EXISTS platform_credentials (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
  platform cp_platform NOT NULL,
  username TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ,
  raw_cache JSONB,
  UNIQUE(user_id, platform)
);

-- Create submissions table
CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
  platform cp_platform NOT NULL,
  submission_date DATE NOT NULL,
  problem_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'attempted')),
  UNIQUE(user_id, platform, submission_date, problem_id)
);

-- Create streaks table
-- platform is TEXT to accommodate 'leetcode', 'codeforces', 'codechef', 'hackerrank', AND 'combined'
CREATE TABLE IF NOT EXISTS streaks (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_active_date DATE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'at_risk', 'broken')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform)
);
