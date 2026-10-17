const axios = require('axios');

async function fetchCodeforcesSubmissions(username) {
  try {
    const response = await axios.get(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(username)}&from=1`, {
      timeout: 15000 
    });

    if (response.data?.status !== 'OK') {
      throw new Error('Failed to fetch from Codeforces');
    }

    const submissions = response.data?.result || [];
    const acceptedSubmissions = submissions.filter(sub => sub.verdict === 'OK');

    const solvedSet = new Set();
    acceptedSubmissions.forEach(sub => {
      solvedSet.add(`${sub.problem?.contestId || 0}-${sub.problem?.index || 'A'}`);
    });
    const total_solved = solvedSet.size;

    return {
      total_solved,
      raw: submissions.slice(0, 100),
      submissions: acceptedSubmissions.slice(0, 500).map(sub => ({
        problem_id: `${sub.problem?.contestId || 0}-${sub.problem?.index || 'A'}`,
        submission_date: new Date(((sub.creationTimeSeconds || 0) * 1000) + (5.5 * 60 * 60 * 1000)).toISOString().split('T')[0],
        status: 'accepted'
      }))
    };
  } catch (error) {
    console.error('Codeforces fetch error:', error.message);
    throw error;
  }
}

module.exports = { fetchCodeforcesSubmissions };
