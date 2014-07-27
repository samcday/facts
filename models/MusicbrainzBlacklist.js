module.exports = function(sequelize, DataTypes) {
  return sequelize.define("MusicbrainzBlacklist", {
    name: DataTypes.STRING,
    attempts: DataTypes.INTEGER,
  }, {
    underscored: true
  });
};
