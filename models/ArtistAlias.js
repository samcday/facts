module.exports = function(sequelize, DataTypes) {
  return sequelize.define("ArtistAlias", {
    name: DataTypes.STRING,
  }, {
    underscored: true
  });
};