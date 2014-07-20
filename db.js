var Sequelize = require("sequelize");
var sequelize = module.exports = new Sequelize(process.env.DB_URL, {
  logging: require("debug")("db")
});

var LastfmScrobble = sequelize.LastfmScrobble = sequelize.import("models/LastfmScrobble");
var LastfmSong = sequelize.LastfmSong = sequelize.import("models/LastfmSong");
var LastfmAlbum = sequelize.LastfmAlbum = sequelize.import("models/LastfmAlbum");
var LastfmArtist = sequelize.LastfmArtist = sequelize.import("models/LastfmArtist");

LastfmArtist.hasMany(LastfmAlbum, { foreignKey: "artist_mbid" });
LastfmArtist.hasMany(LastfmSong, { foreignKey: "artist_mbid" });

LastfmAlbum.belongsTo(LastfmArtist, { as: "Artist", foreignKey: "artist_mbid" });
LastfmAlbum.hasMany(LastfmSong, { foreignKey: "album_mbid" });

LastfmSong.belongsTo(LastfmArtist, { as: "Artist", foreignKey: "artist_mbid" });
LastfmSong.belongsTo(LastfmAlbum, { as: "Album", foreignKey: "album_mbid" });
LastfmSong.hasMany(LastfmScrobble, { foreignKey: "song_mbid" });

LastfmScrobble.belongsTo(LastfmSong, { as: "Song", foreignKey: "song_mbid" });

sequelize.ready = new Promise(function(resolve, reject) {
  sequelize.sync({  })
    .success(resolve)
    .error(reject);
});
