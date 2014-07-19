module.exports = function(sequelize, DataTypes) {
  return sequelize.define("LastfmArtist", {
    mbid: {
      type: DataTypes.STRING(36),
      primaryKey: true,
      validate: {
        len: 36
      },
    },
    name: DataTypes.STRING,
    image: DataTypes.STRING,
  }, {
    underscored: true
  });
};