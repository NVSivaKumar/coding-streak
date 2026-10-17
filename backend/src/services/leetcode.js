const axios = require('axios');

async function fetchLeetCodeSubmissions(username) {
  const query = `
    query leetcodeData($username: String!, $limit: Int!) {
      recentAcSubmissionList(username: $username, limit: $limit) {
        id
        title
        titleSlug
        timestamp
      }
      matchedUser(username: $username) {
        submitStatsGlobal {
          acSubmissionNum {
            difficulty
            count
          }
        }
      }
    }
  `;

  try {
    const response = await axios.post('https://leetcode.com/graphql', {
      query,
      variables: { username, limit: 50 }
    }, {
      timeout: 7000
    });

    if (response.data?.errors) {
      throw new Error(response.data.errors[0].message);
    }

    const submissions = response.data?.data?.recentAcSubmissionList || [];
    
    let total_solved = undefined;
    const acSubmissionNum = response.data?.data?.matchedUser?.submitStatsGlobal?.acSubmissionNum;
    if (acSubmissionNum) {
      const allStats = acSubmissionNum.find(item => item.difficulty === 'All');
      if (allStats) total_solved = allStats.count;
    }

    return {
      total_solved,
      raw: submissions,
      submissions: submissions.map(sub => ({
        problem_id: sub.titleSlug,
        submission_date: new Date((sub.timestamp * 1000) + (5.5 * 60 * 60 * 1000)).toISOString().split('T')[0],
        status: 'accepted'
      }))
    };
  } catch (error) {
    console.error('LeetCode fetch error:', error.message);
    throw error;
  }
}

module.exports = { fetchLeetCodeSubmissions };
