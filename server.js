"use strict";

var koa = require("koa");

var app = koa();

app.use(function *() {
  this.body = "Hi!";
});

app.listen(3000);
