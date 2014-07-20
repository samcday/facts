module.exports = function(sequelize, DataTypes) {
  return sequelize.define("LastfmScrobble", {
    when_scrobbled: {
      type: DataTypes.DATE,
      unique: true
    },
    unclassified: DataTypes.BOOLEAN,
    raw_data: DataTypes.TEXT
  }, {
    underscored: true
  });
};
