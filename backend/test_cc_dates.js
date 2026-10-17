const data = require('./codechef_recent.json');
const cheerio = require('cheerio');
const $ = cheerio.load(data.content);
const res = new Set();
$('tr').each((i, el) => {
  res.add($(el).find('td').eq(0).attr('title'));
});
console.log([...res].slice(0, 5));
