const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const User = require("./models/User");
const Room = require("./models/Room");
const Questions = require("./models/Questions");
const dotenv = require("dotenv");
const { generateRoomCode } = require("./utils/data");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
dotenv.config();

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_DB, {
    dbName: "TikTakPaf",
  })
  .then(() => {
    console.log("Connected to MongoDB");
  });

const PORT = process.env.PORT || 3000;

const disconnectedUsers = new Map(); // Store disconnected users and their timeouts

wss.on("connection", (ws) => {
  let currentUser = null; // Track the current user
  let currentRoom = null; // Track the current room

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

        currentUser = user;
        currentRoom = newRoom;

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
        }

        const room = await Room.findOne({ code: data.roomCode });

        if (room) {
          if (!room.players.find((player) => player.id === joinUser.id)) {
            room.players.push({
              id: joinUser.id,
              username: joinUser.username,
            });
          }

          await room.save();

          currentUser = joinUser;
          currentRoom = room;

          ws.send(
            JSON.stringify({
              type: "roomJoined",
              room,
              playerId: joinUser.id,
            })
          );

          broadcastRoom(room, joinUser.id);

          // Cancel the user removal if they reconnect
          if (disconnectedUsers.has(joinUser.id)) {
            clearTimeout(disconnectedUsers.get(joinUser.id).timeout);
            disconnectedUsers.delete(joinUser.id);
          }
        } else {
          ws.send(JSON.stringify({ type: "roomNotFound" }));
        }
        break;

      case "getRoomInfo":
        try {
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
        } catch (error) {
          ws.send(JSON.stringify({ type: "error", message: error.message }));
        }
        break;

      case "updateRoomInfo":
        try {
          const updateRoom = await Room.findOne({
            code: data.roomCode,
          });

          if (updateRoom.admin.id !== data.playerId) {
            ws.send(JSON.stringify({ type: "notAdmin" }));
            return;
          }

          const allowedKeys = ["gameMode", "difficulty", "rounds", "questions"];

          if (updateRoom) {
            if (allowedKeys.includes(data.key)) {
              updateRoom[data.key] = data.value;
            }

            await updateRoom.save();
            broadcastRoom(updateRoom, data.playerId);
          }
        } catch (error) {
          ws.send(JSON.stringify({ type: "error", message: error.message }));
        }

        break;

      case "getRoomQuestions":
        try {
          const room = await Room.findOne({ code: data.roomCode });

          if (!room) {
            ws.send(JSON.stringify({ type: "roomNotFound" }));
            return;
          }

          if (room.admin.id !== data.playerId) {
            ws.send(JSON.stringify({ type: "notAdmin" }));
            return;
          }

          // Fetch questions with the specified difficulty
          const questions = await Questions.find({
            difficulty: room.difficulty,
          });

          // create 3 arrays with 3 questions each
          const questionSets = [];

          for (let i = 0; i < room.rounds; i++) {
            const set = [];
            for (let j = 0; j < 3; j++) {
              const randomIndex = Math.floor(Math.random() * questions.length);

              // Extract only the fields we need
              const question = {
                _id: questions[randomIndex]._id,
                question: questions[randomIndex].question,
              };

              set.push(question);

              // Remove the selected question to avoid duplicates
              questions.splice(randomIndex, 1);
            }
            questionSets.push(set);
          }

          ws.send(
            JSON.stringify({
              type: "questions",
              questions: questionSets,
              roomCode: room.code,
            })
          );
        } catch (error) {
          ws.send(JSON.stringify({ type: "error", message: error.message }));
        }

        break;

      default:
        ws.send(JSON.stringify({ type: "unknownCommand" }));
        break;
    }
  });

  ws.on("close", () => {
    // if (currentUser && currentRoom) {
    //   const timeout = setTimeout(async () => {
    //     // Remove the user from the room's player list after the timeout
    //     currentRoom.players = currentRoom.players.filter(
    //       (player) => player.id !== currentUser.id
    //     );
    //     await currentRoom.save();
    //     // Notify other users in the room about the updated player list
    //     broadcastRoom(currentRoom, currentUser.id);
    //     disconnectedUsers.delete(currentUser.id); // Clean up after removal
    //   }, 30000); // 30 seconds
    //   // Store the timeout for this user
    //   disconnectedUsers.set(currentUser.id, { timeout });
    // }
  });
});

function broadcastRoom(room, playerId) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "updatedRoom", room, playerId }));
    }
  });
}

app.get("/", (req, res) => {
  res.send("Welcome to TikTakPaf");
});

server.listen(PORT, () => {
  console.log("Server is listening on port 3000");
});
