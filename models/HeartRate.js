module.exports = function(sequelize, DataTypes) {
  return sequelize.define("HeartRate", {
    measure_time: DataTypes.DATE,
    value: DataTypes.INTEGER,
    tags: DataTypes.ARRAY(DataTypes.STRING),
  }, {
    underscored: true
  });
};
