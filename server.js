const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const User = require("./models/User");
const Room = require("./models/Room");
const dotenv = require("dotenv");
const { generateRoomCode } = require("./utils/data");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_DB, {
  dbName: "TikTakPaf",
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const PORT = process.env.PORT || 3000;

wss.on("connection", (ws) => {
  ws.on("message", async (message) => {
    const data = JSON.parse(message);

    switch (data.type) {
      case "createRoom":
        let user = await User.findOne({ id: data.playerId });
        if (!user) {
          user = new User({ username: data.username });
          await user.save();
        }

        const roomCode = generateRoomCode();

        const newRoom = new Room({
          code: roomCode,
          admin: { id: user.id, username: user.username },
          gameMode: data.gameMode,
          players: [],
        });
        await newRoom.save();

        ws.send(
          JSON.stringify({
            type: "roomCreated",
            room: newRoom,
            playerId: user.id,
          })
        );

        broadcastRoom(newRoom, user.id);
        break;

      case "joinRoom":
        let joinUser = await User.findOne({ id: data.playerId });
        if (!joinUser) {
          joinUser = new User({ username: data.username });
          await joinUser.save();
        } else {
          joinUser.username = data.username;
          await joinUser.save();
        }

        const room = await Room.findOne({ code: data.roomCode });
        if (room) {
          if (!room.players.find((player) => player.id === joinUser.id)) {
            room.players.push({ id: joinUser.id, username: joinUser.username });
          } else {
            // replace the username with the new username
            room.players = room.players.map((player) => {
              if (player.id === joinUser.id) {
                player.username = joinUser.username;
              }
              return player;
            });
          }

          await room.save();

          ws.send(
            JSON.stringify({
              type: "roomJoined",
              room,
              playerId: joinUser.id,
            })
          );

          broadcastRoom(room, joinUser.id);
        } else {
          ws.send(JSON.stringify({ type: "roomNotFound" }));
        }
        break;

      case "getRoomInfo":
        const roomInfo = await Room.findOne({ code: data.roomCode });
        if (roomInfo) {
          ws.send(
            JSON.stringify({
              type: "roomInfo",
              room: roomInfo,
            })
          );
        } else {
          ws.send(JSON.stringify({ type: "roomNotFound" }));
        }
        break;

      case "updateRoomInfo":
        const updateRoom = await Room.findOne({
          code: data.roomCode,
        });

        if (updateRoom.admin.id !== data.playerId) {
          ws.send(JSON.stringify({ type: "notAdmin" }));
          return;
        }

        const allowedKeys = ["gameMode", "difficulty", "rounds"];

        if (updateRoom) {
          if (allowedKeys.includes(data.key)) {
            updateRoom[data.key] = data.value;
          }

          await updateRoom.save();
          broadcastRoom(updateRoom, data.playerId);
        }

        break;
      default:
        ws.send(JSON.stringify({ type: "unknownCommand" }));
        break;
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

function broadcastRoom(room, playerId) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "updatedRoom", room, playerId }));
    }
  });
}

server.listen(PORT, () => {
  console.log("Server is listening on port 3000");
});
