const mongoose = require("mongoose");

const RoomSchema = new mongoose.Schema({
  code: { type: String, unique: true },
  admin: {
    id: String,
    username: String,
  },
  players: [
    {
      id: String,
      username: String,
    },
  ],
});

const Room = mongoose.model("Room", RoomSchema);

module.exports = Room;
