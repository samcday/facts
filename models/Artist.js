module.exports = function(sequelize, DataTypes) {
  return sequelize.define("Artist", {
    mbid: {
      type: DataTypes.STRING(36),
      primaryKey: true,
      validate: {
        len: 36
      },
    },
    name: DataTypes.STRING,
  }, {
    underscored: true
  });
};