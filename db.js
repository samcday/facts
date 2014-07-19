var Sequelize = require("sequelize");
var sequelize = module.exports = new Sequelize(process.env.DB_URL);

var LastfmScrobble = sequelize.LastfmScrobble = sequelize.import("models/LastfmScrobble");
var LastfmSong = sequelize.LastfmSong = sequelize.import("models/LastfmSong");
var LastfmAlbum = sequelize.LastfmAlbum = sequelize.import("models/LastfmAlbum");
var LastfmArtist = sequelize.LastfmArtist = sequelize.import("models/LastfmArtist");

LastfmArtist.hasMany(LastfmAlbum, { foreignKey: "artist_mbid" });
LastfmAlbum.belongsTo(LastfmArtist, { foreignKey: "artist_mbid" });

LastfmAlbum.hasMany(LastfmSong, { foreignKey: "album_mbid" });
LastfmSong.belongsTo(LastfmAlbum, { foreignKey: "album_mbid" });

LastfmSong.hasOne(LastfmScrobble, { foreignKey: "song_mbid" });

sequelize.ready = sequelize.sync({  });
