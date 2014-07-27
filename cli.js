global.Promise = require("bluebird");
Promise.longStackTraces();
Error.stackTraceLimit = Infinity;

require("traceurified")(function(path) {
  return path.indexOf("node_modules/koa") > -1 || path.indexOf("node_modules") === -1;
});

require("dotenv").load();

var lastfm = require("./lastfm");

var total = 0;

function runBackfill() {
  lastfm.backfill(200).then(function(num) {
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


lastfm.repairMissingSongIds(100);

// lastfm.getRelease("9848c3a5-adc7-41b6-bda8-ab3fe3896bb4").then(console.log).catch(function(err) { console.error(err.stack); });