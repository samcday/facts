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
  .option("-r, --repair", "Repairs scrobbles with missing data.")
  .option("--update-song <artist mbid>:<title>:<mbid>", "Manually specify the mbid for a song/artist combination.", cmdAssignment(3))
  .option("-s, --song <mbid>", "Show data for song with mbid")
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
  lastfm.repairMissingSongIds(100);
}
else if(program.updateSong) {
  var artistMbid = program.updateSong[0];
  var name = program.updateSong[1];
  var mbid = program.updateSong[2];

  lastfm.setSongId(artistMbid, name, mbid).then(function(affected) {
    console.log("Updated " + affected + " scrobbles.");
  });
}
else if(program.song) {
  console.log(typeof program.song);
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
  })
}
