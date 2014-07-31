global.Promise = require("bluebird");
Promise.longStackTraces();
Error.stackTraceLimit = Infinity;

require("traceurified")(function(path) {
  return path.indexOf("node_modules/koa") > -1 || path.indexOf("node_modules") === -1;
});

require("dotenv").load();

var program = require("commander");

function cmdAssignment(expected) {
  return function(input) {
    var parts = input.split(":");
    if (parts.length != expected) {
      program.help();
    }

    for (var i = 0; i < expected; i++) {
      if (!parts[i]) {
        program.help();
      }
    }
    return parts;
  };
}

program.version("1.0.0")
  .option("-b, --backfill", "Runs backfill.")
  .option("-r, --repair <num>", "Repairs scrobbles with missing data.")
  .option("-r, --repair-albums <num>", "Repairs scrobbles with missing album ids.")
  .option("--load-missing <num>", "Loads missing data (artists / releases / songs")
  .option("--update-song <title>:<mbid>", "Manually specify an mbid for given title. Artist/album must be specified for disambiguation", cmdAssignment(2))
  .option("-s, --show", "Show entity data, provide --song / --artist / --release")
  .option("--song <mbid>", "Specify song mbid")
  .option("--artist <mbid>", "Specify artist mbid")
  .option("--release <mbid>", "Specify release mbid")
  .option("--album <mbid>", "Specify album mbid")
  .option("--redirect <from mbid>:<target mbid>", "Redirects <from mbid> to <target mbid>", cmdAssignment(2))
  .parse(process.argv);

var db = require("./db");
var lastfm = require("./lastfm");

if (program.backfill) {
  var total = 0;

  function runBackfill() {
    lastfm.backfill(200).then(function(num) {
      if(!num) {
        console.log("Backfill complete!");
        return;
      }

      total += num;
      process.stdout.write("Backfilled " + total + " scrobbles\r");
      runBackfill();
    });
  }

  runBackfill();
}
else if(program.repair) {
  var num = parseInt(program.repair, 10) || 100;

  lastfm.repairMissingArtistIds(num).then(function(processed) {
    console.log("Repaired " + processed + " missing artist IDs.");
    return lastfm.repairMissingAlbumIds(num);
  }).then(function(processed) {
    console.log("Repaired " + processed + " missing album IDs.");
    return lastfm.repairMissingSongIds(num);
  }).then(function(processed) {
    console.log("Repaired " + processed + " missing song IDs.");
  });
}
else if (program.repairAlbums) {
  var num = parseInt(program.repair, 10) || 100;
  lastfm.repairMissingAlbumIds(num).then(function(processed) {
    console.log("Repaired " + processed + " missing album IDs.");
  });
}
else if(program.loadMissing) {
  var num = parseInt(program.loadMissing, 10) || 100;

  lastfm.loadMissingArtists(num).then(function(processed) {
    console.log("Loaded " + processed + " missing artists.");
    // return lastfm.loadMissingSongs(num);
  }).then(function(processed) {
    // console.log("Loaded " + processed + " missing songs.");
  });
}
else if(program.updateSong) {
  var name = program.updateSong[0];
  var mbid = program.updateSong[1];

  var releaseMbid = program.release;
  var artistMbid = program.artist;

  if (!releaseMbid && !artistMbid) {
    console.log("ERROR: please provide either artist or release mbid.");
    program.help();
    return;
  }

  lastfm.setSongId(name, mbid, releaseMbid, artistMbid).then(function(affected) {
    console.log("Updated " + affected + " scrobbles.");
  });
}
else if(program.song) {
  db.Song.find({
    where: {
      mbid: program.song,
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
  }).then(function(song) {
    console.log(JSON.stringify(song, null, 2));
  });
}
else if(program.redirect) {
  var from = program.redirect[0],
      to = program.redirect[1];

  console.log("Redirecting " + from + " to " + to);

  db.MergedMbid.create({
    mbid: from,
    new_mbid: to,
    forced: true,
  }).then(function() {
    console.log("Done. Updating scrobbles with merged entities...");
    return lastfm.updateMergedIds();
  }).then(function(updated) {
    console.log("Done. Updated " + updated + " entities.");
  }).catch(function(err) {
    console.error(err);
  });
}
else if (program.show) {
  var prom;

  if (program.release) {
    prom = lastfm.getRelease(program.release);
  }
  else {
    throw new Error("Provide one of --album / --release / --song");
  }

  prom.then(function(entity) {
    console.log(JSON.stringify(entity, null, 2));
  }).catch(function(err) {
    console.error(err);
  });
}