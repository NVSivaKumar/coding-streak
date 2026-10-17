const str = 'userDailySubmissions = [{"date":"1"}, {"date":"2"}];';
console.log(str.match(/userDailySubmissions(?:Stats)?\s*=\s*(\[.*?\]);/)[1]);
