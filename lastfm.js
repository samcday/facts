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

// // Given a scrobble with no artist mbid present, try to determine what the
// // ID is.
// var loadArtist = Promise.coroutine(function*(scrobble) {
//   // See if we already have the artist in local db.
//   // Because there could be ambiguities (multiple artists with same name), we
//   // only try this approach if we have an album or song name we can use to
//   // disambiguate the query.
//   var artistName = scrobble.artist.name,
//       albumMbid = scrobble.album.mbid,
//       songMbid = scrobble.mbid;

//   if (albumMbid || songMbid) {
//     var criteria = [];
//     var include = [];

//     if (albumMbid) {
//       include.push({
//         model: db.Album,
//         as: "Album"
//       });
//       criteria.push({
//         "Album.mbid": albumMbid
//       });
//     }

//     if (songMbid) {
//       include.push({
//         model: db.Song,
//         as: "Song"
//       });
//       criteria.push({
//         "Song.mbid": songMbid
//       }); 
//     }

//     var existingArtist = yield LastfmArtist.find({
//       where: Sequelize.or.apply(Sequelize, criteria),
//       include: include
//     });

//     if (existingArtist) {
//       return [true, existingArtist.mbid, existingArtist.name];
//     }
//   }

//   // Only need to proceed with a musicbrainz search if we didn't find it in DB
//   debug("Fetching artist mbid for " + artistName);
//   var artistMB = yield mb.searchArtistsAsync('"' + artistName + '"', {});

//   if (artistMB.length !== 1) {
//     debug("Ambiguous artist match when looking up mbid.", scrobble);
//     return [false, false, false];
//   }

//   artistMB = artistMB[0];
//   return [false, artistMB.id, artistMB.name];
// });

// var loadAlbum = Promise.coroutine(function*(scrobble) {
//   var artistMbid = scrobble.artist.mbid,
//       artistName = scrobble.artist.name,
//       albumMbid = scrobble.album.mbid,
//       albumName = scrobble.album["#text"],
//       songMbid = scrobble.mbid;

//   // If we have a song / album mbid, we can try looking up the album in DB.
//   if (artistMbid || songMbid) {

//   }

//   debug("Looking up album mbid for " + albumName);
//   var albumLookup = yield mb.searchReleasesAsync('"' + albumName + '"', {arid: artistMbid});

//   if (albumLookup.length === 1) {
//     albumMbid = albumLookup[0].id;
//     albumName = albumLookup[0].title;
//   }
// });

// Looks up a song by mbid. If it's not in DB, Musicbrainz is consulted.
exports.lookupSong = Promise.coroutine(function*(mbid, ctx) {
  // Songs won't exist in DB unless they are fully formed.
  var dbSong = yield db.Song.count(mbid);

  if (dbSong) {
    // Song mbid is valid, and in db already. We're done!
    return true;
  }

  // Not in DB yet. Let's go find it.
  var song = yield mb.lookupRecordingAsync(mbid, ["releases"]);

  // dbSong = yield db.Song.create({
  //   mbid: mbid,
  //   title: song.title,
  //   duration: parseInt(song.length, 10)
  // });

  // Okay, now let's go through all the releases for this song and stick
  // 'em in the db.
  var releases = yield mb.browseReleasesAsync("recording", song.id, ["recordings", "release-groups"]);

  for (var release of releases) {
    // Save the release-group if it doesn't yet exist.
    // TODO: handle non-existent release group / more than one release group?
    var releaseGroup = release.releaseGroups[0];
    var dbAlbum = yield db.Album.findOrCreate({mbid: releaseGroup.id}, {
      mbid: releaseGroup.id,
      name: releaseGroup.title
    });

    var dbRelease = yield db.AlbumRelease.findOrCreate({mbid: release.id}, {
      mbid: release.id
    });

    yield dbAlbum.addRelease(dbRelease);
    // yield dbRelease.addSong(dbSong);

    for (var recording of release.recordings) {
      dbSong = yield db.Song.findOrCreate({mbid: recording.id}, {
        mbid: recording.id,
        title: recording.title,
        duration: parseInt(recording.length, 10)
      });
      yield dbRelease.addSong(dbSong);
    }
  }

  return false;
});

