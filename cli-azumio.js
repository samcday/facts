#!/usr/bin/env node

global.Promise = require("bluebird");
Promise.longStackTraces();
Error.stackTraceLimit = Infinity;

require("traceurified")(function(path) {
  return path.indexOf("node_modules/koa") > -1 || path.indexOf("node_modules") === -1;
});

require("dotenv").load();

var program = require("commander");

program.version("1.0.0")
  .option("-u, --update", "Fetches latest data from server.")
  .parse(process.argv);

// var db = require("./db");
var azumio = require("./azumio");

if (program.update) {
  azumio.update().then(function(num) {
    console.log("Created " + num + " new entries");
  });
} else {
  program.help();
}