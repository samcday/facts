var LastFmNode = require("lastfm").LastFmNode;
var mb = Promise.promisifyAll(require("musicbrainz"));
var debug = require("debug")("lastfm");
var db = require("./db");

var lastfm = new LastFmNode({
  api_key: process.env.LASTFM_KEY,
  useragent: 'facts/samcday.com.au'
});

function lastfmReq(name, params) {
  return new Promise(function(resolve, reject) {
    params.handlers = {
      success: resolve,
      error: function(error) {
        reject(new Error(error.message));
      }
    };

    lastfm.request(name, params);
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

// Given a particular scrobble, this function will ensure the corresponding
// track / album / artist have all been populated in the DB. In some cases
// there is no musicbrainz ids provided by lastfm. When this happens we do
// lookups in the MusicBrainz DB itself.
exports.loadScrobbleData = Promise.coroutine(function*(scrobble) {
  // Start with the artist.
  scrobble.artist = scrobble.artist || {};
  scrobble.album = scrobble.album || {};

  var artistMbid = scrobble.artist.mbid,
      artistName = scrobble.artist.name,
      albumMbid = scrobble.album.mbid,
      albumName = scrobble.album["#text"],
      songMbid = scrobble.mbid,
      songName = scrobble.name;

  if (!artistMbid) {
    if (!artistName) {
      debug("Found artist with no mbid OR name. Wtf.", scrobble);
      return false;
    }
    debug("Fetching artist mbid for " + artistName);
    var artistMB = yield mb.searchArtistsAsync('"' + artistName + '"', {});

    if (artistMB.length !== 1) {
      debug("Ambiguous artist match when looking up mbid.", scrobble);
      return false;
    }

    artistMB = artistMB[0];

    artistMbid = artistMB.id;
    artistName = artistMB.name;
  }

  yield db.LastfmArtist.findOrCreate({mbid: artistMbid}, {
    mbid: artistMbid,
    name: artistName,
  });

  if (!albumMbid || !albumName) {
    debug("No mbid/name for album! I wasn't trained for this!", scrobble);
    return false;
  }

  yield db.LastfmAlbum.findOrCreate({mbid: albumMbid}, {
    mbid: albumMbid,
    name: albumName,
    image: findImageName(scrobble.image),
    artist_mbid: artistMbid,
  });

  if (!songMbid) {
    if (!songName) {
      debug("Found song with no mbid OR name. Wtf.", scrobble);
      return false;
    }
    debug("Fetching song mbid for " + songName);
    var songMB = yield mb.searchRecordingsAsync('"' + songName + '"', {
      reid: albumMbid
    });

    if (songMB.length !== 1) {
      debug("Ambiguous song match when looking up mbid.", scrobble);
      return false;
    }

    songMB = songMB[0];

    songMbid = songMB.id;
    songName = songMB.name;
  }

  yield db.LastfmSong.findOrCreate({mbid: songMbid}, {
    mbid: songMbid,
    title: songName,
    album_mbid: albumMbid,
  });

  return songMbid;
});

exports.backfill = Promise.coroutine(function*() {
  yield db.ready;

  var lastScrobble = yield db.LastfmScrobble.find({ order: "when_scrobbled ASC" });
  var queryTo = Date.now();

  if (lastScrobble !== null) {
    queryTo = +new Date(lastScrobble.when_scrobbled);
  }

  queryTo = Math.round(queryTo / 1000);

  debug("Fetching tracks from last.fm server...");
  var scrobbles = yield lastfmReq("user.getRecentTracks", {
    user: process.env.LASTFM_USER,
    to: queryTo,
    limit: 20,
    extended: true,
  });
  scrobbles = scrobbles.recenttracks.track;

  debug("Backfilling " + scrobbles.length + " scrobbles");

  for (var i = 0; i < scrobbles.length; i++) {
    var scrobble = scrobbles[i];
    if (scrobble["@attr"] && scrobble["@attr"].nowplaying === "true") {
      // TODO: skip nowplaying for now.
      continue;
    }

    var scrobbleData = {
      song_mbid: yield exports.loadScrobbleData(scrobble),
      when_scrobbled: new Date(scrobble.date.uts * 1000)
    };

    if (!scrobbleData.song_mbid) {
      scrobbleData.song_mbid = null;
      scrobbleData.unclassified = true;
      scrobbleData.raw_data = JSON.stringify(scrobble);
    }

    yield db.LastfmScrobble.create(scrobbleData);
  }
});
