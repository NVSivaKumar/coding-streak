const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("Missing Env vars!");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function check() {
  const { data: creds, error: credErr } = await supabase.from('platform_credentials').select('*');
  if (credErr) return console.error(credErr);
  console.log("Credentials:", creds);

  const { data: subs, error: subErr } = await supabase.from('submissions').select('*');
  if (subErr) return console.error(subErr);
  console.log(`Total submissions in DB: ${subs.length}`);

  const byUser = {};
  subs.forEach(d => {
    if (!byUser[d.user_id]) byUser[d.user_id] = {};
    if (!byUser[d.user_id][d.platform]) byUser[d.user_id][d.platform] = [];
    byUser[d.user_id][d.platform].push(d);
  });
  
  for (const uid in byUser) {
    console.log(`\nUser ID: ${uid}`);
    for (const plat in byUser[uid]) {
      const dates = byUser[uid][plat].map(s => s.submission_date);
      const uniqueDates = [...new Set(dates)];
      console.log(`  Platform: ${plat}`);
      console.log(`    Total Submissions: ${byUser[uid][plat].length}`);
      console.log(`    Unique Days: ${uniqueDates.length}`);
      console.log(`    Dates: ${uniqueDates.sort().join(', ')}`);
    }
  }
}
check();
