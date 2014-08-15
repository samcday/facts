"use strict";

var Azumio = require("azumio");
var db = require("./db");

var azumio = new Azumio(process.env.AZUMIO_EMAIL, process.env.AZUMIO_PASSWORD);

exports.update = Promise.coroutine(function*() {
  yield db.ready;

  var data = yield azumio.heartrate();

  var num = 0;

  for (var item of data) {
    var [_, created] = yield db.findOrCreate({
      azumio_id: item.id,
    }, {
      azumio_id: item.id,
      measure_time: new Date(item.timestamp),
      value: item.rate,
      tags: item.tags ? item.tags.join(",") : "",
    });

    if (created) {
      num++;
    }
  }

  return num;
});
