module.exports = function(sequelize, DataTypes) {
  return sequelize.define("HeartRate", {
    azumio_id: {
      type: DataTypes.STRING,
      unique: true,
    },
    measure_time: DataTypes.DATE,
    value: DataTypes.INTEGER,
    tags: DataTypes.STRING,
  }, {
    underscored: true
  });
};
