'use strict';

import client from 'cheerio-httpcli';
import { parseString } from 'xml2js';

import AppData from './AppData';
import Notification from './Notification';
import ReviewData from './ReviewData';
import { formatDate } from './util';

/**
 * レビューの取得・解析処理を行う
 */
export default class Review {

  constructor(outputs, ignoreNotification, config, db) {
    this.outputs = outputs;
    this.ignoreNotification = ignoreNotification;
    this.config = config;
    this.db = db;

    // 国別コードの指定はjaをメインに、jpをサブにする。
    this.lang = this.config.acceptLanguage;
    this.lang_sub = this.lang;
    if (this.lang === "ja") {
      this.lang_sub = "jp"
    } else if (this.lang === "jp") {
      this.lang = "ja"
    }

    // 情報取得元のURLを生成
    this.ios_base_url = "http://itunes.apple.com/" + this.lang_sub + "/rss/customerreviews";

    // 初回通知しないオプション（起動後に設定されたレビュー結果を通知しないためのオプション）
    this.ignoreNotification = ignoreNotification;

    // Google Play Developer API Token
    this.getGoogleAPIToken = this.getGoogleAPIToken.bind(this);

    this.main = this.main.bind(this);
    this.ios = this.ios.bind(this);
    this.android = this.android.bind(this);
    this.noticeAppReview = this.noticeAppReview.bind(this);
    this.createIosUrl = this.createIosUrl.bind(this);
    this.createAndroidUrl = this.createAndroidUrl.bind(this);
    this.createAndroidReviewUrl = this.createAndroidReviewUrl.bind(this);
    this.analyzeIosData = this.analyzeIosData.bind(this);
    this.getIosReview = this.getIosReview.bind(this);
    this.analyzeAndroidData = this.analyzeAndroidData.bind(this);
    this.getAndroidReview = this.getAndroidReview.bind(this);
    this.insertReviewData = this.insertReviewData.bind(this);
    this.pushData = this.pushData.bind(this);
    this.selectRecord = this.selectRecord.bind(this);
  }

  /**
   * reviewetのメイン処理
   *
   * 指定されたiOS/AndroidのアプリIDに対して、レビューの取得処理を実施する。
   * IDが指定されていないOSについては何もしない。
   */
  main() {
    let iosIds = this.config.appId.iOS;
    if (iosIds !== null && !Array.isArray(iosIds)) {
      iosIds = [iosIds];
    }
    this.ios(iosIds);

    let androidIds = this.config.appId.android;
    if (androidIds !== null && !Array.isArray(androidIds)) {
      androidIds = [androidIds];
    }
    this.android(androidIds);
  }

  /**
   * iOSのストアレビューを通知する
   *
   * @param iosIds
   */
  ios(iosIds) {
    if (iosIds !== null) {
      for (let i = 0; i < iosIds.length; i++) {
        let iosId = iosIds[i];
        let ios_url = this.createIosUrl(iosId, 1);
        let iosApp = new AppData("iOS", iosId);

        // iOSアプリのレビューを通知
        this.noticeAppReview(iosApp, ios_url, this.analyzeIosData);
      }
    }
  }

  /**
   * Androidのストアレビューを通知する
   *
   * @param androidIds
   */
  android(androidIds) {
    if (androidIds !== null) {
      for (let i = 0; i < androidIds.length; i++) {
        let androidId = androidIds[i];
        let android_url = this.createAndroidUrl(androidId);
        let androidApp = new AppData("Android", androidId);

        // APIのレスポンスから名称が取れないのでIDを追加しておく
        androidApp.name = "Android " + androidId;

        // Androidはストアサイトから直接データを取得するので、遷移先のURLにそのまま使う
        androidApp.url = android_url;

        // Androidアプリのレビューを通知
        let android_review_url = this.createAndroidReviewUrl(androidId);
        this.noticeAppReview(androidApp, android_review_url, this.analyzeAndroidData);
      }
    }
  }

