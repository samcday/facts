module.exports = function(sequelize, DataTypes) {
  return sequelize.define("MergedMbid", {
    mbid: {
      type: DataTypes.STRING(36),
      primaryKey: true,
      validate: {
        len: 36
      },
    },
    new_mbid: {
      type: DataTypes.STRING(36),
      validate: {
        len: 36
      },
    }
  }, {
    underscored: true
  });
};