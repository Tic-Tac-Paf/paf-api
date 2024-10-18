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
  gameMode: String,
  difficulty: { type: String, default: "easy" },
  rounds: { type: Number, default: 3 },
});

const Room = mongoose.model("Room", RoomSchema);

module.exports = Room;
