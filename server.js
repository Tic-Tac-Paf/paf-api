const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const User = require("./models/User");
const Room = require("./models/Room");
const dotenv = require("dotenv");

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

wss.on("connection", (ws) => {
  ws.on("message", async (message) => {
    const data = JSON.parse(message);

    switch (data.type) {
      case "createRoom":
        let user = await User.findOne({ username: data.admin });
        if (!user) {
          user = new User({ username: data.admin });
          await user.save();
        }

        const newRoom = new Room({
          name: data.roomName,
          admin: { id: user.id, username: user.username },
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
        let joinUser = await User.findOne({ username: data.player });
        if (!joinUser) {
          joinUser = new User({ username: data.player });
          await joinUser.save();
        }

        const room = await Room.findOne({ name: data.roomName });
        if (room) {
          room.players.push({ id: joinUser.id, username: data.player });
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
        const roomInfo = await Room.findOne({ name: data.roomName });
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

server.listen(3000, () => {
  console.log("Server is listening on port 3000");
});
