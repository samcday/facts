module.exports = function(sequelize, DataTypes) {
  return sequelize.define("LastfmSong", {
    mbid: {
      type: DataTypes.STRING(36),
      primaryKey: true,
      validate: {
        len: 36
      },
    },
    title: DataTypes.STRING,
  }, {
    underscored: true
  });
};
