const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const UserSchema = new mongoose.Schema({
  id: { type: String, unique: true, default: uuidv4 },
  username: String,
});

const User = mongoose.model("User", UserSchema);

module.exports = User;
