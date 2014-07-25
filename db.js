var Sequelize = require("sequelize");
var sequelize = module.exports = new Sequelize(process.env.DB_URL, {
  logging: require("debug")("db")
});

var Scrobble = sequelize.Scrobble = sequelize.import("models/Scrobble");
var Song = sequelize.Song = sequelize.import("models/Song");
var Album = sequelize.Album = sequelize.import("models/Album");
var AlbumRelease = sequelize.AlbumRelease = sequelize.import("models/AlbumRelease");
var Artist = sequelize.Artist = sequelize.import("models/Artist");

Artist.hasMany(AlbumRelease, { foreignKey: "artist_mbid" });
AlbumRelease.belongsTo(Artist, { foreignKey: "artist_mbid" });

AlbumRelease.hasMany(Album, foreignKey: "release_mbid"});
Album.belongsTo(AlbumRelease, foreignKey: "release_mbid"});

Album.hasMany(Song, { foreignKey: "album_mbid" });
Song.belongsTo(Album, { foreignKey: "album_mbid" });

Song.hasMany(Scrobble, { foreignKey: "song_mbid" });
Scrobble.belongsTo(Song, { foreignKey: "song_mbid" });

sequelize.ready = new Promise(function(resolve, reject) {
  sequelize.sync({  })
    .success(resolve)
    .error(reject);
});
