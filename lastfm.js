"use strict";

var limiter = require("limiter");
var natural = require("natural");
var LastFmNode = require("lastfm").LastFmNode;
var mb = Promise.promisifyAll(require("musicbrainz"));
var debug = require("debug")("lastfm");
var db = require("./db");

// Artists that we've already tried looking up in MB recently.
var skipArtists = [];

var replacements = {
  "…": "...",
  "’": "'",
  "ﬁ": "fi",
  "Gonna": "Going To",
  "Wanna": "Want to",
};

// Makes a best effort to normalize a string according to some predefined rules.
function normalize(str) {
  // Remove everything in parentheses / square brackets
  // TODO: should skip this if it ends in Remix.
  str = str.replace(/\([^)]+?\)/g, " ");
  str = str.replace(/\[[^\]]+?\]/g, " ");

  // Remove " - Version|Remaster"
  str = str.replace(/-\s*.*?(?:Version|Remaster)$/i, " ");

  // Remove " - live"
  str = str.replace(/-\s*.*?Live$/i, " ");

  // Remove single quotes.
  str = str.replace("'", "");

  // Remove all illegal chars.
  str = str.replace(/[^a-z0-9]/gi, " ");

  // Collapse runs of more than 2 of the same character.
  str = str.replace(/(\w)\1{2,}/gi, "$1$1");

  // Remove "Part <num>", where num is numbers or roman numerals.
  str = str.replace(/(?:part|pt\.) (?:[0-9ivxlcdm]+|A|B|C|D|E)/gi, " ");

  // Collapse whitespace.
  str = str.replace(/\s{1,}/g, " ");

  // Remove trailing whitespace, lower case everything.
  return str.trim().toLowerCase();
}

function replace(str) {
  for (var item of Object.keys(replacements)) {
    str = str.replace(item, replacements[item]);
  }
  return str;
}

