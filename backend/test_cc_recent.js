const data = require('./codechef_recent.json');
const cheerio = require('cheerio');
const $ = cheerio.load(data.content);
$('tr').slice(1, 10).each((i, el) => {
  const time = $(el).find('td').eq(0).attr('title');
  const img = $(el).find('td').eq(2).find('img').attr('src');
  console.log(time, img);
});
