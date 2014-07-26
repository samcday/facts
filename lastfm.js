var limiter = require("limiter");
var LastFmNode = require("lastfm").LastFmNode;
var mb = Promise.promisifyAll(require("musicbrainz"));
var debug = require("debug")("lastfm");
var db = require("./db");

// When looking up a release for a song, we can get many results.
// We pick the first one that matches the first country we find in this list,
// in order. If none match, we just pick the first one.
var preferredCountry = ["AU", "US"];

mb.configure({
  rateLimit: {
    requests: 1,
    interval: 2000
  }
});

var lastfm = new LastFmNode({
  api_key: process.env.LASTFM_KEY,
  useragent: 'facts/samcday.com.au'
});

var lastfmLimiter = new limiter.RateLimiter(1, 2000);

function lastfmReq(name, params) {
  var limitPromise = new Promise(function(resolve, reject) {
    lastfmLimiter.removeTokens(1, function(err) {
      if (err) return reject(err);
      return resolve();
    });
  });

  return limitPromise.then(function() {
    return new Promise(function(resolve, reject) {
      params.handlers = {
        success: resolve,
        error: function(error) {
          reject(new Error(error.message));
        }
      };

      lastfm.request(name, params);
    });
  });
}

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

// Looks up a song by mbid. If it's not in DB, Musicbrainz is consulted.
exports.lookupSong = Promise.coroutine(function*(mbid, ctx) {
  // Songs won't exist in DB unless they are fully formed.
  var dbSong = yield db.Song.count(mbid);

  if (dbSong) {
    // Song mbid is valid, and in db already. We're done!
    return true;
  }

  // Not in DB yet. Let's go find it. When we do, let's include all the other
  // good stuff, like artists + releases + release groups.
  var song = yield mb.lookupRecordingAsync(mbid, ["releases", "artists"]);

  dbSong = yield db.Song.create({
    mbid: mbid,
    title: song.title,
    duration: parseInt(song.length, 10)
  });

  // Check if artist(s) in DB.
  for (var artistCredit of song.artistCredits) {
    var artist = artistCredit.artist;
    var dbArtist = yield db.Artist.findOrCreate({mbid: artist.id}, {
      mbid: artist.id,
      name: artist.name,
    });
    yield dbSong.addArtist(dbArtist);
    yield dbArtist.addSong(dbSong);
  }

  return true;
});

// Given a particular scrobble, this function will ensure the corresponding
// track / album / artist have all been populated in the DB. In some cases
// there is no musicbrainz ids provided by lastfm. When this happens we do
// lookups in the MusicBrainz DB itself.
exports.loadScrobbleData = Promise.coroutine(function*(scrobble) {
  scrobble.artist = scrobble.artist || {};
  scrobble.album = scrobble.album || {};

  var ctx = {
    artistMbid: scrobble.artist.mbid,
    albumMbid: scrobble.album.mbid,
    songMbid: scrobble.mbid,
  };

  // Start with song. If we have an mbid for it, then everything else is trivial
  if (ctx.songMbid) {
    if (yield lookupSong(ctx.songMbid, ctx)) {
      return ctx.songMbid;
    }
  }

  return false;
});

// Loads num historic scrobbles from Last.fm and populates DB.
exports.backfill = Promise.coroutine(function*(num) {
  yield db.ready;

  var queryTo = Date.now();

  var lastScrobble = yield db.Scrobble.find({
    order: "when_scrobbled ASC",
    attributes: ["when_scrobbled"],
  });

  if (lastScrobble !== null) {
    queryTo = +new Date(lastScrobble.when_scrobbled);
  }

  queryTo = Math.round(queryTo / 1000);

  debug("Backfilling tracks since " + queryTo + " from last.fm server...");
  var scrobbles = yield lastfmReq("user.getRecentTracks", {
    user: process.env.LASTFM_USER,
    to: queryTo,
    limit: num || 100
  });
  scrobbles = scrobbles.recenttracks.track;

  debug("Backfilling " + scrobbles.length + " scrobbles");

  var dbScrobbles = [];

  for (var scrobble of scrobbles) {
    if (scrobble["@attr"] && scrobble["@attr"].nowplaying === "true") {
      // TODO: skip nowplaying for now.
      continue;
    }

    dbScrobbles.push({
      when_scrobbled: new Date(scrobble.date.uts * 1000),
      song_name: scrobble.name,
      song_mbid: scrobble.mbid,
      album_name: scrobble.album["#text"],
      album_mbid: scrobble.album.mbid,
      artist_name: scrobble.artist["#text"],
      artist_mbid: scrobble.artist.mbid,
      unclassified: true,
    });
  }

  if (dbScrobbles.length) {
    yield db.Scrobble.bulkCreate(dbScrobbles);
  }

  return dbScrobbles.length;
});

exports.repairScrobble = Promise.coroutine(function*(id) {
  var scrobble = yield db.Scrobble.find(id);
  var scrobbleData = JSON.parse(scrobble.raw_data);
  console.log(scrobbleData);

  var songMbid = yield exports.loadScrobbleData(scrobbleData);
  if (songMbid) {
    scrobble.raw_data = null;
    scrobble.unclassified = false;
    scrobble.song_mbid = songMbid;
    yield scrobble.save();
  }
});