function compareTitles(l, r) {
  var lNorm = normalize(replace(l)), rNorm = normalize(replace(r));

  // If our normalization brutalized the song title too hard, then we bail out.
  if (!lNorm || !rNorm) {
    return false;
  }

  return natural.JaroWinklerDistance(normalize(l), normalize(r)) >= 0.80;
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

var createMergedMbid = Promise.coroutine(function*(obsoleteId, newId) {
  yield db.MergedMbid.findOrCreate({mbid: obsoleteId}, {
    mbid: obsoleteId,
    new_mbid: newId,
  });
});

var checkMergedMbid = Promise.coroutine(function*(obsoleteId) {
  var merged = yield db.MergedMbid.find(obsoleteId);

  if (merged) {
    return merged.new_mbid;
  }

  return obsoleteId;
});

exports.getArtist = Promise.coroutine(function*(id) {
  yield db.ready;

  debug("Loading artist with id " + id);

  var dbArtist, artist, alias, dbAlias;

  id = yield checkMergedMbid(id);
  dbArtist = yield db.Artist.find(id);

  if (dbArtist) {
    return dbArtist;
  }

  debug("Looking up artist with ID " + id + " in MB.");

  try {
    artist = yield mb.lookupArtistAsync(id, ["aliases"]);
  } catch(e) {
    if (e.name !== 'OperationalError' || !e.message.startsWith("Not Found")) {
      throw e;
    }
  }

  if (!artist) {
    return false;
  }

  // If the id that came back for the artist differs from what we requested, then we've found an obselete mbid.
  if (artist.id !== id) {
    yield createMergedMbid(id, artist.id);

    // Since we got back a different id, we may already have this in DB. If we do, we're done.
    dbArtist = yield db.Artist.find(artist.id);

    if (dbArtist) {
      return dbArtist;
    }
  }

  dbArtist = yield db.Artist.create({
    mbid: artist.id,
    name: artist.name
  });

  for (alias of artist.aliases) {
    dbAlias = yield db.ArtistAlias.create({
      name: alias
    });
    yield dbAlias.setArtist(dbArtist);
  }

  return dbArtist;
});

exports.getAlbum = Promise.coroutine(function*(id) {
  debug("Loading album with id " + id);

  var dbAlbum, releaseGroup, dbArtists, artistCredit, artist, dbArtist;

  id = yield checkMergedMbid(id);
  dbAlbum = yield db.Album.find(id);
  if (dbAlbum) {
    return dbAlbum;
  }

  debug("Looking up album with ID " + id + " in MB.");

  try {
    releaseGroup = yield mb.lookupReleaseGroupAsync(id, ["artists"]);
  } catch(e) {
    if (e.name !== 'OperationalError' || !e.message.startsWith("Not Found")) {
      throw e;
    }
  }

  if (!releaseGroup) {
    debug("Musicbrainz has no release-group with id " + id);
    return false;
  }

  // If the id that came back for the release-group differs from what we requested, then we've found an obselete mbid.
  if (releaseGroup.id !== id) {
    yield createMergedMbid(id, releaseGroup.id);

    // Since we got back a different id, we may already have this in DB. If we do, we're done.
    dbAlbum = yield db.Album.find(releaseGroup.id);

    if (dbAlbum) {
      return dbAlbum;
    }
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

  id = yield checkMergedMbid(id);
  dbRelease = yield db.AlbumRelease.find(id);
  if (dbRelease) {
    return dbRelease;
  }

  debug("Looking up release with ID " + id + " in MB.");

  // Since we're asking for release, might as well suck down all the recordings for it too.
  try {
    release = yield mb.lookupReleaseAsync(id, ["artist-credits", "release-groups", "recordings"]);
  } catch(e) {
    if (e.name !== 'OperationalError' || !e.message.startsWith("Not Found")) {
      throw e;
    }
  }

  if (!release) {
    debug("Music-brainz has no release with id " + id);
    return false;
  }

  // If the id that came back for the release differs from what we requested, then we've found an obselete mbid.
  if (release.id !== id) {
    yield createMergedMbid(id, release.id);

    // Since we got back a different id, we may already have this in DB. If we do, we're done.
    dbRelease = yield db.AlbumRelease.find(release.id);

    if (dbRelease) {
      return dbRelease;
    }
  }

  // As far as I know, you can never have a release that belongs to more or less than one release group.
  if (release.releaseGroups.length !== 1) {
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
    debug("Release id " + release.id + " has " + medium.tracks.length + " tracks");
    for (track of medium.tracks) {
      recording = track.recording;
      dbSong = yield db.Song.findOrCreate({mbid: recording.id}, {
        mbid: recording.id,
        title: recording.title,
        duration: parseInt(recording.length, 10) || -1,
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

exports.getSong = Promise.coroutine(function*(id) {
  debug("Loading song with ID " + id);

  var dbSong, song, artistCredit, artist, dbArtist, release;

  id = yield checkMergedMbid(id);
  dbSong = yield db.Song.find(id);

  if (dbSong) {
    return dbSong;
  }

  debug("Looking up song with ID " + id + " in MB.");

  try {
    song = yield mb.lookupRecordingAsync(id, ["releases"]);
  } catch(e) {
    if (e.name !== 'OperationalError' || !e.message.startsWith("Not Found")) {
      throw e;
    }
  }

  if (!song) {
    return false;
  }

  // If the id that came back for the song differs from what we requested, then we've found an obselete mbid.
  if (song.id !== id) {
    yield createMergedMbid(id, song.id);

    // Since we got back a different id, we may already have this in DB. If we do, we're done.
    dbSong = yield db.Song.find(song.id);

    if (dbSong) {
      return dbSong;
    }
  }

  dbSong = yield db.Song.findOrCreate({mbid: song.id}, {
    mbid: song.id,
    title: song.title,
    duration: parseInt(song.length, 10) || -1,
  });

  for (artistCredit of song.artistCredits) {
    artist = artistCredit.artist;
    dbArtist = yield exports.getArtist(artist.id);
    if (dbArtist) {
      yield dbArtist.addSong(dbSong);
      yield dbSong.addArtist(dbArtist);
    }
  }

  for (release of song.releases) {
    yield exports.getRelease(release.id);
  }

  return dbSong;
});

// Looks for scrobbles that don't have a song mbid and does its best to fill them in.
exports.repairMissingSongIds = Promise.coroutine(function*(num) {
  yield db.ready;

  var i = 0, matching, song, withAlbum, dbRelease, songs;

  for (; i < num; i++) {
    // Scrobbles that don't have a song but *do* have an album are pretty easy.
    withAlbum = yield db.Scrobble.find({
      where: {
        song_mbid: "",
        album_mbid: {
          ne: ""
        }
      },
      attributes: ["id", "when_scrobbled", "song_name", "song_mbid", "album_mbid"],
      order: "repair_attempts ASC"
    });

    debug("Repairing missing song id for scrobble on " + withAlbum.when_scrobbled, withAlbum.song_name, withAlbum.album_mbid);

    dbRelease = yield exports.getRelease(withAlbum.album_mbid);
    songs = yield dbRelease.getSongs();

    // Attempt to find a match...
    matching = [];
    for (song of songs) {
      if (compareTitles(song.title, withAlbum.song_name)) {
        matching.push(song);
      }
    }

    // We only consider the match a success if there was exactly one.
    if (matching.length === 1) {
      song = matching[0];
      debug("Found missing song id!", withAlbum.song_name, song.mbid);

      // Update all other instances.
      yield db.Scrobble.update({
        song_mbid: song.mbid,
      }, {
        song_name: withAlbum.song_name,
        album_mbid: withAlbum.album_mbid,
      });
    } else {
      yield withAlbum.increment("repair_attempts", {by: 1});
    }
  }
});

exports.setSongId = Promise.coroutine(function*(songName, mbid, releaseMbid, artistMbid) {
  yield db.ready;

  var criteria = {
    song_mbid: "",
    song_name: songName,
  };

  if (releaseMbid) {
    criteria.album_mbid = releaseMbid;
  }
  if (artistMbid) {
    criteria.artist_mbid = artistMbid;
  }

  var affected = yield db.Scrobble.update({
    song_mbid: mbid
  }, criteria);

  return affected;
});

var checkMusicbrainzBlacklist = Promise.coroutine(function*(name) {
  var blacklist = yield db.MusicbrainzBlacklist.find({
    where: {
      name: name,
      attempts: { gt: 5 },
    }
  });
  return blacklist !== null;
});

var markMusicbrainzBlacklist = Promise.coroutine(function*(name) {
  var blacklist = yield db.MusicbrainzBlacklist.findOrCreate({ name: name }, {
    name: name,
    attempts: 0,
  });
  yield blacklist.increment("attempts", { by: 1 });
});

exports.repairMissingArtistIds = Promise.coroutine(function*(num) {
  var i = 0, missingArtist, artistName, dbArtist, dbArtistAlias, artistId, artists;

  for (; i < num; i++) {
    missingArtist = yield db.Scrobble.find({
      where: {
        artist_mbid: ""
      },
      order: "repair_attempts ASC"
    });

    if (!missingArtist) {
      return i;
    }

    artistName = missingArtist.artist_name;

    // Chop off featured artists.
    artistName = artistName.replace(/feat(?:\.|uring)?\s.*$/i, "").trim();

    debug("Attempting to repair missing artist id for " + missingArtist.artist_name);

    // First, let's see if we can't find it with a direct search in the DB. As we load artists from MB we populate the
    // artist alias list too, so it could very well already be in there.
    dbArtist = yield db.Artist.find({
      where: {
        name: artistName
      },
    });

    if (!dbArtist) {
      // Perhaps we can find an alias? Sequelize doesn't seem to support doing this in a single query. Or at least I 
      // can't figure out how to.
      dbArtistAlias = yield db.ArtistAlias.find({
        where: {
          name: artistName
        },
        include: db.Artist
      });

      if (dbArtistAlias) {
        dbArtist = dbArtistAlias.artist;
      }
    }

    if (!dbArtist && !(yield checkMusicbrainzBlacklist(artistName))) {
      // Nope. Definitely not in DB. Let's try a musicbrainz search.
      debug("Looking up artist '" + artistName + "' in MB.");
      artists = yield mb.searchArtistsAsync('"' + artistName + '"', []);
      artists = artists.filter(artist => artist.searchScore === 100);

      if (artists.length !== 1) {
        debug("No perfect match when looking up " + artistName);
        yield markMusicbrainzBlacklist(artistName);
      } else {
        dbArtist = yield exports.getArtist(artists[0].id);
      }
    }

    artistId = (dbArtist || {}).mbid;

    if (artistId) {
      debug("Found missing artist id!", missingArtist.artist_name, artistId);

      yield db.Scrobble.update({
        artist_mbid: artistId,
      }, {
        artist_name: missingArtist.artist_name,
        artist_mbid: "",
      });
    } else {
      yield missingArtist.increment("repair_attempts", {by: 1});
    }
  }

  return i;
});

// Looks for scrobbles that don't have a corresponding artist, and loads them.
exports.loadMissingArtists = Promise.coroutine(function*(num) {
  yield db.ready;

  var i = 0, noArtist, artist;

  for (; i < num; i++) {
    noArtist = yield db.Scrobble.find({
      where: {
        artist_mbid: { ne: "" },
        "Artist.name": null
      },
      include: db.Artist,
      attributes: ["artist_mbid"],
    });

    if (!noArtist) {
      return i;
    }

    artist = yield exports.getArtist(noArtist.artist_mbid);

    // Obsolete id. Update it.
    if (artist.mbid !== noArtist.artist_mbid) {
      yield db.Scrobble.update({
        artist_mbid: artist.mbid,
      }, {
        artist_mbid: noArtist.artist_mbid,
      });
    }
  }

  return i;
});

// Looks for scrobbles that don't have a corresponding song, and loads them.
exports.loadMissingSongs = Promise.coroutine(function*(num) {
  yield db.ready;

  var i = 0, noSong, dbRelease, dbSong;

  for (; i < num; i++) {
    noSong = yield db.Scrobble.find({
      where: {
        song_mbid: { ne: "" },
        album_mbid: { ne: "" },
        "Song.title": null
      },
      include: db.Song,
      attributes: ["id", "song_mbid"],
    });

    if (!noSong) {
      return i;
    }

    dbSong = yield exports.getSong(noSong.song_mbid);

    // If the release didn't actually contain the song, then remove it from the Scrobble.
    if (!dbSong) {
      debug("Scrobble with id " + noSong.id + " had an invalid song mbid.");

      yield db.Scrobble.update({
        song_mbid: null,
      }, {
        song_mbid: noSong.song_mbid,
      });
    } else if (dbSong.mbid !== noSong.song_mbid) {
      yield db.Scrobble.update({
        song_mbid: dbSong.mbid,
      }, {
        song_mbid: noSong.song_mbid,
      });
    }
  }

  return i;
});