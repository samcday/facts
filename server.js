"use strict";

require("dotenv").load();

var koa = require("koa");
var router = require("koa-router");
var Sequelize = require("sequelize");
var LastFmNode = require("lastfm").LastFmNode;
var Promise = require("bluebird");

var lastfm = new LastFmNode({
  api_key: process.env.LASTFM_KEY,
  useragent: 'facts/samcday.com.au'
});

var sequelize = new Sequelize(process.env.DB_URL);

var mbidValidation = {
  len: 36
};

var LastfmScrobble = sequelize.define("LastfmScrobble", {
  song_mbid: {
    type: Sequelize.STRING(36),
    allowNull: false,
    validate: mbidValidation,
  },
  when_scrobbled: Sequelize.DATE,
});

var LastfmSong = sequelize.define("LastfmSong", {
  mbid: {
    type: Sequelize.STRING(36),
    primaryKey: true,
    validate: mbidValidation,
  },
  title: Sequelize.STRING,
  album_mbid: {
    type: Sequelize.STRING(36),
    validate: mbidValidation,
  },
});

var LastfmAlbum = sequelize.define("LastfmAlbum", {
  mbid: {
    type: Sequelize.STRING(36),
    primaryKey: true,
    validate: mbidValidation,
  },
  title: Sequelize.STRING,
  artist_mbid: {
    type: Sequelize.STRING(36),
    validate: mbidValidation,
  },
});

var LastfmArtist = sequelize.define("LastfmArtist", {
  mbid: {
    type: Sequelize.STRING(36),
    primaryKey: true,
    validate: mbidValidation,
  },
  title: Sequelize.STRING,
})

sequelize.sync({ force: true }).success(function() {
  
});

function lastfmReq(name, params) {
  return new Promise(function(resolve, reject) {
    params.handlers = {
      success: resolve,
      error: function(error) {
        reject(new Error(error.message))
      }
    };

    lastfm.request(name, params)
  });
}

var app = koa();

app.use(router(app));

app.get("/lastfm/backfill", function*() {
  var lastScrobble = yield LastfmScrobble.find({ order: "when_scrobbled DESC" });
  this.body = lastScrobble;
});

app.listen(3000);