  /**
   * 対象OSのアプリレビューを取得して通知する
   *
   * @param appData
   * @param url
   * @param appfunc OS別のレビュー取得処理
   */
  noticeAppReview(appData, url, appfunc) {
    let outputs = this.outputs;
    const config = this.config;
    const useSlack = config.slack.use;
    const useEmail = config.email.use;

    // アプリのレビューデータを取得
    let param = {};
    client.fetch(url, param, (err, $, res) => {
      if (err) {
        console.log(formatDate(new Date(), "YYYY/MM/DD hh:mm:ss") + " Error:", err);
        return;
      }

      appfunc($, appData).then((reviewData) => {

        const notification = new Notification(appData, reviewData, config);

        // 表示件数制御
        if (outputs >= 0 && reviewData !== null && reviewData.length > outputs) {
          reviewData.length = outputs;
        }
        if (useSlack) {
          notification.slack();
        }

        if (useEmail) {
          notification.email();
        }
      });
    });
  }

  /**
   * iOSアプリのレビューデータ取得元のURLを生成する。
   * @param appId 取得対象アプリのAppStore ID
   * @param page ページング
   */
  createIosUrl(appId, page) {
    let url;
    if (page !== null && page > 0) {
      url = this.ios_base_url + "/page=" + page + "/id=" + appId + "/sortBy=mostRecent/xml";
    } else {
      url = this.ios_base_url + "/id=" + appId + "/sortBy=mostRecent/xml";
    }

    return url;
  }

  /**
   * AndroidアプリのGooglePlayリンク
   * @param appId 取得対象アプリのGooglePlay ID
   */
  createAndroidUrl(appId) {
    return "https://play.google.com/store/apps/details?id=" + appId + "&hl=" + this.lang;
  }

  /**
   * AndroidアプリのレビューLIST取得API
   * @param appId 取得対象アプリのGooglePlay ID
   */
  createAndroidReviewUrl(appId) {
    return "https://www.googleapis.com/androidpublisher/v3/applications/" + appId
      + "/reviews?access_token=" + this.getGoogleAPIToken() + "&maxResults=1000";
  }

  /**
   * Google API用のトークンをファイルから読み込み
   */
  getGoogleAPIToken() {
    const fs = require('fs');
    const token = process.cwd() + "/api.token";
    return fs.readFileSync(token, 'utf-8').trim();
  }

  /**
   * iOSのレビュー情報を解析して、整形したレビューデータを返却する。
   */
  analyzeIosData($, appData) {

    return new Promise((resolve, reject) => {
      // RSSの内容を解析してレビューデータを作成
      const reviewDataXml = $.xml();
      let reviewDatas = [];
      parseString(reviewDataXml, (err, result) => {

        // アプリレビューがない場合は終了
        if (result.feed.entry === null) {
          resolve(reviewDatas);
        }

        // アプリ情報を設定
        appData.name = result.feed.entry[0]['im:name'];
        appData.url = result.feed.entry[0].link[0].$.href;

        // レビュー情報を設定
        let reviewProcess = [];
        for (let i = 1; i < result.feed.entry.length; i++) {
          const entry = result.feed.entry[i];
          reviewProcess.push(this.getIosReview(appData, entry));
        }
        Promise.all(reviewProcess).then((datas) => {
          let returnData = [];
          for (let i = 0; i < datas.length; i++) {
            if (datas[i] !== null) {
              returnData.push(datas[i]);
            }
          }
          resolve(returnData);
        });
      });
    });
  }

  /**
   * iOSのレビュー情報の解析処理。
   * 取得したレビュー情報が新規であればDBに保存し、通知用データとして返却する。
   */
  getIosReview(appData, entry) {

    return new Promise((resolve, reject) => {
      let param = [];

      // Android側の制御にあわせて日付を文字列で保持する
      param.updated = formatDate(new Date(entry.updated[0]), "YYYY/MM/DD hh:mm:ss");
      param.reviewId = entry.id[0];
      param.title = entry.title[0];
      param.message = entry.content[0]._;
      param.rating = entry['im:rating'];
      param.version = entry['im:version'] + ''; // 文字列に変換

      let reviewData = new ReviewData(param);

      // DBに登録を試みて、登録できれば新規レビューなので通知用レビューデータとして返却する
      this.insertReviewData(appData, reviewData).then((result) => {
        this.pushData(result, reviewData).then((data) => {
          resolve(data)
        });
      });
    });
  }


