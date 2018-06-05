'use strict';

process.on('unhandledRejection', console.dir);

// モジュールの取り込み
import config from 'config';
import { CronJob } from 'cron';

import Review from './Review';

const CRON_TIME = config.cron.time;
const TIME_ZONE = config.cron.timeZone;
const DB_PATH = process.cwd() + "/reviewet.sqlite";

// 通知しない設定
let ignoreNotification = config.firstTimeIgnore;
let outputs = config.outputs;

// DB作成
const mysql = require('mysql');
const db = mysql.createConnection({
    host     : config.mysql.host,
    user     : config.mysql.user,
    password : config.mysql.password,
    database : config.mysql.database
});
db.connect();

try {
  new CronJob("* */30 * * * *", function() {
    const exec = require('child_process').exec;
    exec(process.cwd() + "/shell/refresh_token.sh", (e, stdout, stderr) => {
        if (e) {
          console.log(e);
        }
        console.log(stdout);
    });
  }, null, true, TIME_ZONE);
} catch (ex) {
  console.log("cron pattern not valid");
}

try {
  //  const CronJob = require('cron').CronJob;
  new CronJob(CRON_TIME, function() {

    // 未設定の場合は全件表示
    if (outputs === null) {
      outputs = -1;
    }
    // 文字列から数値変換
    else {
      outputs = parseInt(outputs);
    }

    try {
      let app = new Review(outputs, ignoreNotification, config, db);
      app.main();
    } catch (e) {
      console.log("application error: " + e);
    }

    // 通知しない設定をオフにする
    ignoreNotification = false;
    outputs = -1;

  }, null, true, TIME_ZONE);
} catch (ex) {
  console.log("cron pattern not valid");
}
