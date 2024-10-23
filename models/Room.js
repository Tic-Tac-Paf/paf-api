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
  words: { type: Object, default: {} }, // Declare words as an empty object
  currentRound: { type: Number, default: 1 },
  gameState: { type: String, default: "lobby" },
  questions: { type: Array, default: [] },
});

const Room = mongoose.model("Room", RoomSchema);

module.exports = Room;
