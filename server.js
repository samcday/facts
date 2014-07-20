"use strict";

require("dotenv").load();

// Use bluebird as our Promise API.
global.Promise = require("bluebird");

var koa = require("koa");
var router = require("koa-router");
// var Promise = require("bluebird");
var db = require("./db");
var lastfm = require("./lastfm");

var app = koa();
app.use(router(app));

app.get("/lastfm/backfill", function*() {
  this.body = newScrobbles;
});

// app.get("/lastfm/artist/:mbid", function*() {
//   var artistInfo = yield lastfmReq("artist.getInfo", {
//     mbid: this.params.mbid
//   });

//   artistInfo = artistInfo.artist;

//   var artist = yield db.LastfmArtist.create({
//     mbid: artistInfo.mbid,
//     name: artistInfo.name,
//   });

//   this.body = artist;
// });

// app.get("/lastfm/album/:mbid", function*() {
//   var albumInfo = yield lastfmReq("album.getInfo", {
//     mbid: this.params.mbid,
//   });

//   albumInfo = albumInfo.album;

//   var album = yield LastfmAlbum.create({
//     mbid: albumInfo.mbid,
//   })
// });

app.get("/lastfm/scrobbles", function*() {
  yield db.ready;

  var scrobbles = yield db.LastfmScrobble.findAll({
    order: "when_scrobbled DESC",
    limit: 10,
    include: {
      model: db.LastfmSong,
      as: "Song",
      include: [
        {
          model: db.LastfmAlbum,
          as: "Album"
        },
        {
          model: db.LastfmArtist,
          as: "Artist"
        },
      ]
    }
  });

  this.body = scrobbles;
});

app.get("/lastfm/scrobble/:when", function*() {
  var scrobble = yield db.LastfmScrobble.find({
    when_scrobbled: new Date(this.params.when)
  });

  this.body = scrobble;
});

app.get("/lastfm/song/:mbid", function*() {
  var song = yield db.LastfmSong.find({
    mbid: this.params.mbid,
    include: {
      model: db.LastfmAlbum,
      include: {
        model: db.LastfmArtist
      }
    }
  });

  this.body = song;
});

app.listen(3000);
