require('./features.test.js')(true).catch((e) => { console.error(e); process.exitCode = 1; });
