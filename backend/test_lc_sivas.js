const axios = require('axios');
axios.post('https://leetcode.com/graphql', {
  query: '{ matchedUser(username: "sivas") { submitStats { acSubmissionNum { difficulty count } } } }'
}).then(r => console.log(JSON.stringify(r.data))).catch(console.error);
