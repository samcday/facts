require("traceurified")(function(path) {
  return path.indexOf("node_modules/koa") > -1 || path.indexOf("node_modules") === -1;
});

global.Promise = require("bluebird");
require("dotenv").load();

var lastfm = require("./lastfm");

lastfm.backfill().then(function() {
  console.log("Done.");
}).catch(function(err) {
  console.error(err);
});