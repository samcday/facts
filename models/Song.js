module.exports = function(sequelize, DataTypes) {
  return sequelize.define("Song", {
    mbid: {
      type: DataTypes.STRING(36),
      primaryKey: true,
      validate: {
        len: 36
      },
    },
    title: DataTypes.STRING,
    duration: DataTypes.INTEGER,
  }, {
    underscored: true
  });
};