  /**
   * Androindのレビュー情報を解析して、整形したレビューデータを返却する。
   * ※Androidは$をそのまま使って処理してみる
   *
   * @param $
   * @param appData
   * @returns {Promise}
   */
  analyzeAndroidData($, appData) {

    return new Promise((resolve, reject) => {

      // レビュー本文の後ろにくる「全文を表示」を削除
      //$('div.review-link').remove();
      const json = JSON.parse($.text());

      // レビュー情報を設定
      let reviewProcess = [];
      json.reviews.forEach(review => {
        reviewProcess.push(this.getAndroidReview($, appData, review));
      })
      Promise.all(reviewProcess).then((data) => {
        let returnData = [];
        for (let i=0; i < data.length; i++) {
          if (data[i] !== null) {
            returnData.push(data[i]);
          }
        }
        resolve(returnData);
      });

    });
  }


  /**
   * Androidのレビュー情報の解析処理。
   * 取得したレビュー情報が新規であればDBに保存し、通知用データとして返却する。
   *
   * @param $
   * @param appData
   * @param element
   * @returns {Promise}
   */
  getAndroidReview($, appData, review) {
    return new Promise((resolve, reject) => {
      let param = [];
      const userComment = review.comments[0].userComment;

      param.reviewId = review.reviewId;
      param.updated = userComment.lastModified.seconds;
      param.rating = userComment.starRating;
      param.version = userComment.appVersionName;
      param.title = appData.appId
      param.message = userComment.text;

      const reviewData = new ReviewData(param);

      // DBに登録を試みて、登録できれば新規レビューなので通知用レビューデータとして返却する
      this.insertReviewData(appData, reviewData).then((result) => {
        this.pushData(result, reviewData).then((data) => {
          resolve(data)
        });
      });
    });
  }

  /**
   * レビューデータをDBに保存する。
   * テーブルにレビューIDがすでに存在する場合は登録処理をしないでfalseを返す。
   * Insertできた場合はtrueを返す。
   *
   * @param appData
   * @param reviewData
   * @returns {Promise}
   */
  insertReviewData(appData, reviewData) {

    return new Promise((resolve, reject) => {
      this.selectRecord(reviewData, appData.kind).then((result) => {

        // レコードの有無をチェックする
        if (result[0].cnt === 0) {

          // 挿入用プリペアドステートメントを準備
          const ins_androidReview =
            "INSERT INTO review(id, kind, app_name, title, message, rating, updated, version, create_date) " +
            "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)";

          const values = [reviewData.reviewId, appData.kind, appData.name, reviewData.title, reviewData.message,
              reviewData.rating, reviewData.updated, reviewData.version, new Date()];

          this.db.query(ins_androidReview, values, (e, res, fields) => {
            if (e) {
              console.log(e);
            }
          });

          resolve(true);
        } else {
          resolve(false);
        }
      }).catch((err) => {
        console.log('DB Failure:', err);
        reject(false);
      });
    });
  }

  /**
   * 通知対象とするかの判定処理
   *
   * @param result
   * @param reviewData
   * @returns {Promise}
   */
  pushData(result, reviewData) {
    return new Promise((resolve, reject) => {
      // DB登録ができて通知可能な場合に、通知対象とする
      if (result && !this.ignoreNotification) {
        resolve(reviewData);
      } else {
        // レビュー情報が重複している、または通知しないオプションが付いていれば通知対象にしない
        resolve(null);
      }
    });
  }

  /**
   * レビュー情報がすでにDBに存在しているかを調べる。
   * レビューIDでのカウント数を返す。（0 or 1）
   *
   * @param condition チェック対象のレビューデータ
   * @param kind アプリのOS種別
   */
  selectRecord(condition, kind) {
    return new Promise((resolve, reject) => {
      this.db.query('SELECT count(*) as cnt FROM review WHERE id = ? AND kind = ?', [condition.reviewId, kind], (err, res, fields) => {
        if (err) {
          return reject(err);
        }
        resolve(res);
      });
    });
  }
}
