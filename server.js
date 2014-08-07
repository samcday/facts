"use strict";

require("dotenv").load();

// Use bluebird as our Promise API.
global.Promise = require("bluebird");

var koa = require("koa");
var router = require("koa-router");
var humanizeDuration = require("humanize-duration");
var moment = require("moment");
// var Promise = require("bluebird");
var db = require("./db");
var lastfm = require("./lastfm");

var app = koa();
app.use(router(app));

app.get("/lastfm/duration/all", function*() {
  var millis = yield lastfm.duration(0);
  this.body = humanizeDuration(millis);
});

app.get("/lastfm/duration/since", function*() {
  var millis = yield lastfm.duration(this.query.time);
  this.body = humanizeDuration(millis);
});

app.get("/lastfm/day", function*() {
  var from = moment(this.params.date).startOf("day");
  var to = moment(from).add(1, "day");
  var scrobbles = yield db.Scrobble.findAll({
    where: {
      when_scrobbled: {
        between: [from.toDate(), to.toDate()],
      },
      "Song.title": {
        ne: null,
      }
    },
    include: db.Song,
  });

  this.body = scrobbles.map(scrobble => ({
    when: +moment(scrobble.when_scrobbled),
    song_name: scrobble.song.title,
    duration: scrobble.song.duration,
  }));
});

app.get("/lastfm/scrobbles", function*() {
  yield db.ready;

  var scrobbles = yield db.Scrobble.findAll({
    order: "when_scrobbled DESC",
    limit: 100
  });

  this.body = scrobbles;
});

app.get("/lastfm/scrobble/:when", function*() {
  var scrobble = yield db.Scrobble.find({
    when_scrobbled: new Date(this.params.when)
  });

  this.body = scrobble;
});

app.get("/lastfm/artist/:mbid", function*() {
  var artist = yield db.Artist.find({
    where: {
      mbid: this.params.mbid
    },
    include: [
      {
        model: db.Album,
        include: [{
          model: db.AlbumRelease,
          as: "Releases"
        }]
      },
      {
        model: db.ArtistAlias,
        as: "Alias",
      }
    ]
  });

  this.body = artist;
});

app.get("/lastfm/song/:mbid", function*() {
  var song = yield db.Song.find({
    where: {
      mbid: this.params.mbid
    },
    include: [
      {
        model: db.AlbumRelease,
        include: [{
          model: db.Album,
          include: {
            model: db.Artist
          }
        }]
      },
      {
        model: db.Artist
      }
    ]
  });

  this.body = song;
});

app.get("/lastfm/release/:mbid", function*() {
  var release = yield db.AlbumRelease.find({
    where: {
      mbid: this.params.mbid
    },
    include: [
      {
        model: db.Album,
        include: {
          model: db.Artist
        }
      },
      {
        model: db.Song
      }
    ]
  });

  this.body = release;
});

app.listen(3000);
