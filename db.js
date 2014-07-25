var Sequelize = require("sequelize");
var sequelize = module.exports = new Sequelize(process.env.DB_URL, {
  logging: require("debug")("db")
});

var Scrobble = sequelize.Scrobble = sequelize.import("models/Scrobble");
var Song = sequelize.Song = sequelize.import("models/Song");
var Album = sequelize.Album = sequelize.import("models/Album");
var AlbumRelease = sequelize.AlbumRelease = sequelize.import("models/AlbumRelease");
var Artist = sequelize.Artist = sequelize.import("models/Artist");

// An artist has many albums.
Artist.hasMany(Album);

// Each album belongs to an artist, and has many releases.
Album.belongsTo(Artist);
Album.hasMany(AlbumRelease, { as: "Release" });

// Each album release belongs to an album, and has many songs.
AlbumRelease.belongsTo(Album);
AlbumRelease.hasMany(Song);

// Each song belongs to many albums / album releases.
Song.hasMany(AlbumRelease);

// Each scrobble has a song and an album release.
Scrobble.belongsTo(Song);
Scrobble.belongsTo(AlbumRelease);

sequelize.ready = new Promise(function(resolve, reject) {
  sequelize.sync({  })
    .success(resolve)
    .error(reject);
});
