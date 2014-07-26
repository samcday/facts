module.exports = function(sequelize, DataTypes) {
  return sequelize.define("Scrobble", {
    when_scrobbled: {
      type: DataTypes.DATE,
    },
    song_name: DataTypes.STRING,
    song_mbid: DataTypes.STRING(36),
    album_name: DataTypes.STRING,
    album_mbid: DataTypes.STRING(36),
    artist_name: DataTypes.STRING,
    artist_mbid: DataTypes.STRING(36),
    unclassified: DataTypes.BOOLEAN,
    repair_attempts: DataTypes.INTEGER,
  }, {
    underscored: true
  });
};
