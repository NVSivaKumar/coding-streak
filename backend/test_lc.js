const axios = require('axios');
const query = `
  query recentAcSubmissions($username: String!, $limit: Int!) {
    recentAcSubmissionList(username: $username, limit: $limit) {
      id
      title
      titleSlug
      timestamp
    }
  }
`;
axios.post('https://leetcode.com/graphql', {
  query,
  variables: { username: 'sivas', limit: 5 }
}).then(r => console.log(r.data.data.recentAcSubmissionList)).catch(console.error);
