module.exports = function(sequelize, DataTypes) {
  return sequelize.define("Album", {
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
