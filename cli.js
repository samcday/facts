require("traceurified")(function(path) {
  return path.indexOf("node_modules/koa") > -1 || path.indexOf("node_modules") === -1;
});

global.Promise = require("bluebird");
require("dotenv").load();

var lastfm = require("./lastfm");

var total = 0;

function runBackfill() {
  lastfm.backfill().then(function(num) {
    if(!num) {
      console.log("Done!");
      return;
    }

    total += num;
    process.stdout.write("\rProcessed " + total + " scrobbles");
    runBackfill();
  });
}

// runBackfill();

lastfm.repairScrobble(135);