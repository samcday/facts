"use strict";

var limiter = require("limiter");
var LastFmNode = require("lastfm").LastFmNode;
var mb = Promise.promisifyAll(require("musicbrainz"));
var debug = require("debug")("lastfm");
var db = require("./db");

var replacements = {
  "…": "..."
};

function replace(str) {
  for (var replace of Object.keys(replacements)) {
    str = str.replace(replace, replacements[replace]);
  }
  return str;
}

mb.configure({
  rateLimit: {
    requests: 1,
    interval: 1100
  }
});

var lastfm = new LastFmNode({
  api_key: process.env.LASTFM_KEY,
  useragent: 'facts/samcday.com.au'
});

var lastfmLimiter = new limiter.RateLimiter(1, 1100);

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

  var songMbid = yield exports.loadScrobbleData(scrobbleData);
  if (songMbid) {
    scrobble.raw_data = null;
    scrobble.unclassified = false;
    scrobble.song_mbid = songMbid;
    yield scrobble.save();
  }
});

exports.getArtist = Promise.coroutine(function*(id) {
  debug("Loading artist with id " + id);

  var dbArtist, artist;

  dbArtist = yield db.Artist.find(id);

  if (dbArtist) {
    return dbArtist;
  }

  artist = yield mb.lookupArtistAsync(id, ["aliases"]);

  if (!artist) {
    return false;
  }

  dbArtist = yield db.Artist.create({
    mbid: id,
    name: artist.name
  });

  for (var alias of artist.aliases) {
    var dbAlias = yield db.ArtistAlias.create({
      name: alias
    });
    yield dbAlias.setArtist(dbArtist);
  }

  return dbArtist;
});

exports.getAlbum = Promise.coroutine(function*(id) {
  debug("Loading album with id " + id);

  var dbAlbum, releaseGroup, dbArtists, artistCredit, artist, dbArtist;

  dbAlbum = yield db.Album.find(id);
  if (dbAlbum) {
    return dbAlbum;
  }

  releaseGroup = yield mb.lookupReleaseGroupAsync(id, ["artists"]);
  if (!releaseGroup) {
    debug("Musicbrainz has no release-group with id " + id);
    return false;
  }

  dbArtists = [];

  // Make sure all corresponding artists exists in DB.
  for (artistCredit of releaseGroup.artistCredits) {
    artist = artistCredit.artist;
    dbArtist = yield exports.getArtist(artist.id);
    if (!dbArtist) {
      // TODO: should throw?
      return false;
    }
    dbArtists.push(dbArtist);
  }

  dbAlbum = yield db.Album.create({
    mbid: id,
    name: releaseGroup.title,
    type: releaseGroup.primaryType,
  });

  for (dbArtist of dbArtists) {
    yield dbArtist.addAlbum(dbAlbum);
  }

  return dbAlbum;
});

// Loads album release data from DB, with a fallback to check musicbrainz.
exports.getRelease = Promise.coroutine(function*(id) {
  debug("Loading release with id " + id);

  var dbRelease, release, dbAlbum, medium, track, recording, dbSong, artistCredit, artist, dbArtists, dbArtist;

  dbRelease = yield db.AlbumRelease.find(id);
  if (dbRelease) {
    return dbRelease;
  }

  // Since we're asking for release, might as well suck down all the recordings for it too.
  release = yield mb.lookupReleaseAsync(id, ["artist-credits", "release-groups", "recordings"]);
  if (!release) {
    debug("Music-brainz has no release with id " + id);
    return false;
  }

  // As far as I know, you can never have a release that belongs to more or less than one release group.
  if (release.releaseGroups.length != 1) {
    throw new Error("Release " + id + " has " + release.releaseGroup.length + " release groups");
  }

  // Make sure release group exists in DB too.
  dbAlbum = yield exports.getAlbum(release.releaseGroups[0].id);
  if (!dbAlbum) {
    // TODO: wtf is going on with Musicbrainz? Should this be an error instead?
    return false;
  }

  dbRelease = yield db.AlbumRelease.create({
    mbid: id,
  });

  yield dbAlbum.addRelease(dbRelease);

  dbArtists = {};

  for (medium of release.mediums) {
    for (track of medium.tracks) {
      recording = track.recording;
      dbSong = yield db.Song.findOrCreate({mbid: recording.id}, {
        mbid: recording.id,
        title: recording.title,
        duration: parseInt(recording.length, 10),
      });
      dbSong.addAlbumRelease(dbRelease);

      for (artistCredit of recording.artistCredits) {
        artist = artistCredit.artist;

        dbArtist = dbArtists[artist.id];
        if (!dbArtist) {
          dbArtist = yield exports.getArtist(artist.id);
          if (!dbArtist) {
            throw new Error("Couldn't find artist with mbid " + artist.id + " linked from artist credit of recording " + recording.id);
          }
          dbArtists[artist.id] = dbArtist;
        }

        yield dbSong.addArtist(dbArtist);
        yield dbArtist.addSong(dbSong);
      }
    }
  }

  return dbRelease;
});

// Looks for scrobbles that don't have a song mbid and does its best to fill them in.
exports.repairMissingSongIds = Promise.coroutine(function*(num) {
  var i = 0;

  for (; i < num; i++) {
    // Scrobbles that don't have a song but *do* have an album are pretty easy.
    var withAlbum = yield db.Scrobble.find({
      where: {
        song_mbid: "",
        album_mbid: {
          ne: ""
        }
      },
      order: "repair_attempts ASC"
    });

    debug("Repairing missing song id for scrobble on " + withAlbum.when_scrobbled, withAlbum.song_name, withAlbum.album_mbid);

    var dbRelease = yield exports.getRelease(withAlbum.album_mbid);
    var songs = yield dbRelease.getSongs();

    // Attempt to find a match...
    var searchTitle = replace(withAlbum.song_name).toLowerCase();
    var successful = false;
    for (var song of songs) {
      if (song.title.toLowerCase() === searchTitle) {
        debug("Found missing song id!", song.mbid);

        // Update all other instances.
        yield db.Scrobble.update({
          song_mbid: song.mbid,
        }, {
          song_name: withAlbum.song_name,
          album_mbid: withAlbum.album_mbid,
        });

        successful = true;
        break;
      }
    }

    if (!successful) {
      withAlbum.repair_attempts++;
      yield withAlbum.save();
    }
  }
});
