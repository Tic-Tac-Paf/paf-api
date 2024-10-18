const mongoose = require("mongoose");

const RoomSchema = new mongoose.Schema({
  name: String,
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
