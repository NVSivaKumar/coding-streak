const axios = require('axios');

async function fetchHackerrankSubmissions(username) {
  try {
    const url = `https://www.hackerrank.com/rest/hackers/${encodeURIComponent(username)}/recent_challenges?limit=50&response_version=v2`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 7000 // 7s timeout for Vercel serverless compatibility
    });

    const submissionsData = response.data?.models || [];
    
    const submissions = submissionsData.map(sub => {
      // Null-safe date parsing: fallback to current date if created_at is missing/invalid
      let submissionDate;
      try {
        const timestamp = sub.created_at ? new Date(sub.created_at).getTime() : Date.now();
        submissionDate = new Date(timestamp + (5.5 * 60 * 60 * 1000)).toISOString().split('T')[0];
      } catch (dateErr) {
        submissionDate = new Date(Date.now() + (5.5 * 60 * 60 * 1000)).toISOString().split('T')[0];
      }

      return {
        problem_id: sub.ch_slug || String(sub.id || 'unknown'),
        submission_date: submissionDate,
        status: 'accepted'
      };
    });

    return {
      raw: submissionsData,
      submissions
    };
  } catch (error) {
    console.error('HackerRank fetch error:', error.message);
    throw error;
  }
}

module.exports = { fetchHackerrankSubmissions };
