var Sequelize = require("sequelize");
var sequelize = module.exports = new Sequelize(process.env.DB_URL, {
  logging: require("debug")("db")
});

var Scrobble = sequelize.Scrobble = sequelize.import("models/Scrobble");
var Song = sequelize.Song = sequelize.import("models/Song");
var Album = sequelize.Album = sequelize.import("models/Album");
var AlbumRelease = sequelize.AlbumRelease = sequelize.import("models/AlbumRelease");
var Artist = sequelize.Artist = sequelize.import("models/Artist");
var ArtistAlias = sequelize.ArtistAlias = sequelize.import("models/ArtistAlias");
sequelize.MergedMbid = sequelize.import("models/MergedMbid");
sequelize.MusicbrainzBlacklist = sequelize.import("models/MusicbrainzBlacklist");

// An artist has many albums and songs.
Artist.hasMany(Album);
Artist.hasMany(Song);
Artist.hasMany(ArtistAlias, { as: "Alias" });

ArtistAlias.belongsTo(Artist);

// Each album belongs to one or more artists, and has many releases.
Album.hasMany(Artist);
Album.hasMany(AlbumRelease, { as: "Releases" });

// Each album release belongs to an album, and has many songs.
AlbumRelease.belongsTo(Album);
AlbumRelease.hasMany(Song);

// Each song belongs to many album releases, and 1 or more artists.
Song.hasMany(AlbumRelease);
Song.hasMany(Artist);

// Each scrobble has a song and an album release.
Scrobble.belongsTo(Song, { foreignKey: "song_mbid" });
Scrobble.belongsTo(AlbumRelease, { foreignKey: "album_mbid" });
Scrobble.belongsTo(Artist, { foreignKey: "artist_mbid" });

sequelize.ready = new Promise(function(resolve, reject) {
  sequelize.sync({ force: false })
    .success(resolve)
    .error(reject);
});
