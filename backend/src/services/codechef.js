const axios = require('axios');
const cheerio = require('cheerio');

async function fetchCodechefSubmissions(username) {
  try {
    const encodedUsername = encodeURIComponent(username);
    
    // 1. Fetch heatmap from profile page
    let submissionsData = [];
    let response;
    try {
      response = await axios.get(`https://www.codechef.com/users/${encodedUsername}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
        timeout: 7000
      });
      const $ = cheerio.load(response.data);
      $('script').each((i, el) => {
        const scriptContent = $(el).html();
        if (scriptContent && (scriptContent.includes('userDailySubmissionsStats') || scriptContent.includes('userDailySubmissions'))) {
          const match = scriptContent.match(/userDailySubmissions(?:Stats)?\s*=\s*(\[.*?\]);/);
          if (match && match[1]) {
            try {
              submissionsData = JSON.parse(match[1]);
            } catch(e) {}
          }
        }
      });
    } catch (e) {
      console.error('Failed to fetch CodeChef profile heatmap:', e.message);
      throw e;
    }

    // Extract total solved from HTML
    let total_solved = undefined;
    try {
      const matchSolved = response.data.match(/Fully Solved\s*\((\d+)\)/i) || response.data.match(/Total Problems Solved:\s*(\d+)/i);
      if (matchSolved && matchSolved[1]) {
        total_solved = parseInt(matchSolved[1], 10);
      }
    } catch(e) {}

    const submissions = [];
    submissionsData.forEach(item => {
      let dateStr = item.date;
      if (!dateStr) return;
      const dateParts = dateStr.split('-');
      if (dateParts.length === 3) {
        const year = dateParts[0];
        const month = dateParts[1].padStart(2, '0');
        const day = dateParts[2].padStart(2, '0');
        dateStr = `${year}-${month}-${day}`;
      }
      const count = item.count || item.data_count || item.value || 1;
      for (let i = 0; i < count; i++) {
        submissions.push({
          problem_id: `codechef-activity-${dateStr}-${i}`,
          submission_date: dateStr,
          status: 'accepted'
        });
      }
    });

    // 2. Fetch recent activity API to ensure instant streak updates
    try {
      const recentResponse = await axios.get(`https://www.codechef.com/recent/user?page=1&user_handle=${encodedUsername}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000
      });
      
      if (recentResponse.data && recentResponse.data.content) {
        const $recent = cheerio.load(recentResponse.data.content);
        $recent('tr').each((i, el) => {
          const title = $recent(el).find('td').eq(2).find('span').attr('title') || $recent(el).find('td').eq(2).attr('title');
          if (title && (title.toLowerCase().includes('accepted') || title === '100')) {
            const timeStr = $recent(el).find('td').eq(0).attr('title'); // e.g., 11:14 PM 17/07/22
            const problemId = $recent(el).find('td').eq(1).text().trim() || `cc-recent-${i}`;
            
            if (timeStr) {
              const parts = timeStr.split(' ');
              if (parts.length === 3) {
                const dateParts = parts[2].split('/'); // 17/07/22
                if (dateParts.length === 3) {
                  const day = dateParts[0].padStart(2, '0');
                  const month = dateParts[1].padStart(2, '0');
                  const year = `20${dateParts[2]}`; // Assuming 2000s
                  const dateStr = `${year}-${month}-${day}`;
                  
                  // Only add if not duplicate for that day
                  // We just push it; the DB UPSERT handles uniqueness on (user, platform, date, problem_id)
                  submissions.push({
                    problem_id: problemId,
                    submission_date: dateStr,
                    status: 'accepted'
                  });
                }
              }
            }
          }
        });
      }
    } catch (e) {
      console.error('Failed to fetch CodeChef recent activity API:', e.message);
    }

    return {
      total_solved,
      raw: submissionsData,
      submissions: submissions
    };
  } catch (error) {
    console.error('CodeChef fetch error:', error.message);
    throw error;
  }
}

module.exports = { fetchCodechefSubmissions };
