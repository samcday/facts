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
  // song_mbid: {
  //   type: Sequelize.STRING(36),
  //   allowNull: false,
  //   validate: mbidValidation,
  // },
  when_scrobbled: Sequelize.DATE,
}, {underscored: true});

var LastfmSong = sequelize.define("LastfmSong", {
  mbid: {
    type: Sequelize.STRING(36),
    primaryKey: true,
    validate: mbidValidation,
  },
  title: Sequelize.STRING,
  // album_mbid: {
  //   type: Sequelize.STRING(36),
  //   validate: mbidValidation,
  // },
}, {underscored: true});

var LastfmAlbum = sequelize.define("LastfmAlbum", {
  mbid: {
    type: Sequelize.STRING(36),
    primaryKey: true,
    validate: mbidValidation,
  },
  name: Sequelize.STRING,
  image: Sequelize.STRING, 
  // artistMbid: {
  //   type: Sequelize.STRING(36),
  //   validate: mbidValidation,
  // },
}, {underscored: true});

var LastfmArtist = sequelize.define("LastfmArtist", {
  mbid: {
    type: Sequelize.STRING(36),
    primaryKey: true,
    validate: mbidValidation,
  },
  name: Sequelize.STRING,
  image: Sequelize.STRING,
}, {underscored: true});

// LastfmSong.belongsTo(LastfmAlbum, { foreignKey: "album_mbid" });
// LastfmAlbum.belongsTo(LastfmArtist, { foreignKey: "artist_mbid" });

LastfmArtist.hasMany(LastfmAlbum, { foreignKey: "artist_mbid" });
LastfmAlbum.belongsTo(LastfmArtist, { foreignKey: "artist_mbid" });

LastfmAlbum.hasMany(LastfmSong, { foreignKey: "album_mbid" });
LastfmSong.belongsTo(LastfmAlbum, { foreignKey: "album_mbid" });

LastfmSong.hasOne(LastfmScrobble, { foreignKey: "song_mbid" });

sequelize.sync({  });

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
  var lastScrobble = yield LastfmScrobble.find({ order: "when_scrobbled ASC" }).run();
  var queryTo = Date.now();

  if (lastScrobble !== null) {
    queryTo = +new Date(lastScrobble.when_scrobbled);
  }

  queryTo = Math.round(queryTo / 1000);

  var scrobbles = yield lastfmReq("user.getRecentTracks", {
    user: process.env.LASTFM_USER,
    to: queryTo,
    limit: 50,
    extended: true,
  });
  scrobbles = scrobbles.recenttracks;

  var newScrobbles = [];
  var songs = {};
  var albums = {};
  var artists = {};

  scrobbles.track.forEach(function(scrobble) {
    if (scrobble["@attr"] && scrobble["@attr"].nowplaying === "true") {
      // TODO: skip nowplaying for now.
      return;
    }

    newScrobbles.push({
      song_mbid: scrobble.mbid,
      when_scrobbled: new Date(scrobble.date.uts * 1000)
    });

    if (!songs[scrobble.mbid]) {
      songs[scrobble.mbid] = {
        mbid: scrobble.mbid,
        title: scrobble.name,
        album_mbid: scrobble.album.mbid,
      };
    }

    if (!albums[scrobble.album.mbid]) {
      albums[scrobble.album.mbid] = {
        mbid: scrobble.album.mbid,
        name: scrobble.album["#text"],
        image: findImageName(scrobble.image),
        artist_mbid: scrobble.artist.mbid,
      };
    }

    if (!artists[scrobble.artist.mbid]) {
      artists[scrobble.artist.mbid] = {
        mbid: scrobble.artist.mbid,
        name: scrobble.artist.name,
        image: findImageName(scrobble.artist.image),
      };
    }
  });

  yield LastfmScrobble.bulkCreate(newScrobbles);

  var songIds = Object.keys(songs);
  for (var i = 0; i < songIds.length; i++) {
    yield LastfmSong.findOrCreate({mbid: songIds[i]}, songs[songIds[i]]);
  }

  var albumIds = Object.keys(albums);
  for (var i = 0; i < albumIds.length; i++) {
    yield LastfmAlbum.findOrCreate({mbid: albumIds[i]}, albums[albumIds[i]]);
  }

  var artistIds = Object.keys(artists);
  for (var i = 0; i < artistIds.length; i++) {
    yield LastfmArtist.findOrCreate({mbid: artistIds[i]}, artists[artistIds[i]]);
  }

  this.body = newScrobbles;
});

app.get("/lastfm/artist/:mbid", function*() {
  var artistInfo = yield lastfmReq("artist.getInfo", {
    mbid: this.params.mbid
  });

  artistInfo = artistInfo.artist;

  var artist = yield LastfmArtist.create({
    mbid: artistInfo.mbid,
    name: artistInfo.name,
  });

  this.body = artist;
});

function findImageName(images) {
  var name;
  images.some(function(image) {
    var match = /serve\/[0-9s]*\/(.*)$/.exec(image["#text"]);
    if (match) {
      name = match[1];
      return true;
    }
  });

  return name;
}

// app.get("/lastfm/album/:mbid", function*() {
//   var albumInfo = yield lastfmReq("album.getInfo", {
//     mbid: this.params.mbid,
//   });

//   albumInfo = albumInfo.album;

//   var album = yield LastfmAlbum.create({
//     mbid: albumInfo.mbid,
//   })
// });

app.get("/lastfm/scrobble/:when", function*() {
  var scrobble = yield LastfmScrobble.find({
    when_scrobbled: new Date(this.params.when)
  });

  this.body = scrobble;
});

app.get("/lastfm/song/:mbid", function*() {
  var song = yield LastfmSong.find({
    mbid: this.params.mbid,
    include: {
      model: LastfmAlbum,
      include: {
        model: LastfmArtist
      }
    }
  });

  this.body = song;
});

app.listen(3000);
