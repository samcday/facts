"use strict";

require("traceurified")(function(path) {
  return path.indexOf("node_modules/koa") > -1 || path.indexOf("node_modules") === -1;
});

require("./server");