// Given a particular scrobble, this function will ensure the corresponding
// track / album / artist have all been populated in the DB. In some cases
// there is no musicbrainz ids provided by lastfm. When this happens we do
// lookups in the MusicBrainz DB itself.
exports.loadScrobbleData = Promise.coroutine(function*(scrobble) {
  // Start with the artist.
  scrobble.artist = scrobble.artist || {};
  scrobble.album = scrobble.album || {};

  var artistName = scrobble.artist.name,
      albumName = scrobble.album["#text"],
      songName = scrobble.name,
      artistLoaded = false,
      albumLoaded = false;

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

  // If we aren't 100% confident with our match, let's leave it as unclassified.
  if (!ctx.songMbid || !ctx.albumMbid || !ctx.artistMbid) {
    return false;
  }

  // var context = {
  //   albumMbid: albumMbid,
  //   artistMbid: artistMbid,
  //   songMbid: songMbid,
  // };

  // if (!artistMbid) {
  //   if (!artistName) {
  //     debug("Found artist with no mbid OR name. Wtf.", scrobble);
  //     throw new Error("Found an artist with no mbid or name. That should never happen.");
  //   }

  //   [artistLoaded, artistMbid, artistName] = yield loadArtist(context, scrobble);

  //   if (!artistMbid) {
  //     return false;
  //   }
  // }

  // // If we didn't already grab a valid artist out of DB, time to stuff one in.
  // if (!artistLoaded) {
  //   yield db.Artist.create({
  //     mbid: artistMbid,
  //     name: artistName,
  //   });
  // }
 
  // if (!albumMbid) {
  //   [albumLoaded, albumMbid, albumName] = yield loadAlbum(scrobble);
  // }

  // if (albumMbid && !albumLoaded) {
  //   yield db.Album.create({
  //     mbid: albumMbid,
  //     name: albumName,
  //     image: findImageName(scrobble.image),
  //     artist_mbid: artistMbid,
  //   });
  // }

  // if (!songMbid) {
  //   if (!songName) {
  //     debug("Found song with no mbid OR name. Wtf.", scrobble);
  //     return false;
  //   }

  //   debug("Fetching song mbid for " + songName);
  //   var searchSongName = songName;
  //   var songFilter = {
  //     arid: artistMbid,
  //   };

  //   if (albumMbid) {
  //     songFilter.reid = albumMbid;
  //   }

  //   var songMB = yield mb.searchRecordingsAsync('"' + searchSongName + '"', songFilter);

  //   // If we didn't get an exact match, it might be because of funny chars.
  //   if (songMB.length !== 1) {
  //     songName = songName.replace(/[^a-z0-9]/gi, " ");
  //     songMB = yield mb.searchRecordingsAsync('"' + searchSongName + '"', songFilter);
  //   }

  //   if (songMB.length !== 1) {
  //     debug("Ambiguous song match when looking up mbid.", scrobble);
  //     return false;
  //   }

  //   songMB = songMB[0];

  //   songMbid = songMB.id;
  //   songName = songMB.title;
  // }

  // yield db.Song.findOrCreate({mbid: songMbid}, {
  //   mbid: songMbid,
  //   title: songName,
  //   artist_mbid: artistMbid,
  //   album_mbid: albumMbid || null,
  // });

  // return songMbid;
});

exports.backfill = Promise.coroutine(function*() {
  yield db.ready;

  var lastScrobble = yield db.Scrobble.find({ order: "when_scrobbled ASC" });
  var queryTo = Date.now();

  if (lastScrobble !== null) {
    queryTo = +new Date(lastScrobble.when_scrobbled);
  }

  queryTo = Math.round(queryTo / 1000);

  debug("Fetching tracks from last.fm server...");
  var scrobbles = yield lastfmReq("user.getRecentTracks", {
    user: process.env.LASTFM_USER,
    to: queryTo,
    limit: 1,
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
      scrobbleData.raw_data = JSON.stringify(scrobble, null, 2);
    }

    yield db.Scrobble.create(scrobbleData);
  }

  return scrobbles.length;
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
