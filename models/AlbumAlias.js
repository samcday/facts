module.exports = function(sequelize, DataTypes) {
  return sequelize.define("AlbumAlias", {
    name: DataTypes.STRING,
  }, {
    underscored: true
  });
};